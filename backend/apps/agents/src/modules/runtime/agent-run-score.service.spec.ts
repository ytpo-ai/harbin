import { AgentRunScoreService } from './agent-run-score.service';

const queryResult = <T>(value: T) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('AgentRunScoreService', () => {
  const createService = () => {
    const scoreModel = {
      updateOne: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      find: jest.fn(),
      aggregate: jest.fn(),
    };
    const service = new AgentRunScoreService(scoreModel as any);
    return { service, scoreModel };
  };

  it('saves score with upsert', async () => {
    const { service, scoreModel } = createService();
    scoreModel.updateOne.mockReturnValue(queryResult({ acknowledged: true }));

    await service.saveScore({
      runId: 'run-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      summary: {
        score: 90,
        baseScore: 100,
        totalDeductions: 10,
        stats: {
          totalRounds: 2,
          totalToolCalls: 1,
          successfulToolCalls: 1,
          failedToolCalls: 0,
        },
        deductionsByRule: { D1: { count: 1, totalPoints: -5 } },
        deductions: [],
        ruleVersion: '1.0',
      },
    });

    expect(scoreModel.updateOne).toHaveBeenCalledTimes(1);
    expect(scoreModel.updateOne.mock.calls[0][0]).toEqual({ runId: 'run-1' });
    expect(scoreModel.updateOne.mock.calls[0][2]).toEqual({ upsert: true });
  });

  it('queries score by run id', async () => {
    const { service, scoreModel } = createService();
    scoreModel.findOne.mockReturnValue(queryResult({ runId: 'run-1', score: 92 }));

    const result = await service.getScoreByRunId('run-1');

    expect(scoreModel.findOne).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(result).toEqual({ runId: 'run-1', score: 92 });
  });

  it('returns paginated score list', async () => {
    const { service, scoreModel } = createService();
    scoreModel.countDocuments.mockReturnValue(queryResult(3));
    scoreModel.find.mockReturnValue(queryResult([{ runId: 'run-1' }, { runId: 'run-2' }]));

    const result = await service.getScoresByAgent('agent-1', {
      minScore: 60,
      page: 2,
      pageSize: 2,
    });

    expect(scoreModel.countDocuments).toHaveBeenCalledWith({
      agentId: 'agent-1',
      score: { $gte: 60 },
    });
    expect(result.total).toBe(3);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('aggregates stats and top rule frequency', async () => {
    const { service, scoreModel } = createService();
    scoreModel.aggregate
      .mockReturnValueOnce(queryResult([{ totalRuns: 2, averageScore: 88, minScore: 80, maxScore: 96 }]))
      .mockReturnValueOnce(queryResult([{ _id: 'D3', count: 2, totalPoints: -20 }]));

    const stats = await service.getAgentScoreStats('agent-1', { topN: 3 });

    expect(scoreModel.aggregate).toHaveBeenCalledTimes(2);
    expect(stats.totalRuns).toBe(2);
    expect(stats.averageScore).toBe(88);
    expect(stats.ruleFrequencyTop[0]).toEqual({
      ruleId: 'D3',
      count: 2,
      totalPoints: -20,
    });
  });
});
