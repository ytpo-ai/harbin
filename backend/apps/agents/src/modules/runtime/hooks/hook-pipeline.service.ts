import { Injectable, Logger } from '@nestjs/common';

import { HookRegistryService } from './hook-registry.service';
import { LifecycleHookContext, MessageFilter } from './lifecycle-hook.types';

export interface PipelineResult {
  /** 是否被中止（abort action） */
  aborted: boolean;
  /** 中止的 hook id */
  abortedBy?: string;
  /** 累积的 system messages */
  appendMessages: string[];
  /** 累积的消息过滤规则 */
  messageFilters: MessageFilter[];
  /** 最终载荷（经过 hooks 修改） */
  finalPayload: Record<string, unknown>;
  /** 实际执行的 hook id 列表 */
  executedHooks: string[];
  /** matches=false 跳过的 hook id 列表 */
  skippedHooks: string[];
  /** 累积元数据 */
  metadata: Record<string, unknown>;
  /** pipeline 总耗时 ms */
  durationMs: number;
  /** 控制指令：是否请求暂停 run */
  pauseRequested: boolean;
  /** 暂停请求来源 hook id */
  pauseRequestedBy?: string;
  /** 暂停原因 */
  pauseReason?: string;
  /** 控制指令：是否请求取消 task/run */
  cancelRequested: boolean;
  /** 取消请求来源 hook id */
  cancelRequestedBy?: string;
  /** 取消原因 */
  cancelReason?: string;
  /** 控制指令：是否请求重试当前 step */
  retryRequested: boolean;
  /** 重试请求来源 hook id */
  retryRequestedBy?: string;
}

@Injectable()
export class HookPipelineService {
  private readonly logger = new Logger(HookPipelineService.name);

  constructor(private readonly registry: HookRegistryService) {}

  /**
   * 按优先级串行执行该阶段所有已注册 hooks。
   *
   * - matches=false 的 hook 自动跳过
   * - abort: 停止后续 hooks 执行
   * - pause: 标记 pauseRequested，继续执行后续 hooks（收集完所有指令后由调用方处理）
   * - cancel: 标记 cancelRequested，停止后续 hooks 执行（取消优先级最高）
   * - retry: 标记 retryRequested，继续执行后续 hooks
   * - appendMessages / messageFilters / mutatedPayload 累积传递
   * - 单个 hook 异常不阻塞 pipeline
   */
  async run(context: LifecycleHookContext): Promise<PipelineResult> {
    const startAt = Date.now();
    const hooks = this.registry.getHooksForPhase(context.phase);

    const result: PipelineResult = {
      aborted: false,
      appendMessages: [],
      messageFilters: [],
      finalPayload: { ...context.payload },
      executedHooks: [],
      skippedHooks: [],
      metadata: {},
      durationMs: 0,
      pauseRequested: false,
      cancelRequested: false,
      retryRequested: false,
    };

    if (hooks.length === 0) {
      result.durationMs = Date.now() - startAt;
      return result;
    }

    // 可变上下文：后续 hooks 看到前序 hooks 的 payload 修改
    const mutableContext: LifecycleHookContext = {
      ...context,
      payload: { ...context.payload },
    };

    for (const hook of hooks) {
      try {
        const matched = await hook.matches(mutableContext);
        if (!matched) {
          result.skippedHooks.push(hook.id);
          continue;
        }

        const hookStartAt = Date.now();
        const hookResult = await hook.execute(mutableContext);
        const hookDuration = Date.now() - hookStartAt;
        result.executedHooks.push(hook.id);

        this.logger.debug(
          `[hook_pipeline] phase=${context.phase} hook=${hook.id} action=${hookResult.action} durationMs=${hookDuration}`,
        );

        // 累积 appendMessages
        if (hookResult.appendMessages?.length) {
          result.appendMessages.push(
            ...hookResult.appendMessages.map((m) => String(m || '').trim()).filter(Boolean),
          );
        }

        // 累积 messageFilters
        if (hookResult.messageFilters?.length) {
          result.messageFilters.push(...hookResult.messageFilters);
        }

        // 合并 mutatedPayload 到可变上下文
        if (hookResult.mutatedPayload) {
          Object.assign(mutableContext.payload, hookResult.mutatedPayload);
        }

        // 合并 metadata
        if (hookResult.metadata) {
          Object.assign(result.metadata, hookResult.metadata);
        }

        // 处理控制指令
        const { action } = hookResult;

        if (action === 'abort') {
          result.aborted = true;
          result.abortedBy = hook.id;
          break;
        }

        if (action === 'cancel') {
          result.cancelRequested = true;
          result.cancelRequestedBy = result.cancelRequestedBy || hook.id;
          result.cancelReason = result.cancelReason || hookResult.reason || `cancelled by hook ${hook.id}`;
          // cancel 优先级最高，立即中止 pipeline
          break;
        }

        if (action === 'pause' && !result.pauseRequested) {
          result.pauseRequested = true;
          result.pauseRequestedBy = hook.id;
          result.pauseReason = hookResult.reason || `paused by hook ${hook.id}`;
          // pause 不中止 pipeline，继续收集后续指令
        }

        if (action === 'retry' && !result.retryRequested) {
          result.retryRequested = true;
          result.retryRequestedBy = hook.id;
          // retry 不中止 pipeline，继续收集后续指令
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[hook_pipeline_error] phase=${context.phase} hook=${hook.id} error=${message}`,
        );
        // hook 执行失败不阻塞 pipeline，记录并继续
        result.metadata[`error_${hook.id}`] = message;
      }
    }

    result.finalPayload = { ...mutableContext.payload };
    result.durationMs = Date.now() - startAt;

    if (result.executedHooks.length > 0) {
      const controlFlags = [
        result.aborted ? 'aborted' : '',
        result.pauseRequested ? 'pause' : '',
        result.cancelRequested ? 'cancel' : '',
        result.retryRequested ? 'retry' : '',
      ].filter(Boolean).join(',');
      this.logger.debug(
        `[hook_pipeline_done] phase=${context.phase} executed=${result.executedHooks.length} skipped=${result.skippedHooks.length} controls=${controlFlags || 'none'} durationMs=${result.durationMs}`,
      );
    }

    return result;
  }

  /**
   * 应用消息过滤规则到消息数组。
   * 调用方在拿到 PipelineResult 后，可使用此方法对 messages 执行 filter/replace。
   */
  static applyMessageFilters<T extends { role?: string; content?: string }>(
    messages: T[],
    filters: MessageFilter[],
  ): T[] {
    if (!filters.length) return messages;

    let result = [...messages];

    for (const filter of filters) {
      if (filter.type === 'remove') {
        result = result.filter((msg) => !matchesFilter(msg, filter));
      } else if (filter.type === 'replace') {
        result = result.map((msg) => {
          if (matchesFilter(msg, filter) && filter.replaceContent !== undefined) {
            return { ...msg, content: filter.replaceContent };
          }
          return msg;
        });
      }
    }

    return result;
  }
}

function matchesFilter(
  msg: { role?: string; content?: string },
  filter: MessageFilter,
): boolean {
  if (filter.matchRole && msg.role !== filter.matchRole) return false;

  const content = String(msg.content || '');

  if (filter.matchContentContains) {
    if (!content.includes(filter.matchContentContains)) return false;
  }

  if (filter.matchContentPattern) {
    try {
      const regex = new RegExp(filter.matchContentPattern);
      if (!regex.test(content)) return false;
    } catch {
      return false;
    }
  }

  return true;
}
