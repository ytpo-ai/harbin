import { createServiceLogger } from '@libs/common';
import type { MessageAdapter, AdapterType } from './message-adapter.port';
import { TopicRegistry } from './topic-registry';
import type { TopicConfig } from './topic-registry';

/**
 * TopicRouter：按 topic 名称路由到对应的 adapter 实例。
 *
 * - 读取 TopicRegistry 获取 topic 配置
 * - 按 config.adapter 字段匹配已注册的 MessageAdapter
 * - 在 publish / subscribe 时返回 { adapter, config } 供 MessageBusService 调用
 */
export class TopicRouterService {
  private readonly logger = createServiceLogger('TopicRouter');
  private readonly adapters = new Map<AdapterType, MessageAdapter>();

  constructor(private readonly registry: TopicRegistry) {}

  /** 注册一个适配器实例 */
  registerAdapter(adapter: MessageAdapter): void {
    this.adapters.set(adapter.type, adapter);
    this.logger.log(`Adapter registered: ${adapter.type}`);
  }

  /**
   * 根据 topic 名称解析出 adapter + config。
   * 如果 topic 未注册或 adapter 未注册，抛出错误。
   */
  resolve(topicName: string): { adapter: MessageAdapter; config: TopicConfig } {
    const config = this.registry.get(topicName);
    if (!config) {
      throw new Error(`[TopicRouter] Unknown topic "${topicName}". Register it in TopicRegistry first.`);
    }

    const adapter = this.adapters.get(config.adapter);
    if (!adapter) {
      throw new Error(
        `[TopicRouter] No adapter registered for type "${config.adapter}" (topic "${topicName}"). ` +
          `Available adapters: [${Array.from(this.adapters.keys()).join(', ')}]`,
      );
    }

    return { adapter, config };
  }

  /** 获取所有已注册 adapter 的健康状态 */
  async healthCheck(): Promise<
    Array<{ type: AdapterType; healthy: boolean; details?: string }>
  > {
    const results: Array<{ type: AdapterType; healthy: boolean; details?: string }> = [];
    for (const [type, adapter] of this.adapters) {
      const status = await adapter.healthCheck();
      results.push({ type, ...status });
    }
    return results;
  }

  /** 获取 TopicRegistry 引用（供外部查询 topic 列表） */
  getRegistry(): TopicRegistry {
    return this.registry;
  }
}
