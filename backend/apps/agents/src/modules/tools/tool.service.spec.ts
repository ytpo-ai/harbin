import { ToolService } from './tool.service';

describe('ToolService facade', () => {
  const createService = () => {
    const registry = {
      seedBuiltinTools: jest.fn(),
      getAllTools: jest.fn(),
      getAllToolsView: jest.fn(),
      getToolkits: jest.fn(),
      getToolkit: jest.fn(),
      getToolRegistry: jest.fn(),
      getTopKToolRoutes: jest.fn(),
      getTool: jest.fn(),
      getToolView: jest.fn(),
      getToolInputContract: jest.fn(),
      getToolsByIds: jest.fn(),
      createTool: jest.fn(),
      updateTool: jest.fn(),
      deleteTool: jest.fn(),
      getToolExecutions: jest.fn(),
      getToolExecutionStats: jest.fn(),
    };
    const execution = {
      executeTool: jest.fn(),
    };

    const service = new ToolService(registry as any, execution as any);
    return { service, registry, execution };
  };

  it('delegates executeTool to execution service', async () => {
    const { service, execution } = createService();
    execution.executeTool.mockResolvedValue({ id: 'exec-1' });

    const result = await service.executeTool('tool.id', 'agent-1', { foo: 'bar' }, 'task-1');

    expect(execution.executeTool).toHaveBeenCalledWith('tool.id', 'agent-1', { foo: 'bar' }, 'task-1', undefined);
    expect(result).toEqual({ id: 'exec-1' });
  });

  it('delegates registry APIs to registry service', async () => {
    const { service, registry } = createService();
    registry.getAllTools.mockResolvedValue([{ id: 'tool-1' }]);

    const result = await service.getAllTools();

    expect(registry.getAllTools).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'tool-1' }]);
  });
});
