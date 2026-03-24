import { ToolExecutionService } from './tool-execution.service';

describe('ToolExecutionService', () => {
  it('throws when target tool is not found', async () => {
    const service = new ToolExecutionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getGovernancePolicy: jest.fn(), getIdempotencyKey: jest.fn() } as any,
      {} as any,
      { getTool: jest.fn().mockResolvedValue(null) } as any,
    );

    await expect(service.executeTool('missing.tool', 'agent-1', {})).rejects.toThrow('Tool not found: missing.tool');
  });
});
