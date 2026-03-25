export type AgentTaskRuntimeToolStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

export interface AgentTaskRuntimeStatusRecord {
  agentId: string;
  taskId?: string;
  toolId?: string;
  toolName?: string;
  status: AgentTaskRuntimeToolStatus;
  updatedAt: string;
  source: 'agent_task_tool';
}

const AGENT_TASK_RUNTIME_STATUS_KEY_PREFIX = 'agent:runtime-status:';
export const AGENT_TASK_RUNTIME_STATUS_INDEX_KEY = 'agent:runtime-status:index';
export const AGENT_TASK_RUNTIME_STATUS_TTL_SECONDS = Math.max(
  60,
  Number(process.env.AGENT_TASK_RUNTIME_STATUS_TTL_SECONDS || 6 * 60 * 60),
);

export function buildAgentRuntimeStatusKey(agentId: string): string {
  return `${AGENT_TASK_RUNTIME_STATUS_KEY_PREFIX}${String(agentId || '').trim()}`;
}

export function buildIdleAgentRuntimeStatus(agentId: string, taskId?: string): AgentTaskRuntimeStatusRecord {
  return {
    agentId: String(agentId || '').trim(),
    ...(taskId ? { taskId: String(taskId || '').trim() } : {}),
    status: 'idle',
    updatedAt: new Date().toISOString(),
    source: 'agent_task_tool',
  };
}

export function parseAgentRuntimeStatus(raw: string | null | undefined): AgentTaskRuntimeStatusRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AgentTaskRuntimeStatusRecord>;
    const agentId = String(parsed?.agentId || '').trim();
    const status = String(parsed?.status || '').trim() as AgentTaskRuntimeToolStatus;
    if (!agentId || !status) {
      return null;
    }
    return {
      agentId,
      taskId: parsed?.taskId ? String(parsed.taskId).trim() : undefined,
      toolId: parsed?.toolId ? String(parsed.toolId).trim() : undefined,
      toolName: parsed?.toolName ? String(parsed.toolName).trim() : undefined,
      status,
      updatedAt: parsed?.updatedAt ? String(parsed.updatedAt).trim() : new Date().toISOString(),
      source: 'agent_task_tool',
    };
  } catch {
    return null;
  }
}
