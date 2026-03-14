import { Injectable } from '@nestjs/common';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'in_progress'
  | 'completed';

export type NormalizedTaskStatus = 'pending' | 'queued' | 'scheduled' | 'running' | 'success' | 'failed' | 'cancelled';

export interface HistoryTaskItem {
  taskId: string;
  title: string;
  description?: string;
  orchestrationId?: string;
  priority?: 'low' | 'medium' | 'high';
  sourceType: 'orchestration_task';
  startedAt?: string;
  finishedAt?: string;
  finalStatus?: 'success' | 'failed' | 'cancelled';
  currentStatus: 'running' | 'success' | 'failed' | 'cancelled';
  statusTimeline: Array<{ status: 'running' | 'success' | 'failed' | 'cancelled'; at: string; note?: string }>;
  updatedAt: string;
}

@Injectable()
export class MemoTaskHistoryService {
  normalizeTaskStatus(status?: TaskStatus): NormalizedTaskStatus {
    const normalized = String(status || 'pending').trim().toLowerCase();
    if (normalized === 'in_progress') return 'running';
    if (normalized === 'completed') return 'success';
    if (normalized === 'pending' || normalized === 'queued' || normalized === 'scheduled') return normalized;
    if (normalized === 'running' || normalized === 'success' || normalized === 'failed' || normalized === 'cancelled') {
      return normalized;
    }
    return 'pending';
  }

  isHistoryStatus(status: NormalizedTaskStatus): status is HistoryTaskItem['currentStatus'] {
    return status === 'running' || status === 'success' || status === 'failed' || status === 'cancelled';
  }

  normalizePriority(value?: string): 'low' | 'medium' | 'high' | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
    return undefined;
  }

  readHistoryItems(payload: Record<string, any> | undefined): HistoryTaskItem[] {
    const items = Array.isArray(payload?.tasks) ? payload.tasks : [];
    const normalized: HistoryTaskItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const taskId = String(item.taskId || '').trim();
      if (!taskId) continue;
      const status = this.normalizeTaskStatus(item.currentStatus || item.finalStatus || item.status);
      if (!this.isHistoryStatus(status)) continue;
      const timeline = Array.isArray(item.statusTimeline)
        ? item.statusTimeline
            .map((entry) => ({
              status: this.normalizeTaskStatus(entry?.status) as 'running' | 'success' | 'failed' | 'cancelled',
              at: String(entry?.at || ''),
              note: entry?.note ? String(entry.note) : undefined,
            }))
            .filter((entry) => this.isHistoryStatus(entry.status) && entry.at)
        : [];

      const normalizedFinalStatus = this.normalizeTaskStatus(item.finalStatus);
      normalized.push({
        taskId,
        title: String(item.title || `Task ${taskId}`).trim(),
        description: item.description ? String(item.description) : undefined,
        orchestrationId: item.orchestrationId ? String(item.orchestrationId) : undefined,
        priority: this.normalizePriority(item.priority),
        sourceType: 'orchestration_task',
        startedAt: item.startedAt ? String(item.startedAt) : undefined,
        finishedAt: item.finishedAt ? String(item.finishedAt) : undefined,
        finalStatus:
          normalizedFinalStatus === 'success' || normalizedFinalStatus === 'failed' || normalizedFinalStatus === 'cancelled'
            ? normalizedFinalStatus
            : undefined,
        currentStatus: status,
        statusTimeline: this.dedupeTimeline(timeline),
        updatedAt: String(item.updatedAt || new Date(0).toISOString()),
      });
    }
    return normalized.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  dedupeTimeline(
    timeline: Array<{ status: 'running' | 'success' | 'failed' | 'cancelled'; at: string; note?: string }>,
  ): Array<{ status: 'running' | 'success' | 'failed' | 'cancelled'; at: string; note?: string }> {
    const seen = new Set<string>();
    const deduped: Array<{ status: 'running' | 'success' | 'failed' | 'cancelled'; at: string; note?: string }> = [];
    for (const item of timeline) {
      const key = `${item.status}:${item.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    return deduped.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  renderHistoryContent(
    items: HistoryTaskItem[],
    compact: (content: string, maxLength: number) => string,
  ): string {
    const lines = ['# History Log', '', '## Executed Tasks', ''];
    if (!items.length) {
      lines.push('- No executed tasks yet.');
      return `${lines.join('\n')}\n`;
    }
    for (const item of items) {
      const suffix = [
        `taskId:${item.taskId}`,
        `status:${item.currentStatus}`,
        item.finalStatus ? `final:${item.finalStatus}` : '',
        item.priority ? `priority:${item.priority}` : '',
        item.orchestrationId ? `orchestrationId:${item.orchestrationId}` : '',
        item.startedAt ? `started:${item.startedAt}` : '',
        item.finishedAt ? `finished:${item.finishedAt}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const desc = item.description ? ` - ${compact(item.description, 120)}` : '';
      lines.push(`- ${item.title}${desc} (${suffix})`);
      if (item.statusTimeline.length) {
        lines.push(
          `  - timeline: ${item.statusTimeline
            .map((timeline) => `${timeline.status}@${timeline.at}${timeline.note ? `(${compact(timeline.note, 80)})` : ''}`)
            .join(' -> ')}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
