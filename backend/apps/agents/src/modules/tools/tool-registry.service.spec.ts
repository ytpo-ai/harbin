import { ToolRegistryService } from './tool-registry.service';

describe('ToolRegistryService', () => {
  it('returns normalized input contract from implementation parameters', async () => {
    const toolModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          id: 'tool-1',
          implementation: {
            parameters: {
              query: { type: 'string', description: 'search query' },
            },
          },
        }),
      }),
    };

    const service = new ToolRegistryService(toolModel as any, {} as any, {} as any);
    const contract = await service.getToolInputContract('tool-1');

    expect(contract).toEqual({
      toolId: 'tool-1',
      schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'search query',
            enum: undefined,
          },
        },
      },
    });
  });
});
