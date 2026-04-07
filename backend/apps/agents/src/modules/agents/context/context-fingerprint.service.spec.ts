import { ContextFingerprintService } from './context-fingerprint.service';

describe('ContextFingerprintService', () => {
  it('uses sessionContext.sessionId for scope when collaborationContext has no sessionId', () => {
    const service = new ContextFingerprintService({} as any);
    const scope = service.resolveSystemContextScope(
      { id: 'agent-1' },
      { id: 'task-1', title: 't', type: 'planning' },
      {
        collaborationContext: { planId: 'plan-1' },
        sessionContext: { sessionId: 'session-123' },
      },
    );

    expect(scope).toBe('session:session-123:agent:agent-1');
  });

  describe('resolveSystemContextBlockContent', () => {
    const createService = (redisStore: Record<string, string> = {}) => {
      const mockRedis = {
        get: jest.fn(async (key: string) => redisStore[key] || null),
        set: jest.fn(async (key: string, value: string) => {
          redisStore[key] = value;
        }),
      };
      return { service: new ContextFingerprintService(mockRedis as any), mockRedis };
    };

    it('returns fullContent on first call (no cache)', async () => {
      const { service } = createService();
      const result = await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions here',
        snapshot: { toolIds: ['t1', 't2'] },
      });
      expect(result).toBe('tool definitions here');
    });

    it('returns null when fingerprint matches and skipDedup is false', async () => {
      const store: Record<string, string> = {};
      const { service } = createService(store);

      // First call — populates cache
      await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions here',
        snapshot: { toolIds: ['t1', 't2'] },
      });

      // Second call — same fingerprint, should return null (dedup)
      const result = await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions here',
        snapshot: { toolIds: ['t1', 't2'] },
      });
      expect(result).toBeNull();
    });

    it('returns fullContent when fingerprint matches but skipDedup is true', async () => {
      const store: Record<string, string> = {};
      const { service } = createService(store);

      // First call — populates cache
      await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions here',
        snapshot: { toolIds: ['t1', 't2'] },
      });

      // Second call — same fingerprint, but skipDedup = true
      const result = await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions here',
        snapshot: { toolIds: ['t1', 't2'] },
        skipDedup: true,
      });
      expect(result).toBe('tool definitions here');
    });

    it('returns fullContent when fingerprint differs regardless of skipDedup', async () => {
      const store: Record<string, string> = {};
      const { service } = createService(store);

      // First call
      await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions v1',
        snapshot: { toolIds: ['t1'] },
      });

      // Second call — different fingerprint
      const result = await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'toolset-spec',
        fullContent: 'tool definitions v2',
        snapshot: { toolIds: ['t1', 't2'] },
      });
      expect(result).toBe('tool definitions v2');
    });

    it('returns null for empty fullContent even with skipDedup', async () => {
      const { service } = createService();
      const result = await service.resolveSystemContextBlockContent({
        scope: 'meeting:m1:agent:a1',
        blockType: 'identity-base',
        fullContent: '   ',
        snapshot: {},
        skipDedup: true,
      });
      expect(result).toBeNull();
    });

    it('skipDedup defaults to false when not provided', async () => {
      const store: Record<string, string> = {};
      const { service } = createService(store);

      // First call
      await service.resolveSystemContextBlockContent({
        scope: 'session:s1:agent:a1',
        blockType: 'identity-base',
        fullContent: 'identity content',
        snapshot: { hash: 'abc' },
      });

      // Second call — no skipDedup parameter (defaults to false/undefined)
      const result = await service.resolveSystemContextBlockContent({
        scope: 'session:s1:agent:a1',
        blockType: 'identity-base',
        fullContent: 'identity content',
        snapshot: { hash: 'abc' },
      });
      expect(result).toBeNull();
    });
  });
});
