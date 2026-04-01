import { AgentActionLogItem } from '../../services/agentActionLogService';
import { AgentMemo } from '../../types';

export const DEFAULT_MEMO_PAGE_SIZE = 30;
export const DEFAULT_LOG_PAGE_SIZE = 20;
export const DEFAULT_SESSION_PAGE_SIZE = 8;

export type LogStatus = NonNullable<NonNullable<AgentActionLogItem['details']>['status']>;

export const LOG_STATUS_META: Record<LogStatus | 'unknown', { label: string; badgeClass: string }> = {
  completed: { label: '成功', badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  started: { label: '进行中', badgeClass: 'border-amber-200 bg-amber-50 text-amber-700' },
  running: { label: '运行中', badgeClass: 'border-sky-200 bg-sky-50 text-sky-700' },
  pending: { label: '待执行', badgeClass: 'border-slate-200 bg-slate-100 text-slate-700' },
  failed: { label: '失败', badgeClass: 'border-rose-200 bg-rose-50 text-rose-700' },
  paused: { label: '已暂停', badgeClass: 'border-orange-200 bg-orange-50 text-orange-700' },
  resumed: { label: '已恢复', badgeClass: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  cancelled: { label: '已取消', badgeClass: 'border-zinc-200 bg-zinc-100 text-zinc-700' },
  asked: { label: '待授权', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  replied: { label: '已授权回复', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  denied: { label: '已拒绝', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  step_started: { label: '步骤开始', badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  unknown: { label: '未知', badgeClass: 'border-gray-200 bg-gray-100 text-gray-700' },
};

export const CONTEXT_TYPE_LABEL: Record<AgentActionLogItem['contextType'], string> = {
  chat: 'Chat',
  orchestration: 'Orchestration',
};

export const ACTION_SEMANTIC_MAP: Record<string, { label: string; color: string; icon: string }> = {
  'runtime:run.started': { label: '任务启动', color: 'text-blue-600 bg-blue-50 ring-blue-200/60', icon: '>' },
  'runtime:run.step.started': { label: '步骤开始', color: 'text-indigo-600 bg-indigo-50 ring-indigo-200/60', icon: '>>' },
  'runtime:run.completed': { label: '任务完成', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200/60', icon: 'v' },
  'runtime:run.failed': { label: '任务失败', color: 'text-red-600 bg-red-50 ring-red-200/60', icon: 'x' },
  'runtime:run.paused': { label: '任务暂停', color: 'text-orange-600 bg-orange-50 ring-orange-200/60', icon: '||' },
  'runtime:run.resumed': { label: '任务恢复', color: 'text-cyan-600 bg-cyan-50 ring-cyan-200/60', icon: '~' },
  'runtime:run.cancelled': { label: '任务取消', color: 'text-zinc-600 bg-zinc-50 ring-zinc-200/60', icon: 'o' },
  'runtime:tool.pending': { label: '工具等待', color: 'text-slate-600 bg-slate-50 ring-slate-200/60', icon: 'o' },
  'runtime:tool.running': { label: '工具执行中', color: 'text-sky-600 bg-sky-50 ring-sky-200/60', icon: '*' },
  'runtime:tool.completed': { label: '工具完成', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200/60', icon: '+' },
  'runtime:tool.failed': { label: '工具失败', color: 'text-red-600 bg-red-50 ring-red-200/60', icon: 'x' },
  'runtime:permission.asked': { label: '请求授权', color: 'text-fuchsia-600 bg-fuchsia-50 ring-fuchsia-200/60', icon: '?' },
  'runtime:permission.replied': { label: '授权通过', color: 'text-fuchsia-600 bg-fuchsia-50 ring-fuchsia-200/60', icon: 'v' },
  'runtime:permission.denied': { label: '授权拒绝', color: 'text-fuchsia-600 bg-fuchsia-50 ring-fuchsia-200/60', icon: 'x' },
  chat_tool_call: { label: '工具调用', color: 'text-amber-600 bg-amber-50 ring-amber-200/60', icon: '#' },
};

export const SCORE_RULE_LABEL: Record<string, string> = {
  D1: '工具参数预检失败',
  D2: '多 tool_call 批量输出',
  D3: '连续两轮调用相同工具',
  D4: '工具执行失败（非参数类）',
  D5: '工具执行失败（参数类）',
  D6: '调用未授权工具',
  D7: 'tool_call JSON 解析失败',
  D8: '文本意图未执行',
  D9: 'Planner 纯文本重试触发',
  D10: '空/无意义响应',
  D11: '达到最大轮次上限',
  D12: 'LLM 调用超时/网络错误',
};

export const getScoreBadgeClass = (score: number): string => {
  if (score >= 80) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (score >= 60) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

export type TaskGroupDetailTab = 'flow' | 'raw' | 'score';

export const TASK_GROUP_DETAIL_TABS: Array<{ key: TaskGroupDetailTab; label: string }> = [
  { key: 'flow', label: '执行流程' },
  { key: 'raw', label: '原始信息' },
  { key: 'score', label: '扣分记录' },
];

export type RunDetailTab = 'flow' | 'raw' | 'score';
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export const RUN_DETAIL_TABS: Array<{ key: RunDetailTab; label: string }> = [
  { key: 'flow', label: '执行流程' },
  { key: 'raw', label: '原始信息' },
  { key: 'score', label: '扣分记录' },
];

export const RUN_STATUS_META: Record<RunStatus, { label: string; badgeClass: string }> = {
  pending: { label: '待执行', badgeClass: 'border-slate-200 bg-slate-100 text-slate-700' },
  running: { label: '运行中', badgeClass: 'border-sky-200 bg-sky-50 text-sky-700' },
  completed: { label: '成功', badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', badgeClass: 'border-rose-200 bg-rose-50 text-rose-700' },
  cancelled: { label: '已取消', badgeClass: 'border-zinc-200 bg-zinc-100 text-zinc-700' },
  paused: { label: '已暂停', badgeClass: 'border-orange-200 bg-orange-50 text-orange-700' },
};

export interface TaskGroup {
  groupKey: string;
  title: string;
  contextId?: string;
  contextType: 'chat' | 'orchestration';
  environmentType: 'internal_message' | 'meeting_chat' | 'orchestration_plan' | 'chat';
  environmentLabel: string;
  finalStatus: LogStatus;
  startTime: string;
  endTime: string;
  actionCount: number;
  lastActionSummary: string;
  actions: AgentActionLogItem[];
  totalDurationMs: number;
}

export type MemoDraft = {
  title: string;
  content: string;
  category: string;
  memoKind: string;
  memoType: string;
  topic: string;
  todoStatus: string;
  tags: string;
};

export const emptyDraft: MemoDraft = {
  title: '',
  content: '',
  category: '',
  memoKind: '',
  memoType: '',
  topic: '',
  todoStatus: '',
  tags: '',
};

export const memoKindOptions: Array<NonNullable<AgentMemo['memoKind']>> = [
  'identity',
  'todo',
  'topic',
  'history',
  'draft',
  'custom',
  'evaluation',
  'achievement',
  'criticism',
];

export const standardMemoKinds: Array<NonNullable<AgentMemo['memoKind']>> = [
  'identity',
  'todo',
  'history',
  'draft',
  'custom',
  'evaluation',
  'achievement',
  'criticism',
];

export const memoTypeOptions: Array<NonNullable<AgentMemo['memoType']>> = ['knowledge', 'standard'];
export const todoStatusOptions: Array<NonNullable<AgentMemo['todoStatus']>> = ['pending', 'in_progress', 'completed', 'cancelled'];

export const AGENT_DETAIL_QUERY_KEYS = {
  detail: (agentId: string) => ['agent-detail', agentId] as const,
  memosBase: (agentId: string) => ['agent-memos', agentId] as const,
  memos: (agentId: string, memoSearch: string, memoPage: number, memoCategory: 'standard' | 'topic') =>
    ['agent-memos', agentId, memoSearch, memoPage, memoCategory] as const,
  logs: (agentId: string, filters: unknown) => ['agent-logs', agentId, filters] as const,
  runtimeRun: (runId: string) => ['agent-runtime-run', runId] as const,
  sessions: (agentId: string, keyword: string, page: number) => ['agent-runtime-sessions', agentId, keyword, page] as const,
  sessionDetail: (sessionId: string) => ['agent-runtime-session-detail', sessionId] as const,
};
