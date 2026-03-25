import { AgentTaskService } from './agent-task.service';
import {
  AGENT_TASK_RUNTIME_STATUS_INDEX_KEY,
  buildAgentRuntimeStatusKey,
} from './agent-task-runtime-status.util';

describe('AgentTaskService runtime status idle sync', () => {
  it('writes idle runtime status to redis on task completion', async () => {
    const service = Object.create(AgentTaskService.prototype) as any;

    const set = jest.fn().mockResolvedValue('OK');
    const sadd = jest.fn().mockResolvedValue(1);
    service.redisService = {
      isReady: jest.fn().mockReturnValue(true),
      set,
      sadd,
    };

    await service.markAgentTaskToolIdle('agent-1', 'task-1');

    expect(set).toHaveBeenCalledTimes(1);
    const [key, rawPayload] = set.mock.calls[0];
    expect(key).toBe(buildAgentRuntimeStatusKey('agent-1'));
    expect(JSON.parse(String(rawPayload))).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        taskId: 'task-1',
        status: 'idle',
        source: 'agent_task_tool',
      }),
    );
    expect(sadd).toHaveBeenCalledWith(AGENT_TASK_RUNTIME_STATUS_INDEX_KEY, ['agent-1']);
  });

  it('skips redis writes when service is not ready', async () => {
    const service = Object.create(AgentTaskService.prototype) as any;

    const set = jest.fn();
    const sadd = jest.fn();
    service.redisService = {
      isReady: jest.fn().mockReturnValue(false),
      set,
      sadd,
    };

    await service.markAgentTaskToolIdle('agent-1', 'task-1');

    expect(set).not.toHaveBeenCalled();
    expect(sadd).not.toHaveBeenCalled();
  });
});
