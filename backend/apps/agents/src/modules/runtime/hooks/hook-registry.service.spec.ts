import { Test, TestingModule } from '@nestjs/testing';
import { HookRegistryService } from './hook-registry.service';
import { LifecycleHook, LifecycleHookContext, LifecycleHookResult, LIFECYCLE_HOOKS_TOKEN } from './lifecycle-hook.types';

const createMockHook = (overrides: Partial<LifecycleHook> = {}): LifecycleHook => ({
  id: 'test.hook',
  phases: ['step.before'],
  priority: 100,
  matches: () => true,
  execute: async () => ({ action: 'continue' }),
  ...overrides,
});

describe('HookRegistryService', () => {
  let registry: HookRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HookRegistryService,
        { provide: LIFECYCLE_HOOKS_TOKEN, useValue: [] },
      ],
    }).compile();

    registry = module.get(HookRegistryService);
    registry.onModuleInit();
  });

  it('should start empty when no hooks discovered', () => {
    expect(registry.size).toBe(0);
    expect(registry.listAll()).toEqual([]);
  });

  it('should register and retrieve a hook', () => {
    const hook = createMockHook({ id: 'test.a', phases: ['step.before'] });
    registry.register(hook);

    expect(registry.has('test.a')).toBe(true);
    expect(registry.size).toBe(1);

    const hooks = registry.getHooksForPhase('step.before');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe('test.a');
  });

  it('should unregister a hook', () => {
    registry.register(createMockHook({ id: 'test.a' }));
    expect(registry.has('test.a')).toBe(true);

    const removed = registry.unregister('test.a');
    expect(removed).toBe(true);
    expect(registry.has('test.a')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('should return false when unregistering non-existent hook', () => {
    expect(registry.unregister('non-existent')).toBe(false);
  });

  it('should filter hooks by phase', () => {
    registry.register(createMockHook({ id: 'step.hook', phases: ['step.before'] }));
    registry.register(createMockHook({ id: 'tool.hook', phases: ['toolcall.pending'] }));

    expect(registry.getHooksForPhase('step.before')).toHaveLength(1);
    expect(registry.getHooksForPhase('toolcall.pending')).toHaveLength(1);
    expect(registry.getHooksForPhase('task.created')).toHaveLength(0);
  });

  it('should sort hooks by priority (ascending)', () => {
    registry.register(createMockHook({ id: 'low', phases: ['step.before'], priority: 200 }));
    registry.register(createMockHook({ id: 'high', phases: ['step.before'], priority: 10 }));
    registry.register(createMockHook({ id: 'mid', phases: ['step.before'], priority: 100 }));

    const hooks = registry.getHooksForPhase('step.before');
    expect(hooks.map((h) => h.id)).toEqual(['high', 'mid', 'low']);
  });

  it('should exclude disabled hooks', () => {
    registry.register(createMockHook({ id: 'enabled', phases: ['step.before'], enabled: true }));
    registry.register(createMockHook({ id: 'disabled', phases: ['step.before'], enabled: false }));

    const hooks = registry.getHooksForPhase('step.before');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe('enabled');
  });

  it('should support multi-phase hooks', () => {
    registry.register(createMockHook({ id: 'multi', phases: ['step.before', 'step.after'] }));

    expect(registry.getHooksForPhase('step.before')).toHaveLength(1);
    expect(registry.getHooksForPhase('step.after')).toHaveLength(1);
  });

  it('should overwrite hook with same id', () => {
    registry.register(createMockHook({ id: 'dup', phases: ['step.before'], priority: 50 }));
    registry.register(createMockHook({ id: 'dup', phases: ['step.after'], priority: 200 }));

    expect(registry.size).toBe(1);
    const all = registry.listAll();
    expect(all[0].phases).toEqual(['step.after']);
    expect(all[0].priority).toBe(200);
  });

  it('should auto-register discovered hooks on init', async () => {
    const discovered = [
      createMockHook({ id: 'auto.a', phases: ['step.before'] }),
      createMockHook({ id: 'auto.b', phases: ['toolcall.completed'] }),
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HookRegistryService,
        { provide: LIFECYCLE_HOOKS_TOKEN, useValue: discovered },
      ],
    }).compile();

    const reg = module.get(HookRegistryService);
    reg.onModuleInit();

    expect(reg.size).toBe(2);
    expect(reg.has('auto.a')).toBe(true);
    expect(reg.has('auto.b')).toBe(true);
  });

  it('should ignore hook without id', () => {
    registry.register({ id: '', phases: ['step.before'], priority: 100, matches: () => true, execute: async () => ({ action: 'continue' }) });
    expect(registry.size).toBe(0);
  });

  it('listAll should return all hooks with correct metadata', () => {
    registry.register(createMockHook({ id: 'x', phases: ['step.before', 'toolcall.pending'], priority: 42 }));

    const all = registry.listAll();
    expect(all).toEqual([
      { id: 'x', phases: ['step.before', 'toolcall.pending'], priority: 42, enabled: true },
    ]);
  });
});
