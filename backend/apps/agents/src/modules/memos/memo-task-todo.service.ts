import { Injectable } from '@nestjs/common';
import { MemoTaskHistoryService, NormalizedTaskStatus, TaskStatus } from './memo-task-history.service';

export type TaskSourceType = 'orchestration_task' | 'meeting_chat' | 'runtime_note';

export interface TodoTaskItem {
  taskId: string;
  title: string;
  description?: string;
  status: 'pending' | 'queued' | 'scheduled';
  orchestrationId?: string;
  priority?: 'low' | 'medium' | 'high';
  sourceType: 'orchestration_task';
  updatedAt: string;
  note?: string;
}

@Injectable()
export class MemoTaskTodoService {
  constructor(private readonly memoTaskHistoryService: MemoTaskHistoryService) {}

  normalizeTaskSourceType(sourceType?: TaskSourceType): TaskSourceType {
    const normalized = String(sourceType || 'orchestration_task').trim().toLowerCase();
    if (normalized === 'meeting_chat' || normalized === 'runtime_note') return normalized;
    return 'orchestration_task';
  }

  isTodoActiveStatus(status: NormalizedTaskStatus): status is TodoTaskItem['status'] {
    return status === 'pending' || status === 'queued' || status === 'scheduled';
  }

  readTodoItems(payload: Record<string, any> | undefined): TodoTaskItem[] {
    const items = Array.isArray(payload?.tasks) ? payload.tasks : [];
    const normalized: TodoTaskItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const taskId = String(item.taskId || '').trim();
      if (!taskId) continue;
      const status = this.memoTaskHistoryService.normalizeTaskStatus(item.status);
      if (!this.isTodoActiveStatus(status)) continue;
      normalized.push({
        taskId,
        title: String(item.title || `Task ${taskId}`).trim(),
        description: item.description ? String(item.description) : undefined,
        status,
        orchestrationId: item.orchestrationId ? String(item.orchestrationId) : undefined,
        priority: this.memoTaskHistoryService.normalizePriority(item.priority),
        sourceType: 'orchestration_task',
        updatedAt: String(item.updatedAt || new Date(0).toISOString()),
        note: item.note ? String(item.note) : undefined,
      });
    }
    return normalized.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  upsertTodoItem(items: TodoTaskItem[], next: TodoTaskItem): TodoTaskItem[] {
    const merged = [next, ...items.filter((item) => item.taskId !== next.taskId)].slice(0, 500);
    return merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  renderTodoContent(items: TodoTaskItem[], compact: (content: string, maxLength: number) => string): string {
    const lines = ['# TODO List', '', '## Pending Tasks', ''];
    if (!items.length) {
      lines.push('- No pending tasks.');
      return `${lines.join('\n')}\n`;
    }
    for (const item of items) {
      const suffix = [
        `taskId:${item.taskId}`,
        `status:${item.status}`,
        item.priority ? `priority:${item.priority}` : '',
        item.orchestrationId ? `orchestrationId:${item.orchestrationId}` : '',
        `updated:${item.updatedAt}`,
      ]
        .filter(Boolean)
        .join(' ');
      const desc = item.description ? ` - ${compact(item.description, 120)}` : '';
      lines.push(`- ${item.title}${desc} (${suffix})`);
    }
    return `${lines.join('\n')}\n`;
  }

  normalizeTaskStatus(status?: TaskStatus): NormalizedTaskStatus {
    return this.memoTaskHistoryService.normalizeTaskStatus(status);
  }
}
