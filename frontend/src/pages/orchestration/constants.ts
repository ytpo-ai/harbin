import { DebugRuntimeTaskTypeOverride, OrchestrationTask } from '../../services/orchestrationService';

export type DrawerTab = 'debug' | 'session';
export type PlanDrawerTab = 'settings' | 'history';
export type RunStatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunTriggerFilter = 'all' | 'manual' | 'schedule' | 'autorun';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskEditableDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  dependencyTaskIds: string[];
};

export type TaskBatchUpdateItem = {
  taskId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dependencyTaskIds: string[];
};

export const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  drafting: 'bg-amber-100 text-amber-700',
  planned: 'bg-indigo-100 text-indigo-700',
  production: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-gray-100 text-gray-700',
  assigned: 'bg-cyan-100 text-cyan-700',
  in_progress: 'bg-blue-100 text-blue-700',
  blocked: 'bg-orange-100 text-orange-700',
  waiting_human: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-zinc-100 text-zinc-700',
};

export const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-zinc-100 text-zinc-700',
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const TRIGGER_TYPE_LABEL: Record<string, string> = {
  manual: '手动触发',
  schedule: '定时触发',
  autorun: '自动触发',
};

export const PLAN_PROMPT_DRAFT_STORAGE_KEY = 'orchestration-plan-prompt-drafts';
export const FULLY_EDITABLE_PLAN_STATUS = new Set(['draft', 'drafting', 'planned']);

export const DEBUG_RUNTIME_TYPE_OPTIONS: Array<{ value: 'auto' | DebugRuntimeTaskTypeOverride; label: string }> = [
  { value: 'auto', label: '自动判定（不覆盖）' },
  { value: 'general', label: '通用（general）' },
  { value: 'development', label: '开发（development）' },
  { value: 'research', label: '研究（research）' },
  { value: 'review', label: '评审（review）' },
  { value: 'external_action', label: '外部动作（external_action）' },
];

export const TASK_RUNTIME_TYPE_LABEL: Record<DebugRuntimeTaskTypeOverride, string> = {
  general: 'general',
  development: 'development',
  research: 'research',
  review: 'review',
  external_action: 'external_action',
};

export type TaskDraftResolver = (task: OrchestrationTask) => TaskEditableDraft;
