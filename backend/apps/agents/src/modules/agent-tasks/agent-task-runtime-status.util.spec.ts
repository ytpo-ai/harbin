import {
  buildIdleAgentRuntimeStatus,
  parseAgentRuntimeStatus,
} from './agent-task-runtime-status.util';

describe('agent-task-runtime-status util', () => {
  it('builds idle payload with source and taskId', () => {
    const payload = buildIdleAgentRuntimeStatus('agent-1', 'task-1');

    expect(payload).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        taskId: 'task-1',
        status: 'idle',
        source: 'agent_task_tool',
      }),
    );
  });

  it('parses redis runtime payload and normalizes source', () => {
    const raw = JSON.stringify({
      agentId: 'agent-2',
      taskId: 'task-2',
      toolId: 'builtin.engineering.mcp.requirement.list',
      toolName: 'Requirement List',
      status: 'running',
      updatedAt: '2026-03-22T10:00:00.000Z',
    });

    expect(parseAgentRuntimeStatus(raw)).toEqual(
      expect.objectContaining({
        agentId: 'agent-2',
        taskId: 'task-2',
        toolId: 'builtin.engineering.mcp.requirement.list',
        status: 'running',
        source: 'agent_task_tool',
      }),
    );
  });

  it('returns null for invalid payload', () => {
    expect(parseAgentRuntimeStatus('')).toBeNull();
    expect(parseAgentRuntimeStatus('{invalid')).toBeNull();
    expect(parseAgentRuntimeStatus(JSON.stringify({ status: 'running' }))).toBeNull();
  });
});
