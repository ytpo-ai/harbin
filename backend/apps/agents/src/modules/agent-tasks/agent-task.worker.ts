import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentTaskService } from './agent-task.service';
import { AgentService } from '../agents/agent.service';
import { Task as RuntimeTask } from '../../../../../src/shared/types';
import { OpenCodeServeRouterService } from './opencode-serve-router.service';
import { OpenCodeAdapter } from '../opencode/opencode.adapter';

@Injectable()
export class AgentTaskWorker implements OnModuleInit {
  private readonly logger = new Logger(AgentTaskWorker.name);
  private running = false;
  private readonly maxConcurrency = Math.max(1, Number(process.env.AGENT_TASK_WORKER_CONCURRENCY || 2));
  private readonly cancelPollIntervalMs = Math.max(200, Number(process.env.AGENT_TASK_CANCEL_POLL_INTERVAL_MS || 500));
  private readonly opencodeInactivityTimeoutMs = Math.max(
    30_000,
    Number(process.env.AGENT_TASK_OPENCODE_INACTIVITY_TIMEOUT_MS || 300000),
  );
  private readonly opencodeAbsoluteTimeoutMs = Math.max(
    60_000,
    Number(process.env.AGENT_TASK_OPENCODE_ABSOLUTE_TIMEOUT_MS || 1800000),
  );
  private readonly opencodeActivityPollIntervalMs = Math.max(
    5000,
    Number(process.env.AGENT_TASK_OPENCODE_ACTIVITY_POLL_INTERVAL_MS || 30000),
  );
  private activeCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly taskService: AgentTaskService,
    private readonly agentService: AgentService,
    private readonly serveRouter: OpenCodeServeRouterService,
    private readonly openCodeAdapter: OpenCodeAdapter,
  ) {}

  onModuleInit(): void {
    const enabled = String(process.env.AGENT_TASK_SSE_ENABLED || 'true').trim().toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('Agent task worker disabled by AGENT_TASK_SSE_ENABLED');
      return;
    }
    this.running = true;
    void this.loop();
    this.startRetryScheduler();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.activeCount >= this.maxConcurrency) {
        await this.sleep(200);
        continue;
      }

      const taskId = await this.taskService.popQueuedTaskId(2);
      if (!taskId) {
        await this.sleep(200);
        continue;
      }

      this.activeCount += 1;
      void this.processTask(taskId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error || 'unknown');
          this.logger.error(`Agent task worker process failed taskId=${taskId}: ${message}`);
        })
        .finally(() => {
          this.activeCount -= 1;
        });
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const task = await this.taskService.getTaskById(taskId);
    if (!task || task.status !== 'queued') {
      return;
    }
    if (task.nextRetryAt && task.nextRetryAt.getTime() > Date.now()) {
      return;
    }

    const nextAttempt = Number(task.attempt || 0) + 1;
    await this.taskService.updateTaskState({
      taskId,
      attempt: nextAttempt,
      lastAttemptAt: new Date(),
      currentStep: nextAttempt > 1 ? 'retry_started' : 'started',
    });

    const serve = task.serveId ? this.serveRouter.resolveByServeId(task.serveId) : this.serveRouter.pickServe();
    const serveId = serve?.serveId;
    if (serveId) {
      this.serveRouter.markServeAcquire(serveId);
    }

    try {
      await this.taskService.updateTaskState({
        taskId,
        status: 'running',
        progress: 1,
        currentStep: 'start',
        serveId: serveId || task.serveId,
        startedAt: task.startedAt || new Date(),
      });

      await this.taskService.publishTaskEvent({
        id: `evt-${Date.now()}-status-running`,
        type: 'status',
        taskId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        payload: {
          status: 'running',
          serveId: serveId || task.serveId,
          attempt: nextAttempt,
        },
      });

      // 触发 task.running lifecycle hooks
      void this.taskService.runTaskPipeline('task.running', {
        taskId,
        agentId: task.agentId,
        payload: { task: { id: taskId, agentId: task.agentId, prompt: task.prompt }, attempt: nextAttempt },
      });

      const freshTask = await this.taskService.getTaskById(taskId);
      const now = Date.now();
      const startedAtMs = freshTask?.startedAt ? new Date(freshTask.startedAt).getTime() : now;
      const taskTimeoutMs = Math.max(1000, Number(freshTask?.taskTimeoutMs || 1200000));
      // opencode 通道任务（开发/review）执行时间较长，自动扩大 step timeout 至 15 分钟。
      const isOpenCodeChannel = String(task.sessionContext?.runtimeChannelHint || '').trim() === 'opencode';
      const defaultStepTimeoutMs = isOpenCodeChannel ? 900000 : 120000;
      const stepTimeoutMs = Math.max(1000, Number(freshTask?.stepTimeoutMs || defaultStepTimeoutMs));
      if (now - startedAtMs > taskTimeoutMs) {
        throw new Error('TASK_TIMEOUT_EXCEEDED');
      }

      const runtimeTask: RuntimeTask = {
        id: task.id,
        title: `Agent Task ${task.id}`,
        description: task.prompt,
        type: this.resolveRuntimeTaskType(task.prompt, task.sessionContext),
        priority: 'medium',
        status: 'pending',
        assignedAgents: [task.agentId],
        teamId: 'agent-task',
        messages: [
          {
            role: 'user' as const,
            content: task.prompt,
            timestamp: new Date(),
          },
        ],
      };

      let openCodeSessionId: string | undefined;
      let openCodeRuntimeEndpoint: string | undefined;
      let openCodeRuntimeAuthEnable: boolean | undefined;
      const taskExecutionPromise = this.agentService.executeTaskWithStreaming(
        task.agentId,
        runtimeTask,
        (token) => {
          void this.taskService.publishTaskEvent({
            id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            type: 'token',
            taskId,
            sequence: 0,
            timestamp: new Date().toISOString(),
            payload: {
              token,
            },
          });
        },
        {
          sessionContext: task.sessionContext || {},
          collaborationContext: {
            sessionId: this.readString(task.sessionContext?.sessionId),
            planId: this.readString(task.sessionContext?.planId),
            taskId: this.readString(task.sessionContext?.orchestrationTaskId) || task.id,
            orchestrationRunId: this.readString(task.sessionContext?.runId),
            domainContext:
              task.sessionContext?.domainContext && typeof task.sessionContext.domainContext === 'object'
                ? (task.sessionContext.domainContext as Record<string, unknown>)
                : undefined,
            collaborationContext:
              task.sessionContext?.collaborationContext && typeof task.sessionContext.collaborationContext === 'object'
                ? (task.sessionContext.collaborationContext as Record<string, unknown>)
                : undefined,
          },
          runtimeRouting: {
            taskType: this.resolveRuntimeTaskType(task.prompt, task.sessionContext),
            preferredChannel: this.resolvePreferredExecutionChannel(task.sessionContext),
            source: 'agent_task_session_context',
          },
          opencodeRuntime: {
            endpoint: serve?.baseUrl,
            authEnable: serve?.authEnable,
          },
          runtimeLifecycle: {
            onStarted: async (runtime) => {
              await this.taskService.updateTaskState({
                taskId,
                runId: runtime.runId,
                sessionId: runtime.sessionId,
              });

              const latest = await this.taskService.getTaskById(taskId);
              if (latest?.cancelRequested) {
                await this.agentService.cancelRuntimeRun(runtime.runId, 'user_cancel');
              }

              await this.taskService.publishTaskEvent({
                id: `evt-${Date.now()}-run-started`,
                type: 'progress',
                taskId,
                runId: runtime.runId,
                sequence: 0,
                timestamp: new Date().toISOString(),
                payload: {
                  step: 'runtime.started',
                  runId: runtime.runId,
                  sessionId: runtime.sessionId,
                  attempt: nextAttempt,
                },
              });
            },
            onOpenCodeSession: async (runtime) => {
              openCodeSessionId = runtime.sessionId;
              openCodeRuntimeEndpoint = runtime.endpoint;
              openCodeRuntimeAuthEnable = runtime.authEnable;
              this.logger.log(
                `[task_cancel] OpenCode session captured taskId=${taskId} sessionId=${openCodeSessionId} endpoint=${openCodeRuntimeEndpoint || 'env_default'}`,
              );
              const latest = await this.taskService.getTaskById(taskId);
              if (latest?.cancelRequested && openCodeSessionId) {
                this.logger.log(
                  `[task_cancel] immediate abort after session ready taskId=${taskId} sessionId=${openCodeSessionId} endpoint=${openCodeRuntimeEndpoint || 'env_default'}`,
                );
                await this.agentService.cancelOpenCodeSession(openCodeSessionId, {
                  endpoint: openCodeRuntimeEndpoint,
                  authEnable: openCodeRuntimeAuthEnable,
                });
              }
            },
          },
        },
      );

      const onStepTimeout = async () => {
        const latestRun = await this.taskService.getTaskById(taskId);
        if (latestRun?.runId) {
          await this.agentService.cancelRuntimeRun(latestRun.runId, 'step_timeout_cancel');
        }
      };

      const executePromise = isOpenCodeChannel
        ? this.withActivityAwareTimeout(taskExecutionPromise, {
            inactivityTimeoutMs: this.opencodeInactivityTimeoutMs,
            absoluteTimeoutMs: Math.max(stepTimeoutMs, this.opencodeAbsoluteTimeoutMs),
            pollIntervalMs: this.opencodeActivityPollIntervalMs,
            checkActivity: async () => {
              if (!openCodeSessionId) {
                return true;
              }
              const status = await this.openCodeAdapter.getSessionStatus(openCodeSessionId, {
                baseUrl: openCodeRuntimeEndpoint || serve?.baseUrl,
                authEnable: openCodeRuntimeAuthEnable ?? serve?.authEnable,
              });
              this.logger.debug(
                `[activity_check] taskId=${taskId} sessionId=${openCodeSessionId} active=${status.active} lastActivityAt=${status.lastActivityAt || 'n/a'}`,
              );
              return status.active;
            },
            onTimeout: onStepTimeout,
          })
        : this.withStepTimeout(taskExecutionPromise, stepTimeoutMs, onStepTimeout);

      const cancelWatch = { active: true };
      void this.waitForTaskCancellation(taskId, cancelWatch, async () => {
        if (openCodeSessionId) {
          this.logger.log(
            `[task_cancel] request OpenCode abort taskId=${taskId} sessionId=${openCodeSessionId} endpoint=${openCodeRuntimeEndpoint || 'env_default'}`,
          );
          await this.agentService.cancelOpenCodeSession(openCodeSessionId, {
            endpoint: openCodeRuntimeEndpoint,
            authEnable: openCodeRuntimeAuthEnable,
          });
        }
      });
      const executeResult = await (async () => {
        try {
          return await executePromise;
        } finally {
          cancelWatch.active = false;
        }
      })();

      const latestTask = await this.taskService.getTaskById(taskId);
      const status = latestTask?.cancelRequested ? 'cancelled' : 'succeeded';
      await this.taskService.updateTaskState({
        taskId,
        status,
        runId: executeResult.runId,
        sessionId: executeResult.sessionId,
        progress: 100,
        currentStep: status,
        resultSummary: {
          response: executeResult.response,
          responseLength: executeResult.response.length,
        },
        finishedAt: new Date(),
      });

      await this.taskService.publishTaskEvent({
        id: `evt-${Date.now()}-result`,
        type: 'result',
        taskId,
        runId: executeResult.runId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        payload: {
          status,
          response: executeResult.response,
          runId: executeResult.runId,
          sessionId: executeResult.sessionId,
          attempt: nextAttempt,
        },
      });

      // 触发 task.completed lifecycle hooks
      void this.taskService.runTaskPipeline('task.completed', {
        taskId,
        agentId: task.agentId,
        runId: executeResult.runId,
        sessionId: executeResult.sessionId,
        payload: {
          task: { id: taskId, agentId: task.agentId },
          response: executeResult.response,
          attempt: nextAttempt,
        },
      });

      await this.safeMarkAgentIdle(task.agentId, task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      const latestTask = await this.taskService.getTaskById(taskId);
      const isCancelled = Boolean(latestTask?.cancelRequested);
      const isTaskTimeout = message.includes('TASK_TIMEOUT_EXCEEDED');
      const isStepTimeout = message.includes('STEP_TIMEOUT_EXCEEDED');
      const retryable = this.isRetryableError(message) && !isTaskTimeout && !isCancelled;

      if (retryable) {
        const retry = await this.taskService.scheduleRetry(taskId);
        if (retry.scheduled) {
          await this.taskService.publishTaskEvent({
            id: `evt-${Date.now()}-retry-scheduled`,
            type: 'progress',
            taskId,
            sequence: 0,
            timestamp: new Date().toISOString(),
            payload: {
              step: 'retry_scheduled',
              reason: message,
              delayMs: retry.delayMs,
              nextRetryAt: retry.nextRetryAt?.toISOString(),
              attempt: retry.attempt,
            },
          });
          return;
        }
      }

      const status = isCancelled ? 'cancelled' : 'failed';
      const errorCode = isCancelled
        ? 'cancelled'
        : isTaskTimeout
          ? 'task_timeout'
          : isStepTimeout
            ? 'step_timeout'
            : 'runtime_error';

      await this.taskService.updateTaskState({
        taskId,
        status,
        errorCode,
        errorMessage: message,
        progress: 100,
        currentStep: status,
        finishedAt: new Date(),
      });

      await this.taskService.publishTaskEvent({
        id: `evt-${Date.now()}-error`,
        type: 'error',
        taskId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        payload: {
          status,
          error: message,
          errorCode,
        },
      });

      // 触发 task.failed lifecycle hooks
      void this.taskService.runTaskPipeline('task.failed', {
        taskId,
        agentId: task.agentId,
        payload: {
          task: { id: taskId, agentId: task.agentId },
          error: message,
          errorCode,
          attempt: nextAttempt,
        },
      });

      await this.safeMarkAgentIdle(task.agentId, task.id);
    } finally {
      if (serveId) {
        this.serveRouter.markServeRelease(serveId);
      }
    }
  }

  private async safeMarkAgentIdle(agentId: string, taskId: string): Promise<void> {
    try {
      await this.taskService.markAgentTaskToolIdle(agentId, taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[agent_runtime_status] failed to set idle taskId=${taskId} agentId=${agentId}: ${message}`);
    }
  }

  private isRetryableError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('cancel')) return false;
    if (normalized.includes('auth')) return false;
    if (normalized.includes('permission')) return false;
    return (
      normalized.includes('timeout') ||
      normalized.includes('econnreset') ||
      normalized.includes('etimedout') ||
      normalized.includes('429') ||
      normalized.includes('5xx') ||
      normalized.includes('network')
    );
  }

  private async withStepTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout: () => Promise<void>,
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            void onTimeout().catch(() => undefined);
            reject(new Error('STEP_TIMEOUT_EXCEEDED'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async withActivityAwareTimeout<T>(
    promise: Promise<T>,
    options: {
      inactivityTimeoutMs: number;
      absoluteTimeoutMs: number;
      pollIntervalMs?: number;
      checkActivity: () => Promise<boolean>;
      onTimeout: () => Promise<void>;
    },
  ): Promise<T> {
    const {
      inactivityTimeoutMs,
      absoluteTimeoutMs,
      pollIntervalMs = 30000,
      checkActivity,
      onTimeout,
    } = options;

    let lastActivityAt = Date.now();
    let settled = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let absoluteTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      settled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (absoluteTimer) {
        clearTimeout(absoluteTimer);
        absoluteTimer = null;
      }
    };

    return new Promise<T>((resolve, reject) => {
      absoluteTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        cleanup();
        void onTimeout().catch(() => undefined);
        reject(new Error('STEP_TIMEOUT_EXCEEDED'));
      }, absoluteTimeoutMs);

      pollTimer = setInterval(() => {
        if (settled) {
          return;
        }

        void (async () => {
          try {
            const active = await checkActivity();
            if (active) {
              lastActivityAt = Date.now();
            }
          } catch {
            lastActivityAt = Date.now();
          }

          if (Date.now() - lastActivityAt > inactivityTimeoutMs) {
            cleanup();
            void onTimeout().catch(() => undefined);
            reject(new Error('STEP_TIMEOUT_EXCEEDED'));
          }
        })();
      }, pollIntervalMs);

      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private async waitForTaskCancellation(
    taskId: string,
    watch: { active: boolean },
    onCancel?: () => Promise<void>,
  ): Promise<{ runId?: string; sessionId?: string } | null> {
    return new Promise<{ runId?: string; sessionId?: string } | null>((resolve) => {
      let settled = false;
      let pollTimer: NodeJS.Timeout | null = null;
      let watchTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        this.taskService.cancelEmitter.removeAllListeners(`cancel:${taskId}`);
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        if (watchTimer) { clearInterval(watchTimer as unknown as NodeJS.Timeout); watchTimer = null; }
      };

      const handleCancel = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        const latest = await this.taskService.getTaskById(taskId);
        if (!latest?.cancelRequested) {
          resolve(null);
          return;
        }
        await onCancel?.();
        if (latest.runId) {
          await this.agentService.cancelRuntimeRun(latest.runId, 'user_cancel');
        }
        resolve({ runId: latest.runId, sessionId: latest.sessionId });
      };

      const settle = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      };

      // 1. EventEmitter — instant notification from cancelTask
      this.taskService.cancelEmitter.once(`cancel:${taskId}`, () => void handleCancel());

      // 2. Polling fallback — in case the event was missed
      const poll = async () => {
        if (settled || !watch.active || !this.running) { settle(); return; }
        const latest = await this.taskService.getTaskById(taskId);
        if (!latest) { settle(); return; }
        if (latest.cancelRequested) { void handleCancel(); return; }
        pollTimer = setTimeout(() => void poll(), this.cancelPollIntervalMs);
      };

      // 3. Watch guard — exit when execution finishes (watch.active set to false)
      watchTimer = setInterval(() => {
        if (!watch.active || !this.running) { settle(); }
      }, 200) as unknown as NodeJS.Timeout;

      void poll();
    });
  }

  private startRetryScheduler(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
    }
    this.retryTimer = setInterval(() => {
      void this.flushDueRetries();
    }, 1000);
  }

  private async flushDueRetries(): Promise<void> {
    const due = await this.taskService.listDueRetries(50);
    for (const task of due) {
      const enqueued = await this.taskService.enqueueRetry(task.id);
      if (!enqueued) {
        continue;
      }
      await this.taskService.publishTaskEvent({
        id: `evt-${Date.now()}-retry-started-${task.id}`,
        type: 'progress',
        taskId: task.id,
        runId: task.runId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        payload: {
          step: 'retry_started',
          attempt: task.attempt,
        },
      });
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveRuntimeTaskType(prompt: string, sessionContext?: Record<string, unknown>): string {
    const fromContext =
      this.readString(sessionContext?.runtimeTaskType) || this.readString(sessionContext?.taskType) || undefined;
    if (fromContext) {
      return fromContext.toLowerCase();
    }

    const text = String(prompt || '').toLowerCase();
    if (
      text.includes('code') ||
      text.includes('implement') ||
      text.includes('fix') ||
      text.includes('refactor') ||
      text.includes('开发') ||
      text.includes('编码') ||
      text.includes('修复')
    ) {
      return 'development';
    }

    return 'general';
  }

  private resolvePreferredExecutionChannel(sessionContext?: Record<string, unknown>): 'native' | 'opencode' | undefined {
    const candidate =
      this.readString(sessionContext?.runtimeChannelHint) || this.readString(sessionContext?.preferredRuntimeChannel);
    if (!candidate) {
      return undefined;
    }
    const normalized = candidate.toLowerCase();
    if (normalized === 'native' || normalized === 'opencode') {
      return normalized;
    }
    return undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
