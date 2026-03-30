import {
  AgentRuntimeRun,
  AgentRuntimeSession,
  AgentRuntimeSessionMessage,
  AgentRuntimeSessionPart,
} from '../../services/agentService';
import { AgentActionLogItem } from '../../services/agentActionLogService';
import { ACTION_SEMANTIC_MAP, LOG_STATUS_META, LogStatus } from './constants';

export const getActionSemantic = (action: string): { label: string; color: string; icon: string } => {
  const exact = ACTION_SEMANTIC_MAP[action];
  if (exact) return exact;
  if (action.startsWith('task_execution:')) {
    return { label: '编排执行', color: 'text-violet-600 bg-violet-50 ring-violet-200/60', icon: '*' };
  }
  if (action.startsWith('chat_execution:')) {
    return { label: '对话执行', color: 'text-blue-600 bg-blue-50 ring-blue-200/60', icon: 'C' };
  }
  return { label: action, color: 'text-gray-600 bg-gray-50 ring-gray-200/60', icon: '.' };
};

export const getActionDescription = (item: AgentActionLogItem): string => {
  const details = item.details;
  if (!details) return '';
  const parts: string[] = [];

  const toolName = details.toolName as string | undefined;
  if (toolName) parts.push(toolName);

  if (typeof details.durationMs === 'number' && details.durationMs > 0) {
    parts.push(details.durationMs >= 1000 ? `${(details.durationMs / 1000).toFixed(1)}s` : `${details.durationMs}ms`);
  }

  const sequence = details.sequence as number | undefined;
  if (typeof sequence === 'number') parts.push(`#${sequence}`);

  if (details.error) parts.push(`错误: ${String(details.error).slice(0, 80)}`);

  return parts.join(' · ');
};

export const getTaskStatusMeta = (status: LogStatus) => LOG_STATUS_META[status] || LOG_STATUS_META.unknown;

export const getSessionPartText = (part: AgentRuntimeSessionPart): string => {
  if (typeof part.content === 'string' && part.content.trim()) return part.content;
  if (typeof part.input === 'string' && part.input.trim()) return part.input;
  if (typeof part.output === 'string' && part.output.trim()) return part.output;

  if (part.input !== undefined && part.input !== null) {
    try {
      return JSON.stringify(part.input, null, 2);
    } catch {
      return String(part.input);
    }
  }

  if (part.output !== undefined && part.output !== null) {
    try {
      return JSON.stringify(part.output, null, 2);
    } catch {
      return String(part.output);
    }
  }

  return '-';
};

export const getSessionPartType = (part: AgentRuntimeSessionPart): string => part.type;

export const getSessionMessageText = (message: AgentRuntimeSessionMessage): string => {
  const payload: Record<string, unknown> = message as unknown as Record<string, unknown>;
  const info = payload.info as Record<string, unknown> | undefined;

  if (typeof payload.content === 'string' && payload.content.trim()) return payload.content;
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text;
  if (typeof info?.content === 'string' && info.content.trim()) return info.content;

  return '-';
};

export const getSessionMessageRawText = (message: AgentRuntimeSessionMessage): string => JSON.stringify(message, null, 2);

export const shouldClampPartContent = (content: string): boolean => content.length > 220 || content.split('\n').length > 5;

export const getSystemMessageTag = (message: AgentRuntimeSessionMessage): string | null => {
  if (message.role !== 'system') return null;

  const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
  const promptSlug = String(metadata.promptSlug || '').trim();
  if (promptSlug) return promptSlug;

  const content = (message.content || '').toLowerCase();
  const source = String(metadata.source || '').toLowerCase();

  if (content.includes('会议') || content.includes('meeting')) return '会议规则';

  if (
    content.includes('工作准则') ||
    content.includes('最小默认原则') ||
    content.includes('runtime 基线') ||
    content.includes('baseline')
  ) {
    return '团队工作基础准则';
  }

  if (
    content.includes('you are') ||
    content.includes('system prompt') ||
    source.includes('session.initialsystemmessages') ||
    source.includes('initialsystemmessages') ||
    source.includes('appendsystemmessagestosession')
  ) {
    return 'Agent Prompt';
  }

  if (source.includes('tool-calling-loop')) {
    return '系统注入';
  }

  return '系统规则';
};

export const formatSyncState = (run?: AgentRuntimeRun | null): string => {
  const state = run?.sync?.state;
  if (state === 'synced') return '已同步';
  if (state === 'failed') return '同步失败';
  if (state === 'pending') return '待同步';
  return '-';
};

export const getSessionId = (session: AgentRuntimeSession): string => {
  const rawId = session.id || session._id;
  return typeof rawId === 'string' ? rawId : '';
};

export const getSessionMessageKey = (message: AgentRuntimeSessionMessage, index: number): string => {
  if (message.id) return message.id;
  return `${message.timestamp || 'no-time'}-${message.runId || 'no-run'}-${index}`;
};
