import {
  DebugRuntimeTaskTypeOverride,
  OrchestrationPlan,
  OrchestrationRun,
  OrchestrationTask,
} from '../../services/orchestrationService';

export type DrawerTab = 'debug' | 'session';
export type PlanDetailTab = 'settings' | 'history';

export type TaskEditableDraft = {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencyTaskIds: string[];
};

export const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  drafting: 'bg-amber-100 text-amber-700',
  planned: 'bg-indigo-100 text-indigo-700',
  production: 'bg-emerald-100 text-emerald-700',
  running: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
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

export const STREAMING_PLAN_STATUS = new Set(['drafting']);
export const FULLY_EDITABLE_PLAN_STATUS = new Set(['draft', 'planned']);

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

export const normalizeIdList = (values: string[]) => Array.from(new Set(values.filter(Boolean).map((item) => item.trim())));

export const normalizeComparableIdList = (values: string[]) => normalizeIdList(values).sort();

export const isSameIdList = (left: string[], right: string[]) => {
  const normalizedLeft = normalizeComparableIdList(left);
  const normalizedRight = normalizeComparableIdList(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
};

export const getTaskEditableDraft = (task: OrchestrationTask): TaskEditableDraft => ({
  title: task.title || '',
  description: task.description || '',
  priority: task.priority || 'medium',
  dependencyTaskIds: normalizeIdList(task.dependencyTaskIds || []),
});

export const isTaskEditable = (planStatus: string) => FULLY_EDITABLE_PLAN_STATUS.has(planStatus);

export const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatDuration = (durationMs?: number) => {
  if (!durationMs || durationMs <= 0) {
    return '-';
  }
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
};

export const getRunCompletionPercent = (run?: OrchestrationRun | null) => {
  if (!run?.stats?.totalTasks) {
    return 0;
  }
  return Math.min(100, Math.round((run.stats.completedTasks / run.stats.totalTasks) * 100));
};

export const formatExecutor = (task: OrchestrationTask) => {
  const executorType = task.assignment?.executorType || 'unassigned';
  const executorId = task.assignment?.executorId;
  if (executorType === 'unassigned') return 'unassigned';
  return executorId ? `${executorType}:${executorId}` : executorType;
};

export const buildPlanTasksMarkdown = (plan: OrchestrationPlan) => {
  const tasks = plan.tasks || [];
  const taskTitleById = new Map(tasks.map((task) => [task._id, `#${task.order + 1} ${task.title || '未命名任务'}`]));
  const lines: string[] = [];

  lines.push(`# 计划任务清单：${plan.title || '未命名计划'}`);
  lines.push('');
  lines.push(`- 计划 ID: ${plan._id}`);
  lines.push(`- 计划状态: ${plan.status}`);
  lines.push(`- 编排模式: ${plan.strategy?.mode || '-'}`);
  lines.push(`- Planner: ${plan.strategy?.plannerAgentId || '默认'}`);
  lines.push(`- 更新时间: ${formatDateTime(plan.updatedAt)}`);
  lines.push('');
  lines.push('## Prompt');
  lines.push('');
  lines.push(plan.sourcePrompt || '-');
  lines.push('');
  lines.push('## 任务列表');
  lines.push('');

  if (!tasks.length) {
    lines.push('_暂无任务_');
    return lines.join('\n');
  }

  for (const task of tasks) {
    const dependencies = (task.dependencyTaskIds || [])
      .map((dependencyId) => taskTitleById.get(dependencyId) || dependencyId)
      .join(', ');
    lines.push(`### ${task.order + 1}. ${task.title || '未命名任务'}`);
    lines.push(`- 状态: ${task.status}`);
    lines.push(`- 优先级: ${task.priority}`);
    lines.push(`- 执行者: ${formatExecutor(task)}`);
    lines.push(`- 依赖: ${dependencies || '无'}`);
    lines.push(`- 描述: ${task.description || '-'}`);
    lines.push(`- 输出: ${task.result?.output || task.result?.summary || '-'}`);
    lines.push(`- 错误: ${task.result?.error || '-'}`);
    lines.push('');
  }

  return lines.join('\n');
};
