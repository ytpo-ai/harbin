import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentRunScoreController } from './agent-run-score.controller';

describe('AgentRunScoreController', () => {
  const createController = () => {
    const runScoreService = {
      getScoreByRunId: jest.fn(),
      getScoresByAgent: jest.fn(),
      getAgentScoreStats: jest.fn(),
    };
    const controller = new AgentRunScoreController(runScoreService as any);
    return { controller, runScoreService };
  };

  it('throws forbidden when user context is missing', async () => {
    const { controller } = createController();
    await expect(controller.getRunScore('run-1', {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws not found for missing score', async () => {
    const { controller, runScoreService } = createController();
    runScoreService.getScoreByRunId.mockResolvedValue(null);

    await expect(
      controller.getRunScore('run-1', { userContext: { role: 'system', employeeId: 'e1' } } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns run score when found', async () => {
    const { controller, runScoreService } = createController();
    runScoreService.getScoreByRunId.mockResolvedValue({ runId: 'run-1', score: 90 });

    const result = await controller.getRunScore('run-1', { userContext: { role: 'admin', employeeId: 'e1' } } as any);

    expect(result.success).toBe(true);
    expect(result.runId).toBe('run-1');
    expect(result.score.score).toBe(90);
  });
});
