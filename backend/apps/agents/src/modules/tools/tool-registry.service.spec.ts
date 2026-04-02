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

  it('normalizes shorthand string format parameters to JSON Schema', async () => {
    const toolModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          id: 'builtin.sys-mg.mcp.requirement.update-status',
          implementation: {
            parameters: {
              requirementId: 'string',
              status: 'string',
              note: 'string',
              taskType: 'string',
            },
          },
        }),
      }),
    };

    const service = new ToolRegistryService(toolModel as any, {} as any, {} as any);
    const contract = await service.getToolInputContract('builtin.sys-mg.mcp.requirement.update-status');

    expect(contract).not.toBeNull();
    expect(contract!.schema).toEqual({
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        status: { type: 'string' },
        note: { type: 'string' },
        taskType: { type: 'string' },
      },
    });
    // Ensure properties is not empty (the bug produced {})
    expect(Object.keys((contract!.schema as any).properties).length).toBe(4);
  });

  it('handles mixed shorthand and object format parameters', async () => {
    const toolModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          id: 'tool-mixed',
          implementation: {
            parameters: {
              name: 'string',
              action: { type: 'string', enum: ['create', 'update'], description: 'action type' },
              count: 'number',
            },
          },
        }),
      }),
    };

    const service = new ToolRegistryService(toolModel as any, {} as any, {} as any);
    const contract = await service.getToolInputContract('tool-mixed');

    expect(contract).not.toBeNull();
    const properties = (contract!.schema as any).properties;
    expect(properties.name).toEqual({ type: 'string' });
    expect(properties.action).toEqual({ type: 'string', enum: ['create', 'update'], description: 'action type' });
    expect(properties.count).toEqual({ type: 'number' });
  });
});
