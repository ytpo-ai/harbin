import { RuntimePersistenceService } from './runtime-persistence.service';

describe('RuntimePersistenceService session usage aggregation', () => {
  const service = Object.create(RuntimePersistenceService.prototype) as {
    buildSessionUsageIncUpdate: (input: {
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
      cost?: number;
    }) => Record<string, number>;
  };

  it('builds $inc payload for tokens and cost', () => {
    const inc = service.buildSessionUsageIncUpdate({
      cost: 2.5,
      tokens: {
        input: 10,
        output: 5,
        reasoning: 3,
        cacheRead: 2,
        cacheWrite: 1,
        total: 21,
      },
    });

    expect(inc).toEqual({
      totalCost: 2.5,
      'totalTokens.input': 10,
      'totalTokens.output': 5,
      'totalTokens.reasoning': 3,
      'totalTokens.cacheRead': 2,
      'totalTokens.cacheWrite': 1,
      'totalTokens.total': 21,
    });
  });

  it('ignores non-finite token and cost values', () => {
    const inc = service.buildSessionUsageIncUpdate({
      cost: Number.NaN,
      tokens: {
        input: Infinity,
        output: 8,
      },
    });

    expect(inc).toEqual({
      'totalTokens.output': 8,
    });
  });

  it('returns empty payload when no usage exists', () => {
    expect(service.buildSessionUsageIncUpdate({})).toEqual({});
  });
});
