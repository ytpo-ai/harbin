import { RdIntelligenceToolHandler } from './engineering-statistics-tool-handler.service';

describe('RdIntelligenceToolHandler', () => {
  it('runs engineering statistics with defaults', async () => {
    const internalApiClient = {
      postEngineeringStatistics: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
    };
    const handler = new RdIntelligenceToolHandler(internalApiClient as any);

    const result = await handler.runEngineeringStatistics({});

    expect(internalApiClient.postEngineeringStatistics).toHaveBeenCalledWith({
      receiverId: undefined,
      scope: 'all',
      tokenMode: 'estimate',
      projectIds: undefined,
      triggeredBy: 'agent-mcp',
    });
    expect(result.action).toBe('engineering_statistics_run');
  });
});
