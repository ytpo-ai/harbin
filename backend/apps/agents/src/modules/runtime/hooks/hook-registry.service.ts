import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import {
  LifecycleHook,
  LifecyclePhase,
  LIFECYCLE_HOOKS_TOKEN,
} from './lifecycle-hook.types';

@Injectable()
export class HookRegistryService implements OnModuleInit {
  private readonly logger = new Logger(HookRegistryService.name);
  private readonly hooks = new Map<string, LifecycleHook>();

  constructor(
    @Optional()
    @Inject(LIFECYCLE_HOOKS_TOKEN)
    private readonly discoveredHooks: LifecycleHook[] = [],
  ) {}

  onModuleInit(): void {
    const discovered = Array.isArray(this.discoveredHooks) ? this.discoveredHooks : [];
    for (const hook of discovered) {
      this.register(hook);
    }
    this.logger.log(
      `[hook_registry_init] registered=${this.hooks.size} hooks=[${[...this.hooks.keys()].join(', ')}]`,
    );
  }

  /** 注册一个生命周期 hook */
  register(hook: LifecycleHook): void {
    if (!hook?.id) {
      this.logger.warn('[hook_registry] attempted to register hook without id, ignored');
      return;
    }
    if (this.hooks.has(hook.id)) {
      this.logger.warn(`[hook_registry] duplicate hookId=${hook.id}, overwriting`);
    }
    this.hooks.set(hook.id, hook);
    this.logger.debug(
      `[hook_registry] registered hookId=${hook.id} phases=[${hook.phases.join(',')}] priority=${hook.priority}`,
    );
  }

  /** 注销一个生命周期 hook */
  unregister(hookId: string): boolean {
    const removed = this.hooks.delete(hookId);
    if (removed) {
      this.logger.debug(`[hook_registry] unregistered hookId=${hookId}`);
    }
    return removed;
  }

  /** 按阶段获取匹配的 hooks（优先级升序） */
  getHooksForPhase(phase: LifecyclePhase): LifecycleHook[] {
    return [...this.hooks.values()]
      .filter((h) => h.enabled !== false && h.phases.includes(phase))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /** 检查某 hook 是否已注册 */
  has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  /** 列出所有已注册 hooks（运维可观测） */
  listAll(): Array<{ id: string; phases: LifecyclePhase[]; priority: number; enabled: boolean }> {
    return [...this.hooks.values()].map((h) => ({
      id: h.id,
      phases: h.phases,
      priority: h.priority ?? 100,
      enabled: h.enabled !== false,
    }));
  }

  /** 当前注册数量 */
  get size(): number {
    return this.hooks.size;
  }
}
