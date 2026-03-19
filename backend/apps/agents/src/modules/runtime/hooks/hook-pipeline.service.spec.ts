import { Test, TestingModule } from '@nestjs/testing';
import { HookPipelineService } from './hook-pipeline.service';
import { HookRegistryService } from './hook-registry.service';
import { LifecycleHook, LifecycleHookContext, LifecycleHookResult, LIFECYCLE_HOOKS_TOKEN } from './lifecycle-hook.types';

const buildContext = (overrides: Partial<LifecycleHookContext> = {}): LifecycleHookContext => ({
  phase: 'step.before',
  runId: 'run-1',
  agentId: 'agent-1',
  traceId: 'trace-1',
  timestamp: Date.now(),
  payload: {},
  ...overrides,
});

const createMockHook = (overrides: Partial<LifecycleHook> & { id: string }): LifecycleHook => ({
  phases: ['step.before'],
  priority: 100,
  matches: () => true,
  execute: async () => ({ action: 'continue' }),
  ...overrides,
});

describe('HookPipelineService', () => {
  let pipeline: HookPipelineService;
  let registry: HookRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HookRegistryService,
        HookPipelineService,
        { provide: LIFECYCLE_HOOKS_TOKEN, useValue: [] },
      ],
    }).compile();

    registry = module.get(HookRegistryService);
    pipeline = module.get(HookPipelineService);
    registry.onModuleInit();
  });

  it('should return empty result when no hooks registered', async () => {
    const result = await pipeline.run(buildContext());

    expect(result.aborted).toBe(false);
    expect(result.executedHooks).toEqual([]);
    expect(result.skippedHooks).toEqual([]);
    expect(result.appendMessages).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should execute matching hook and return continue', async () => {
    registry.register(createMockHook({
      id: 'test.hook',
      execute: async () => ({
        action: 'continue',
        appendMessages: ['injected message'],
        metadata: { foo: 'bar' },
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.aborted).toBe(false);
    expect(result.executedHooks).toEqual(['test.hook']);
    expect(result.appendMessages).toEqual(['injected message']);
    expect(result.metadata).toEqual({ foo: 'bar' });
  });

  it('should skip hook when matches returns false', async () => {
    registry.register(createMockHook({
      id: 'skip.hook',
      matches: () => false,
    }));

    const result = await pipeline.run(buildContext());

    expect(result.executedHooks).toEqual([]);
    expect(result.skippedHooks).toEqual(['skip.hook']);
  });

  it('should abort pipeline when hook returns abort', async () => {
    const executionOrder: string[] = [];

    registry.register(createMockHook({
      id: 'first',
      priority: 10,
      execute: async () => {
        executionOrder.push('first');
        return { action: 'abort' };
      },
    }));
    registry.register(createMockHook({
      id: 'second',
      priority: 20,
      execute: async () => {
        executionOrder.push('second');
        return { action: 'continue' };
      },
    }));

    const result = await pipeline.run(buildContext());

    expect(result.aborted).toBe(true);
    expect(result.abortedBy).toBe('first');
    expect(result.executedHooks).toEqual(['first']);
    expect(executionOrder).toEqual(['first']);
  });

  it('should accumulate appendMessages from multiple hooks', async () => {
    registry.register(createMockHook({
      id: 'hook.a',
      priority: 10,
      execute: async () => ({
        action: 'continue',
        appendMessages: ['msg-a'],
      }),
    }));
    registry.register(createMockHook({
      id: 'hook.b',
      priority: 20,
      execute: async () => ({
        action: 'continue',
        appendMessages: ['msg-b', 'msg-c'],
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.appendMessages).toEqual(['msg-a', 'msg-b', 'msg-c']);
    expect(result.executedHooks).toEqual(['hook.a', 'hook.b']);
  });

  it('should propagate mutatedPayload between hooks', async () => {
    const payloadSeen: Record<string, unknown>[] = [];

    registry.register(createMockHook({
      id: 'mutator',
      priority: 10,
      execute: async (ctx) => {
        payloadSeen.push({ ...ctx.payload });
        return {
          action: 'continue',
          mutatedPayload: { injected: true },
        };
      },
    }));
    registry.register(createMockHook({
      id: 'reader',
      priority: 20,
      execute: async (ctx) => {
        payloadSeen.push({ ...ctx.payload });
        return { action: 'continue' };
      },
    }));

    const result = await pipeline.run(buildContext({ payload: { original: 'data' } }));

    // First hook sees original payload
    expect(payloadSeen[0]).toEqual({ original: 'data' });
    // Second hook sees mutated payload
    expect(payloadSeen[1]).toEqual({ original: 'data', injected: true });
    // Final payload includes all mutations
    expect(result.finalPayload).toEqual({ original: 'data', injected: true });
  });

  it('should not block pipeline when hook throws error', async () => {
    registry.register(createMockHook({
      id: 'error.hook',
      priority: 10,
      execute: async () => {
        throw new Error('hook exploded');
      },
    }));
    registry.register(createMockHook({
      id: 'safe.hook',
      priority: 20,
      execute: async () => ({
        action: 'continue',
        appendMessages: ['survived'],
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.aborted).toBe(false);
    expect(result.executedHooks).toEqual(['safe.hook']);
    expect(result.appendMessages).toEqual(['survived']);
    expect(result.metadata['error_error.hook']).toBe('hook exploded');
  });

  it('should execute hooks in priority order', async () => {
    const order: string[] = [];

    registry.register(createMockHook({
      id: 'c',
      priority: 300,
      execute: async () => { order.push('c'); return { action: 'continue' }; },
    }));
    registry.register(createMockHook({
      id: 'a',
      priority: 100,
      execute: async () => { order.push('a'); return { action: 'continue' }; },
    }));
    registry.register(createMockHook({
      id: 'b',
      priority: 200,
      execute: async () => { order.push('b'); return { action: 'continue' }; },
    }));

    await pipeline.run(buildContext());
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('should filter empty/whitespace appendMessages', async () => {
    registry.register(createMockHook({
      id: 'filter.hook',
      execute: async () => ({
        action: 'continue',
        appendMessages: ['valid', '', '  ', 'also valid'],
      }),
    }));

    const result = await pipeline.run(buildContext());
    expect(result.appendMessages).toEqual(['valid', 'also valid']);
  });

  it('should handle skip action without blocking pipeline', async () => {
    const order: string[] = [];

    registry.register(createMockHook({
      id: 'skipper',
      priority: 10,
      execute: async () => {
        order.push('skipper');
        return { action: 'skip' };
      },
    }));
    registry.register(createMockHook({
      id: 'follower',
      priority: 20,
      execute: async () => {
        order.push('follower');
        return { action: 'continue' };
      },
    }));

    const result = await pipeline.run(buildContext());
    expect(order).toEqual(['skipper', 'follower']);
    expect(result.aborted).toBe(false);
    expect(result.executedHooks).toEqual(['skipper', 'follower']);
  });

  // ---- pause/cancel/retry 控制指令测试 ----

  it('should set pauseRequested when hook returns pause action', async () => {
    registry.register(createMockHook({
      id: 'pauser',
      execute: async () => ({
        action: 'pause',
        reason: 'anomaly detected',
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.pauseRequested).toBe(true);
    expect(result.pauseRequestedBy).toBe('pauser');
    expect(result.pauseReason).toBe('anomaly detected');
    expect(result.aborted).toBe(false);
    expect(result.cancelRequested).toBe(false);
  });

  it('should stop pipeline and set cancelRequested when hook returns cancel', async () => {
    const order: string[] = [];

    registry.register(createMockHook({
      id: 'canceller',
      priority: 10,
      execute: async () => {
        order.push('canceller');
        return { action: 'cancel', reason: 'fatal error' };
      },
    }));
    registry.register(createMockHook({
      id: 'afterCancel',
      priority: 20,
      execute: async () => {
        order.push('afterCancel');
        return { action: 'continue' };
      },
    }));

    const result = await pipeline.run(buildContext());

    expect(result.cancelRequested).toBe(true);
    expect(result.cancelRequestedBy).toBe('canceller');
    expect(result.cancelReason).toBe('fatal error');
    // cancel 应中止 pipeline，后续 hooks 不执行
    expect(order).toEqual(['canceller']);
    expect(result.executedHooks).toEqual(['canceller']);
  });

  it('should set retryRequested when hook returns retry action', async () => {
    registry.register(createMockHook({
      id: 'retrier',
      execute: async () => ({
        action: 'retry',
        appendMessages: ['please try again with more context'],
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.retryRequested).toBe(true);
    expect(result.retryRequestedBy).toBe('retrier');
    expect(result.appendMessages).toEqual(['please try again with more context']);
  });

  it('pause does not stop pipeline, subsequent hooks still execute', async () => {
    const order: string[] = [];

    registry.register(createMockHook({
      id: 'pauser',
      priority: 10,
      execute: async () => {
        order.push('pauser');
        return { action: 'pause', reason: 'warning' };
      },
    }));
    registry.register(createMockHook({
      id: 'follower',
      priority: 20,
      execute: async () => {
        order.push('follower');
        return { action: 'continue', appendMessages: ['extra'] };
      },
    }));

    const result = await pipeline.run(buildContext());

    expect(order).toEqual(['pauser', 'follower']);
    expect(result.pauseRequested).toBe(true);
    expect(result.appendMessages).toEqual(['extra']);
  });

  it('should accumulate messageFilters from hooks', async () => {
    registry.register(createMockHook({
      id: 'filter.hook',
      execute: async () => ({
        action: 'continue',
        messageFilters: [
          { type: 'remove', matchRole: 'system', matchContentContains: 'deprecated' },
        ],
      }),
    }));

    const result = await pipeline.run(buildContext());

    expect(result.messageFilters).toHaveLength(1);
    expect(result.messageFilters[0].type).toBe('remove');
  });

  // ---- applyMessageFilters 静态方法测试 ----

  it('applyMessageFilters should remove matching messages', () => {
    const messages = [
      { role: 'system', content: 'keep this' },
      { role: 'system', content: 'deprecated instruction' },
      { role: 'user', content: 'hello' },
    ];

    const filtered = HookPipelineService.applyMessageFilters(messages, [
      { type: 'remove', matchRole: 'system', matchContentContains: 'deprecated' },
    ]);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.content)).toEqual(['keep this', 'hello']);
  });

  it('applyMessageFilters should replace matching message content', () => {
    const messages = [
      { role: 'system', content: 'old instruction v1' },
      { role: 'user', content: 'hello' },
    ];

    const filtered = HookPipelineService.applyMessageFilters(messages, [
      { type: 'replace', matchRole: 'system', matchContentContains: 'old instruction', replaceContent: 'new instruction v2' },
    ]);

    expect(filtered[0].content).toBe('new instruction v2');
    expect(filtered[1].content).toBe('hello');
  });

  it('applyMessageFilters should support regex matching', () => {
    const messages = [
      { role: 'system', content: 'round 1/5 context' },
      { role: 'system', content: 'round 2/5 context' },
      { role: 'user', content: 'task input' },
    ];

    const filtered = HookPipelineService.applyMessageFilters(messages, [
      { type: 'remove', matchContentPattern: 'round \\d+/\\d+ context' },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].content).toBe('task input');
  });

  it('applyMessageFilters should return unchanged array when no filters', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const filtered = HookPipelineService.applyMessageFilters(messages, []);
    expect(filtered).toEqual(messages);
  });
});
