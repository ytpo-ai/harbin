import { OrchestrationRun, OrchestrationTask } from '../../services/orchestrationService';
import { FULLY_EDITABLE_PLAN_STATUS, TaskEditableDraft } from './constants';

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

export const extractErrorMessage = (error: unknown, fallback: string) => {
  const message = (error as any)?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message) && typeof message[0] === 'string' && message[0].trim()) {
    return message[0];
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
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

export const isTaskEditable = (planStatus: string, taskStatus: string) => {
  void taskStatus;
  if (FULLY_EDITABLE_PLAN_STATUS.has(planStatus)) {
    return true;
  }
  return false;
};
