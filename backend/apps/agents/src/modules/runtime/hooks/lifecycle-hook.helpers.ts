import { Type } from '@nestjs/common';

import { LifecycleHook, LIFECYCLE_HOOKS_TOKEN } from './lifecycle-hook.types';

/**
 * 辅助函数：将一个 LifecycleHook 实现类注册为 NestJS multi provider。
 *
 * 用法：
 * ```typescript
 * providers: [
 *   provideLifecycleHook(MyBeforeStepHook),
 *   provideLifecycleHook(MyAfterStepHook),
 * ]
 * ```
 */
export function provideLifecycleHook(hookClass: Type<LifecycleHook>) {
  return {
    provide: LIFECYCLE_HOOKS_TOKEN,
    useClass: hookClass,
    multi: true,
  };
}
