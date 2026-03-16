import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentTaskService } from './agent-task.service';
import { AgentService } from '../agents/agent.service';
import { Task as RuntimeTask } from '../../../../../src/shared/types';
import { OpenCodeServeRouterService } from './opencode-serve-router.service';

@Injectable()
export class AgentTaskWorker implements OnModuleInit {
  private readonly logger = new Logger(AgentTaskWorker.name);
  private running = false;
  private readonly maxConcurrency = Math.max(1, Number(process.env.AGENT_TASK_WORKER_CONCURRENCY || 2));
  private readonly cancelPollIntervalMs = Math.max(200, Number(process.env.AGENT_TASK_CANCEL_POLL_INTERVAL_MS || 500));
  private activeCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly taskService: AgentTaskService,
    private readonly agentService: AgentService,
    private readonly serveRouter: OpenCodeServeRouterService,
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

      const freshTask = await this.taskService.getTaskById(taskId);
      const now = Date.now();
      const startedAtMs = freshTask?.startedAt ? new Date(freshTask.startedAt).getTime() : now;
      const taskTimeoutMs = Math.max(1000, Number(freshTask?.taskTimeoutMs || 1200000));
      const stepTimeoutMs = Math.max(1000, Number(freshTask?.stepTimeoutMs || 120000));
      if (now - startedAtMs > taskTimeoutMs) {
        throw new Error('TASK_TIMEOUT_EXCEEDED');
      }

      const runtimeTask: RuntimeTask = {
        id: task.id,
        title: `Agent Task ${task.id}`,
        description: task.prompt,
        type: 'agent_task',
        priority: 'medium',
        status: 'pending',
        assignedAgents: [task.agentId],
        teamId: 'agent-task',
        messages: [],
      };

      let openCodeSessionId: string | undefined;
      let openCodeRuntimeEndpoint: string | undefined;
      let openCodeRuntimeAuthEnable: boolean | undefined;
      const executePromise = this.withStepTimeout(
        this.agentService.executeTaskWithStreaming(
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
                  await this.agentService.cancelRuntimeRun(runtime.runId);
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
        ),
        stepTimeoutMs,
        async () => {
          const latestRun = await this.taskService.getTaskById(taskId);
          if (latestRun?.runId) {
            await this.agentService.cancelRuntimeRun(latestRun.runId);
          }
        },
      );

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
      const hasResponse = String(executeResult.response || '').trim().length > 0;
      const status = latestTask?.cancelRequested && !hasResponse ? 'cancelled' : 'succeeded';
      await this.taskService.updateTaskState({
        taskId,
        status,
        runId: executeResult.runId,
        sessionId: executeResult.sessionId,
        progress: 100,
        currentStep: status,
        resultSummary: {
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
    } finally {
      if (serveId) {
        this.serveRouter.markServeRelease(serveId);
      }
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

  private async waitForTaskCancellation(
    taskId: string,
    watch: { active: boolean },
    onCancel?: () => Promise<void>,
  ): Promise<{ runId?: string; sessionId?: string } | null> {
    while (this.running && watch.active) {
      const latest = await this.taskService.getTaskById(taskId);
      if (!latest) {
        return null;
      }

      if (latest.cancelRequested) {
        await onCancel?.();
        if (latest.runId) {
          await this.agentService.cancelRuntimeRun(latest.runId);
        }
        return {
          runId: latest.runId,
          sessionId: latest.sessionId,
        };
      }

      await this.sleep(this.cancelPollIntervalMs);
    }

    return null;
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
}
