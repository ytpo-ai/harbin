import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RedisService } from '@libs/infra';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentMemo, AgentMemoDocument, MemoKind, MemoTodoStatus, MemoType } from '../../schemas/agent-memo.schema';
import { MemoDocSyncService } from './memo-doc-sync.service';

const EVENT_KEY_PREFIX = 'memo:event:';
const EVENT_QUEUE_TTL_SECONDS = 7 * 24 * 3600;
const EVENT_QUEUE_MAX = 1000;

interface CreateMemoInput {
  agentId: string;
  category?: string;
  title: string;
  content: string;
  memoType?: MemoType;
  memoKind?: MemoKind;
  topic?: string;
  slug?: string;
  todoStatus?: MemoTodoStatus;
  tags?: string[];
  contextKeywords?: string[];
  source?: string;
  taskId?: string;
}

interface ListMemoFilters {
  agentId?: string;
  category?: string;
  memoType?: MemoType;
  memoKind?: MemoKind;
  topic?: string;
  todoStatus?: MemoTodoStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface MemoryEvent {
  id: string;
  agentId: string;
  event: 'task_start' | 'decision' | 'task_complete' | 'task_failed';
  taskId?: string;
  title?: string;
  details: string;
  tags: string[];
  topic?: string;
  createdAt: string;
}

@Injectable()
export class MemoService {
  private readonly logger = new Logger(MemoService.name);

  constructor(
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
    private readonly memoDocSyncService: MemoDocSyncService,
    private readonly redisService: RedisService,
  ) {}

  async createMemo(payload: CreateMemoInput): Promise<AgentMemo> {
    if (!payload?.agentId?.trim()) throw new BadRequestException('agentId is required');
    if (!payload?.title?.trim()) throw new BadRequestException('title is required');
    if (!payload?.content?.trim()) throw new BadRequestException('content is required');

    const agentId = payload.agentId.trim();
    await this.ensureCoreDocuments(agentId);

    const slug = payload.slug?.trim() || this.buildStableSlug(payload.memoKind || 'topic', payload.title, payload.topic);
    const defaults = this.resolveMemoDefaults(payload.memoKind, payload.memoType);
    const nextTags = this.uniqueStrings(payload.tags || []);
    const nextKeywords = this.uniqueStrings(payload.contextKeywords || []);

    const updated = await this.memoModel
      .findOneAndUpdate(
        { agentId, slug },
        {
          id: uuidv4(),
          agentId,
          category: payload.category?.trim() || this.defaultCategoryByKind(defaults.memoKind),
          title: payload.title.trim(),
          slug,
          content: payload.content.trim(),
          memoType: defaults.memoType,
          memoKind: defaults.memoKind,
          topic: payload.topic?.trim() || (defaults.memoKind === 'topic' ? this.normalizeTopic(payload.title) : undefined),
          todoStatus: defaults.memoType === 'todo' ? payload.todoStatus || 'pending' : undefined,
          tags: nextTags,
          contextKeywords: nextKeywords,
          source: payload.source || 'agent',
          taskId: payload.taskId,
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
          $setOnInsert: { accessCount: 0 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    await this.syncMemoSafely(updated as unknown as AgentMemo);
    await this.rebuildIndexSafely();
    return updated as unknown as AgentMemo;
  }

  async listMemos(filters?: ListMemoFilters): Promise<{
    items: AgentMemo[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const query = this.buildQuery(filters);
    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(filters?.pageSize || 20)));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.memoModel.find(query).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).exec(),
      this.memoModel.countDocuments(query).exec(),
    ]);

    return {
      items: items as unknown as AgentMemo[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getMemoById(id: string): Promise<AgentMemo> {
    const memo = await this.memoModel.findOne({ id }).exec();
    if (!memo) throw new NotFoundException(`Memo not found: ${id}`);
    await this.touchMemoAccess(id);
    return memo as unknown as AgentMemo;
  }

  async updateMemo(id: string, updates: Partial<CreateMemoInput>): Promise<AgentMemo> {
    const existing = await this.memoModel.findOne({ id }).exec();
    if (!existing) throw new NotFoundException(`Memo not found: ${id}`);

    const memoKind = (updates.memoKind || existing.memoKind || 'topic') as MemoKind;
    const memoType = (updates.memoType || existing.memoType || 'knowledge') as MemoType;
    const nextTitle = updates.title?.trim() || existing.title;
    const nextTopic = updates.topic?.trim() || existing.topic;

    const payload: Record<string, any> = {
      updatedAt: new Date(),
      title: nextTitle,
      topic: nextTopic,
      memoKind,
      memoType,
      category: updates.category?.trim() || existing.category,
    };

    if (updates.content) payload.content = updates.content.trim();
    if (updates.todoStatus) payload.todoStatus = updates.todoStatus;
    if (updates.tags) payload.tags = this.uniqueStrings(updates.tags);
    if (updates.contextKeywords) payload.contextKeywords = this.uniqueStrings(updates.contextKeywords);
    if (updates.source) payload.source = updates.source;

    const nextSlug =
      updates.slug?.trim() ||
      (updates.title || updates.topic || updates.memoKind
        ? this.buildStableSlug(memoKind, nextTitle, nextTopic)
        : existing.slug);
    payload.slug = nextSlug;

    const updated = await this.memoModel.findOneAndUpdate({ id }, payload, { new: true }).exec();
    if (!updated) throw new NotFoundException(`Memo not found: ${id}`);

    if (existing.slug !== updated.slug || existing.category !== updated.category || existing.agentId !== updated.agentId) {
      await this.removeMemoSafely(existing as unknown as AgentMemo);
    }
    await this.syncMemoSafely(updated as unknown as AgentMemo);
    await this.rebuildIndexSafely();
    return updated as unknown as AgentMemo;
  }

  async deleteMemo(id: string): Promise<boolean> {
    const existing = await this.memoModel.findOne({ id }).exec();
    if (!existing) return false;
    await this.memoModel.deleteOne({ id }).exec();
    await this.removeMemoSafely(existing as unknown as AgentMemo);
    await this.rebuildIndexSafely();
    return true;
  }

  async searchMemos(
    agentId: string,
    query: string,
    options?: {
      category?: string;
      memoType?: MemoType;
      memoKind?: MemoKind;
      topic?: string;
      limit?: number;
      progressive?: boolean;
      detail?: boolean;
    },
  ): Promise<Array<Record<string, any>>> {
    const trimmedAgentId = String(agentId || '').trim();
    if (!trimmedAgentId) return [];
    const limit = Math.max(1, Math.min(Number(options?.limit || 8), 30));

    const filter: Record<string, any> = { agentId: trimmedAgentId };
    if (options?.category?.trim()) filter.category = options.category.trim();
    if (options?.memoType) filter.memoType = options.memoType;
    if (options?.memoKind) filter.memoKind = options.memoKind;
    if (options?.topic?.trim()) filter.topic = options.topic.trim();

    const keyword = String(query || '').trim();
    if (keyword) {
      const escaped = this.escapeRegex(keyword);
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ title: regex }, { content: regex }, { category: regex }, { tags: regex }, { contextKeywords: regex }, { topic: regex }];
    }

    const memos = await this.memoModel.find(filter).sort({ updatedAt: -1, lastAccessedAt: -1 }).limit(limit).exec();
    await Promise.all(memos.map((memo) => this.touchMemoAccess(memo.id)));

    return memos.map((memo) => {
      const base = {
        id: memo.id,
        title: memo.title,
        category: memo.category,
        memoType: memo.memoType,
        memoKind: memo.memoKind,
        topic: memo.topic,
        todoStatus: memo.todoStatus,
        tags: memo.tags || [],
        updatedAt: memo.updatedAt,
      };

      if (options?.detail === true) {
        return {
          ...base,
          content: memo.content,
          source: memo.source,
          taskId: memo.taskId,
        };
      }

      return {
        ...base,
        summary: this.toSummary(memo.content, options?.progressive !== false ? 240 : 520),
      };
    });
  }

  async recordBehavior(payload: {
    agentId: string;
    event: 'task_start' | 'decision' | 'task_complete' | 'task_failed';
    taskId?: string;
    title?: string;
    details: string;
    tags?: string[];
    topic?: string;
  }): Promise<{ queued: boolean; key: string; eventId: string }> {
    const agentId = String(payload.agentId || '').trim();
    if (!agentId) throw new BadRequestException('agentId is required');
    await this.ensureCoreDocuments(agentId);

    const event: MemoryEvent = {
      id: uuidv4(),
      agentId,
      event: payload.event,
      taskId: payload.taskId,
      title: payload.title,
      details: payload.details,
      topic: payload.topic,
      tags: this.uniqueStrings([payload.event, ...(payload.tags || [])]),
      createdAt: new Date().toISOString(),
    };

    const key = `${EVENT_KEY_PREFIX}${agentId}`;
    await this.redisService.lpush(key, JSON.stringify(event));
    await this.redisService.ltrim(key, 0, EVENT_QUEUE_MAX - 1);
    await this.redisService.expire(key, EVENT_QUEUE_TTL_SECONDS);
    return { queued: true, key, eventId: event.id };
  }

  async upsertTaskTodo(agentId: string, task: { id?: string; title?: string; description?: string }): Promise<AgentMemo> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) throw new BadRequestException('agentId is required');
    await this.ensureCoreDocuments(normalizedAgentId);

    const taskId = String(task?.id || uuidv4()).trim();
    const title = String(task?.title || 'Untitled task').trim();
    const description = String(task?.description || '').trim();
    const todoDoc = await this.getOrCreateTodoDocument(normalizedAgentId);
    const nextContent = this.mergeTodoItem(todoDoc.content || '', {
      taskId,
      title,
      description,
      status: 'in_progress',
      note: '',
    });

    return this.updateMemo(todoDoc.id, {
      memoKind: 'todo',
      memoType: 'todo',
      title: todoDoc.title,
      content: nextContent,
      todoStatus: 'in_progress',
      tags: this.uniqueStrings([...(todoDoc.tags || []), 'task', 'todo']),
      contextKeywords: this.uniqueStrings([...(todoDoc.contextKeywords || []), ...this.extractKeywords(`${title} ${description}`)]),
    });
  }

  async updateTodoStatus(id: string, status: MemoTodoStatus, note?: string): Promise<AgentMemo> {
    const todoDoc = await this.memoModel.findOne({ id, memoKind: 'todo' }).exec();
    if (!todoDoc) throw new NotFoundException(`TODO memo not found: ${id}`);
    const nextContent = this.appendTodoStatusNote(todoDoc.content || '', status, note);
    return this.updateMemo(id, {
      memoKind: 'todo',
      memoType: 'todo',
      todoStatus: status,
      content: nextContent,
    });
  }

  async completeTaskTodo(agentId: string, taskId?: string, note?: string): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedAgentId || !normalizedTaskId) return;

    const todoDoc = await this.memoModel.findOne({ agentId: normalizedAgentId, memoKind: 'todo' }).exec();
    if (!todoDoc) return;

    const nextContent = this.mergeTodoItem(todoDoc.content || '', {
      taskId: normalizedTaskId,
      title: '',
      description: '',
      status: 'completed',
      note: note || '',
    });

    await this.updateMemo(todoDoc.id, {
      memoKind: 'todo',
      memoType: 'todo',
      todoStatus: 'completed',
      content: nextContent,
    });
  }

  async rebuildMemoDocs(): Promise<{ memos: number }> {
    const memos = await this.memoModel.find().sort({ updatedAt: -1 }).exec();
    for (const memo of memos) {
      await this.syncMemoSafely(memo as unknown as AgentMemo);
    }
    await this.rebuildIndexSafely();
    return { memos: memos.length };
  }

  async getTaskMemoryContext(agentId: string, taskText: string): Promise<string> {
    const query = String(taskText || '').trim();
    if (!query) return '';
    const matched = await this.searchMemos(agentId, query, {
      limit: 4,
      progressive: true,
      detail: false,
    });
    if (!matched.length) return '';
    return matched
      .map(
        (item, idx) =>
          `${idx + 1}. [${item.memoKind}] ${item.title} | topic=${item.topic || 'N/A'} | category=${item.category} | summary=${item.summary || ''}`,
      )
      .join('\n');
  }

  async flushEventQueue(agentId?: string): Promise<{ agents: number; events: number; topics: number }> {
    const keys = agentId ? [`${EVENT_KEY_PREFIX}${agentId}`] : await this.redisService.keys(`${EVENT_KEY_PREFIX}*`);
    if (!keys.length) return { agents: 0, events: 0, topics: 0 };

    let totalEvents = 0;
    let topicWrites = 0;
    const touchedAgents = new Set<string>();

    for (const key of keys) {
      const rows = await this.redisService.lrange(key, 0, -1);
      if (!rows.length) continue;
      const events = rows
        .map((row) => this.parseEvent(row))
        .filter((item): item is MemoryEvent => !!item)
        .reverse();
      if (!events.length) {
        await this.redisService.del(key);
        continue;
      }

      const ownerAgentId = events[0].agentId;
      touchedAgents.add(ownerAgentId);
      await this.ensureCoreDocuments(ownerAgentId);
      const grouped = new Map<string, MemoryEvent[]>();
      for (const event of events) {
        const topic = this.normalizeTopic(event.topic || this.inferTopicFromEvent(event));
        const list = grouped.get(topic) || [];
        list.push(event);
        grouped.set(topic, list);
      }

      for (const [topic, topicEvents] of grouped.entries()) {
        await this.mergeTopicEvents(ownerAgentId, topic, topicEvents);
        topicWrites += 1;
      }

      totalEvents += events.length;
      await this.redisService.del(key);
    }

    return {
      agents: touchedAgents.size,
      events: totalEvents,
      topics: topicWrites,
    };
  }

  async ensureCoreDocuments(agentId: string): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;

    await this.createIfMissing({
      agentId: normalizedAgentId,
      memoKind: 'identity',
      memoType: 'knowledge',
      category: 'profile',
      title: '身份与职责',
      slug: this.buildStableSlug('identity', '身份与职责'),
      content: [
        '# 身份与职责',
        '',
        '## Agent Profile',
        '',
        '- 角色：待补充',
        '- 核心职责：待补充',
        '- 日常工作：待补充',
        '',
        '## 工作偏好',
        '',
        '- 决策偏好：待补充',
        '- 协作偏好：待补充',
      ].join('\n'),
      tags: ['identity', 'responsibility'],
      contextKeywords: ['identity', 'role', 'responsibility'],
      source: 'system-seed',
    });

    await this.createIfMissing({
      agentId: normalizedAgentId,
      memoKind: 'todo',
      memoType: 'todo',
      category: 'tasks',
      title: 'TODO List',
      slug: this.buildStableSlug('todo', 'TODO List'),
      content: [
        '# TODO List',
        '',
        '## Tasks',
        '',
        '- No tasks yet.',
      ].join('\n'),
      todoStatus: 'pending',
      tags: ['todo'],
      contextKeywords: ['todo', 'task'],
      source: 'system-seed',
    });
  }

  private async createIfMissing(payload: CreateMemoInput): Promise<void> {
    const exists = await this.memoModel.findOne({ agentId: payload.agentId, slug: payload.slug }).exec();
    if (exists) return;
    await this.createMemo(payload);
  }

  private async mergeTopicEvents(agentId: string, topic: string, events: MemoryEvent[]): Promise<void> {
    if (!events.length) return;

    const slug = this.buildStableSlug('topic', topic, topic);
    const title = `专题积累: ${topic}`;
    const existing = await this.memoModel.findOne({ agentId, slug }).exec();
    const origin = existing?.content || this.buildTopicTemplate(topic);

    const appendable = events.filter((event) => !origin.includes(`[event:${event.id}]`));
    if (!appendable.length) return;

    const section = this.renderEventSection(appendable);
    const nextContent = `${origin.trim()}\n\n${section}`;

    const tags = this.uniqueStrings([
      ...(existing?.tags || []),
      ...appendable.flatMap((item) => item.tags || []),
      'topic',
      topic,
    ]);
    const keywords = this.uniqueStrings([
      ...(existing?.contextKeywords || []),
      ...appendable.flatMap((item) => this.extractKeywords(`${item.title || ''} ${item.details || ''}`)),
      topic,
    ]);

    await this.createMemo({
      agentId,
      memoKind: 'topic',
      memoType: 'knowledge',
      category: 'topic',
      title,
      slug,
      topic,
      content: nextContent,
      tags,
      contextKeywords: keywords,
      source: 'redis-aggregator',
    });
  }

  private renderEventSection(events: MemoryEvent[]): string {
    const ts = new Date().toISOString();
    const lines = [`## Update ${ts}`, ''];
    for (const event of events) {
      const line = [
        `- [event:${event.id}] ${event.event}`,
        event.taskId ? `task=${event.taskId}` : '',
        event.title ? `title=${this.compact(event.title, 80)}` : '',
        `tags=${event.tags.join(',') || 'N/A'}`,
      ]
        .filter(Boolean)
        .join(' | ');
      lines.push(line);
      lines.push(`  - detail: ${this.compact(event.details, 260)}`);
    }
    return lines.join('\n');
  }

  private buildTopicTemplate(topic: string): string {
    return [
      `# 专题积累: ${topic}`,
      '',
      '## Snapshot',
      '',
      `- topic: ${topic}`,
      `- lastUpdatedAt: ${new Date().toISOString()}`,
      '',
      '## Notes',
    ].join('\n');
  }

  private async getOrCreateTodoDocument(agentId: string): Promise<AgentMemo> {
    const slug = this.buildStableSlug('todo', 'TODO List');
    const doc = await this.memoModel.findOne({ agentId, slug }).exec();
    if (doc) return doc as unknown as AgentMemo;
    return this.createMemo({
      agentId,
      memoKind: 'todo',
      memoType: 'todo',
      category: 'tasks',
      title: 'TODO List',
      slug,
      content: '# TODO List\n\n## Tasks\n\n- No tasks yet.',
      todoStatus: 'pending',
      tags: ['todo'],
      contextKeywords: ['task', 'todo'],
      source: 'system-seed',
    });
  }

  private mergeTodoItem(
    markdown: string,
    payload: { taskId: string; title: string; description: string; status: MemoTodoStatus; note: string },
  ): string {
    const current = markdown || '# TODO List\n\n## Tasks\n';
    const lines = current.split('\n');
    const withoutSameTask = lines.filter((line) => !line.includes(`(taskId:${payload.taskId})`));
    const title = payload.title || `Task ${payload.taskId}`;
    const statusBox = payload.status === 'completed' ? 'x' : ' ';
    const detailParts = [`taskId:${payload.taskId}`, `status:${payload.status}`, `updated:${new Date().toISOString()}`];
    if (payload.note) detailParts.push(`note:${this.compact(payload.note, 80)}`);
    const desc = payload.description ? ` - ${this.compact(payload.description, 120)}` : '';
    const entry = `- [${statusBox}] ${title}${desc} (${detailParts.join(' ')})`;

    const insertIndex = withoutSameTask.findIndex((line) => line.trim().toLowerCase() === '## tasks');
    if (insertIndex >= 0) {
      withoutSameTask.splice(insertIndex + 1, 0, '', entry);
    } else {
      withoutSameTask.push('', '## Tasks', '', entry);
    }

    const result = withoutSameTask.join('\n').replace(/- No tasks yet\.\n?/g, '');
    return result.trim() + '\n';
  }

  private appendTodoStatusNote(content: string, status: MemoTodoStatus, note?: string): string {
    const marker = `- status-update: ${status} @ ${new Date().toISOString()}`;
    const detail = note?.trim() ? `${marker} | ${note.trim()}` : marker;
    return `${content.trim()}\n\n## Status Updates\n\n${detail}\n`;
  }

  private parseEvent(raw: string): MemoryEvent | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.agentId || !parsed.event || !parsed.id) return null;
      return {
        id: String(parsed.id),
        agentId: String(parsed.agentId),
        event: parsed.event,
        taskId: parsed.taskId ? String(parsed.taskId) : undefined,
        title: parsed.title ? String(parsed.title) : undefined,
        details: String(parsed.details || ''),
        tags: this.uniqueStrings(Array.isArray(parsed.tags) ? parsed.tags : []),
        topic: parsed.topic ? String(parsed.topic) : undefined,
        createdAt: String(parsed.createdAt || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  private inferTopicFromEvent(event: MemoryEvent): string {
    const source = `${event.title || ''} ${event.details || ''} ${(event.tags || []).join(' ')}`.toLowerCase();
    if (source.includes('系统') || source.includes('system') || source.includes('功能') || source.includes('feature')) {
      return 'system-status';
    }
    if (source.includes('部门') || source.includes('department') || source.includes('进度') || source.includes('progress')) {
      return 'department-progress';
    }
    if (event.tags?.length) return event.tags[0];
    return 'general';
  }

  private buildQuery(filters?: ListMemoFilters): Record<string, any> {
    const query: Record<string, any> = {};
    if (filters?.agentId?.trim()) query.agentId = filters.agentId.trim();
    if (filters?.category?.trim()) query.category = filters.category.trim();
    if (filters?.memoType) query.memoType = filters.memoType;
    if (filters?.memoKind) query.memoKind = filters.memoKind;
    if (filters?.topic?.trim()) query.topic = filters.topic.trim();
    if (filters?.todoStatus) query.todoStatus = filters.todoStatus;
    if (filters?.search?.trim()) {
      const regex = new RegExp(this.escapeRegex(filters.search.trim()), 'i');
      query.$or = [{ title: regex }, { content: regex }, { category: regex }, { tags: regex }, { contextKeywords: regex }, { topic: regex }];
    }
    return query;
  }

  private resolveMemoDefaults(memoKind?: MemoKind, memoType?: MemoType): { memoKind: MemoKind; memoType: MemoType } {
    const resolvedKind = memoKind || (memoType === 'todo' ? 'todo' : 'topic');
    if (resolvedKind === 'todo') return { memoKind: 'todo', memoType: 'todo' };
    if (resolvedKind === 'identity') return { memoKind: 'identity', memoType: 'knowledge' };
    return { memoKind: 'topic', memoType: memoType || 'knowledge' };
  }

  private buildStableSlug(kind: MemoKind, title: string, topic?: string): string {
    if (kind === 'identity') return 'identity-and-responsibilities';
    if (kind === 'todo') return 'todo-list';
    const base = this.normalizeTopic(topic || title || 'general');
    return `topic-${base}`;
  }

  private defaultCategoryByKind(kind: MemoKind): string {
    if (kind === 'identity') return 'profile';
    if (kind === 'todo') return 'tasks';
    return 'topic';
  }

  private normalizeTopic(value: string): string {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    return normalized || 'general';
  }

  private uniqueStrings(items: string[]): string[] {
    return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  private toSummary(content: string, maxLength: number): string {
    const normalized = String(content || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private extractKeywords(content: string): string[] {
    const tokens = String(content || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .slice(0, 32);
    return Array.from(new Set(tokens));
  }

  private compact(content: string, maxLength: number): string {
    const normalized = String(content || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async touchMemoAccess(id: string): Promise<void> {
    await this.memoModel
      .findOneAndUpdate({ id }, { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } }, { new: false })
      .exec();
  }

  private async syncMemoSafely(memo: AgentMemo): Promise<void> {
    try {
      await this.memoDocSyncService.syncMemo(memo);
    } catch (error) {
      this.memoDocSyncService.reportSyncError(error, `Failed to sync memo doc ${memo.id}`);
    }
  }

  private async removeMemoSafely(memo: AgentMemo): Promise<void> {
    try {
      await this.memoDocSyncService.removeMemo(memo);
    } catch (error) {
      this.memoDocSyncService.reportSyncError(error, `Failed to remove memo doc ${memo.id}`);
    }
  }

  private async rebuildIndexSafely(): Promise<void> {
    try {
      const memos = await this.memoModel.find().sort({ updatedAt: -1 }).exec();
      await this.memoDocSyncService.rebuildIndex(memos as unknown as AgentMemo[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Memo index rebuild skipped: ${message}`);
    }
  }
}
