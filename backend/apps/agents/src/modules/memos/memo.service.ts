import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RedisService } from '@libs/infra';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentMemo, AgentMemoDocument, MemoKind, MemoType } from '../../schemas/agent-memo.schema';
import { AgentMemoVersion, AgentMemoVersionDocument } from '../../schemas/agent-memo-version.schema';
import { MemoDocSyncService } from './memo-doc-sync.service';
import { MemoTaskHistoryService, TaskStatus } from './memo-task-history.service';
import { MemoTaskTodoService, TaskSourceType, TodoTaskItem } from './memo-task-todo.service';

const EVENT_KEY_PREFIX = 'memo:event:';
const REFRESH_KEY_PREFIX = 'memo:refresh:queue';
const EVENT_QUEUE_TTL_SECONDS = 7 * 24 * 3600;
const EVENT_QUEUE_MAX = 1000;

const HISTORY_STATUSES: ReadonlySet<string> = new Set(['running', 'success', 'failed', 'cancelled']);

interface CreateMemoInput {
  agentId: string;
  title: string;
  content: string;
  memoType?: MemoType;
  memoKind?: MemoKind;
  payload?: Record<string, any>;
  slug?: string;
  tags?: string[];
  contextKeywords?: string[];
  source?: string;
}

interface MemoActorContext {
  employeeId?: string;
  role?: string;
}

interface MemoMutationOptions {
  skipEnsureCoreDocs?: boolean;
  actor?: MemoActorContext;
  skipRolePermissionCheck?: boolean;
}

interface ListMemoFilters {
  agentId?: string;
  memoType?: MemoType;
  memoKind?: MemoKind;
  topic?: string;
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
  private readonly topicAggregationEnabled = String(process.env.MEMO_TOPIC_AGGREGATION_ENABLED || 'false').toLowerCase() === 'true';

  private readonly achievementAllowedRoles = [
    'executive',
    'executive-lead',
    'management-assistant',
    'human-exclusive-assistant',
    'hr',
    'human-resources',
    'human-resources-manager',
  ];

  private readonly criticismAllowedRoles = [...this.achievementAllowedRoles, 'agent'];

  private readonly appendOnlyMemoKinds: MemoKind[] = ['achievement', 'criticism'];

  constructor(
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
    @InjectModel(AgentMemoVersion.name) private readonly memoVersionModel: Model<AgentMemoVersionDocument>,
    private readonly memoDocSyncService: MemoDocSyncService,
    private readonly redisService: RedisService,
    private readonly memoTaskTodoService: MemoTaskTodoService,
    private readonly memoTaskHistoryService: MemoTaskHistoryService,
  ) {}

  async createMemo(payload: CreateMemoInput, options?: MemoMutationOptions): Promise<AgentMemo> {
    if (!payload?.agentId?.trim()) throw new BadRequestException('agentId is required');
    if (!payload?.title?.trim()) throw new BadRequestException('title is required');
    if (!payload?.content?.trim()) throw new BadRequestException('content is required');

    const agentId = payload.agentId.trim();
    this.assertMemoTypeKindCompatibility(payload.memoKind, payload.memoType, 'create');
    const defaults = this.resolveMemoDefaults(payload.memoKind, payload.memoType);
    if (!options?.skipRolePermissionCheck) {
      this.assertMemoWritePermission(defaults.memoKind, agentId, payload.source, options?.actor);
    }
    if (!options?.skipEnsureCoreDocs) {
      await this.ensureCoreDocuments(agentId);
    }

    const nextPayload = payload.payload || {};
    const resolvedTopic = typeof nextPayload.topic === 'string' ? nextPayload.topic : undefined;
    const resolvedTitle = this.resolveCanonicalMemoTitle(defaults.memoKind, payload.title);
    const slug = payload.slug?.trim() || this.buildStableSlug(payload.memoKind || 'topic', payload.title, resolvedTopic);
    const nextTags = this.uniqueStrings(payload.tags || []);
    const nextKeywords = this.uniqueStrings(payload.contextKeywords || []);

    const upsertFilter = this.buildUpsertFilter(agentId, defaults.memoKind, slug);
    const existed = await this.memoModel.findOne(upsertFilter).exec();
    if (existed) {
      if (this.isAppendOnlyMemoKind(defaults.memoKind)) {
        return this.updateMemo(
          existed.id,
          {
            ...payload,
            title: existed.title,
            memoKind: defaults.memoKind,
            memoType: defaults.memoType,
            slug: existed.slug,
            content: this.appendWithDivider(existed.content, payload.content),
            payload: {
              ...((existed.payload as Record<string, any>) || {}),
              ...(nextPayload || {}),
            },
            tags: this.uniqueStrings([...(existed.tags || []), ...nextTags]),
            contextKeywords: this.uniqueStrings([...(existed.contextKeywords || []), ...nextKeywords]),
          },
          options,
        );
      }
      return this.updateMemo(existed.id, {
        ...payload,
        memoKind: defaults.memoKind,
        memoType: defaults.memoType,
        slug,
      }, options);
    }

    const updated = await this.memoModel
      .findOneAndUpdate(
        upsertFilter,
        {
          $set: {
            agentId,
            title: resolvedTitle,
            slug,
            content: payload.content.trim(),
            version: 1,
            memoType: defaults.memoType,
            memoKind: defaults.memoKind,
            payload: this.toNormalizedPayload(defaults.memoKind, nextPayload, payload.title),
            tags: nextTags,
            contextKeywords: nextKeywords,
            source: payload.source || 'agent',
            updatedAt: new Date(),
          },
          $setOnInsert: {
            id: uuidv4(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (defaults.memoKind === 'identity' || defaults.memoKind === 'todo') {
      await this.cleanupCoreDocDuplicates(agentId, defaults.memoKind, (updated as any)?.id);
    }

    await this.syncMemoSafely(updated as unknown as AgentMemo);
    await this.refreshMemoCacheByKind(agentId, defaults.memoKind);
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
    return memo as unknown as AgentMemo;
  }

  async updateMemo(id: string, updates: Partial<CreateMemoInput>, options?: MemoMutationOptions): Promise<AgentMemo> {
    const existing = await this.memoModel.findOne({ id }).exec();
    if (!existing) throw new NotFoundException(`Memo not found: ${id}`);

    this.assertMemoTypeKindCompatibility(
      (updates.memoKind || existing.memoKind || 'topic') as MemoKind,
      updates.memoType,
      'update',
    );
    const defaults = this.resolveMemoDefaults(
      (updates.memoKind || existing.memoKind || 'topic') as MemoKind,
      (updates.memoType || existing.memoType || 'knowledge') as MemoType,
    );
    const memoKind = defaults.memoKind;
    const memoType = defaults.memoType;
    if (!options?.skipRolePermissionCheck) {
      this.assertMemoWritePermission(memoKind, existing.agentId, updates.source || existing.source, options?.actor);
    }
    const nextTitle = this.resolveCanonicalMemoTitle(memoKind, updates.title?.trim() || existing.title);
    const mergedPayload = this.toNormalizedPayload(
      memoKind,
      {
        ...((existing.payload as Record<string, any>) || {}),
        ...((updates.payload as Record<string, any>) || {}),
      },
      nextTitle,
    );

    const payload: Record<string, any> = {
      updatedAt: new Date(),
      title: nextTitle,
      memoKind,
      memoType,
      payload: mergedPayload,
      version: Math.max(1, Number(existing.version || 1)) + 1,
    };

    if (updates.content) payload.content = updates.content.trim();
    if (updates.tags) payload.tags = this.uniqueStrings(updates.tags);
    if (updates.contextKeywords) payload.contextKeywords = this.uniqueStrings(updates.contextKeywords);
    if (updates.source) payload.source = updates.source;

    const nextTopic = typeof mergedPayload.topic === 'string' ? mergedPayload.topic : undefined;
    const nextSlug =
      updates.slug?.trim() ||
      (updates.title || updates.payload || updates.memoKind
        ? this.buildStableSlug(memoKind, nextTitle, nextTopic)
        : existing.slug);
    payload.slug = nextSlug;

    await this.createMemoVersionSnapshot(existing as unknown as AgentMemo, this.resolveChangeNote(updates));

    const updated = await this.memoModel.findOneAndUpdate({ id }, payload, { new: true }).exec();
    if (!updated) throw new NotFoundException(`Memo not found: ${id}`);

    if (memoKind === 'identity' || memoKind === 'todo') {
      await this.cleanupCoreDocDuplicates(updated.agentId, memoKind, updated.id);
    }

    if (existing.slug !== updated.slug || existing.agentId !== updated.agentId) {
      await this.removeMemoSafely(existing as unknown as AgentMemo);
    }
    await this.syncMemoSafely(updated as unknown as AgentMemo);
    await this.refreshMemoCacheByKind(updated.agentId, updated.memoKind as MemoKind);
    await this.rebuildIndexSafely();
    return updated as unknown as AgentMemo;
  }

  async deleteMemo(id: string): Promise<boolean> {
    const existing = await this.memoModel.findOne({ id }).exec();
    if (!existing) return false;
    await this.memoModel.deleteOne({ id }).exec();
    await this.removeMemoSafely(existing as unknown as AgentMemo);
    await this.refreshMemoCacheByKind(existing.agentId, existing.memoKind as MemoKind);
    await this.rebuildIndexSafely();
    return true;
  }

  async searchMemos(
    agentId: string,
    query: string,
    options?: {
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
    if (options?.memoType) filter.memoType = options.memoType;
    if (options?.memoKind) filter.memoKind = options.memoKind;
    if (options?.topic?.trim()) filter['payload.topic'] = options.topic.trim();

    const keyword = String(query || '').trim();
    if (keyword) {
      const escaped = this.escapeRegex(keyword);
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ title: regex }, { content: regex }, { tags: regex }, { contextKeywords: regex }, { 'payload.topic': regex }];
    }

    const memos = await this.memoModel.find(filter).sort({ updatedAt: -1 }).limit(limit).exec();

    return memos.map((memo) => {
      const base = {
        id: memo.id,
        title: memo.title,
        memoType: memo.memoType,
        memoKind: memo.memoKind,
        topic: (memo.payload as Record<string, any> | undefined)?.topic,
        tags: memo.tags || [],
        updatedAt: memo.updatedAt,
      };

      if (options?.detail === true) {
        return {
          ...base,
          content: memo.content,
          source: memo.source,
          payload: memo.payload || {},
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

  async upsertTaskTodo(
    agentId: string,
    task: {
      id?: string;
      title?: string;
      description?: string;
      status?: TaskStatus;
      note?: string;
      sourceType?: TaskSourceType;
      orchestrationId?: string;
      priority?: 'low' | 'medium' | 'high';
    },
  ): Promise<AgentMemo> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) throw new BadRequestException('agentId is required');
    await this.ensureCoreDocuments(normalizedAgentId);

    const taskId = String(task?.id || uuidv4()).trim();
    const title = String(task?.title || 'Untitled task').trim();
    const description = String(task?.description || '').trim();
    const sourceType = this.memoTaskTodoService.normalizeTaskSourceType(task?.sourceType);
    if (sourceType !== 'orchestration_task') {
      throw new BadRequestException(`todo only accepts sourceType=orchestration_task, received ${sourceType}`);
    }

    const status = this.memoTaskTodoService.normalizeTaskStatus(task?.status);
    const nowIso = new Date().toISOString();

    if (HISTORY_STATUSES.has(status)) {
      if (!this.memoTaskHistoryService.isHistoryStatus(status)) {
        throw new BadRequestException(`invalid history status: ${status}`);
      }
      return this.upsertTaskHistory({
        agentId: normalizedAgentId,
        taskId,
        title,
        description,
        status,
        note: task?.note,
        sourceType,
        orchestrationId: task?.orchestrationId,
        priority: task?.priority,
        at: nowIso,
      });
    }
    if (!this.memoTaskTodoService.isTodoActiveStatus(status)) {
      throw new BadRequestException(`invalid todo status: ${status}`);
    }

    const todoDoc = await this.getOrCreateTodoDocument(normalizedAgentId);
    const todoItems = this.memoTaskTodoService.readTodoItems(todoDoc.payload);
    const nextTodoItems = this.memoTaskTodoService.upsertTodoItem(todoItems, {
      taskId,
      title,
      description,
      status,
      orchestrationId: task?.orchestrationId,
      priority: task?.priority,
      sourceType,
      updatedAt: nowIso,
      note: task?.note,
    });

    return this.updateMemo(todoDoc.id, {
      memoKind: 'todo',
      memoType: 'standard',
      title: todoDoc.title,
      content: this.memoTaskTodoService.renderTodoContent(nextTodoItems, this.compact.bind(this)),
      payload: {
        ...((todoDoc.payload as Record<string, any>) || {}),
        status,
        sourceType,
        tasks: nextTodoItems,
      },
      tags: this.uniqueStrings([...(todoDoc.tags || []), 'task', 'todo']),
      contextKeywords: this.uniqueStrings([...(todoDoc.contextKeywords || []), ...this.extractKeywords(`${title} ${description}`)]),
    });
  }

  async updateTodoStatus(
    id: string,
    status: TaskStatus,
    note?: string,
    options?: { taskId?: string; sourceType?: TaskSourceType },
  ): Promise<AgentMemo> {
    const todoDoc = await this.memoModel.findOne({ id, memoKind: 'todo' }).exec();
    if (!todoDoc) throw new NotFoundException(`TODO memo not found: ${id}`);

    const sourceType = this.memoTaskTodoService.normalizeTaskSourceType(options?.sourceType);
    if (sourceType !== 'orchestration_task') {
      throw new BadRequestException(`todo status update only accepts sourceType=orchestration_task, received ${sourceType}`);
    }

    const normalizedStatus = this.memoTaskTodoService.normalizeTaskStatus(status);
    const todoItems = this.memoTaskTodoService.readTodoItems(todoDoc.payload);
    const targetTaskId = String(options?.taskId || '').trim() || todoItems[0]?.taskId;

    if (!targetTaskId) {
      throw new BadRequestException('taskId is required when updating todo status');
    }

    const targetTask = todoItems.find((item) => item.taskId === targetTaskId);
    if (!targetTask) {
      throw new NotFoundException(`TODO task not found in memo ${id}: ${targetTaskId}`);
    }

    if (HISTORY_STATUSES.has(normalizedStatus)) {
      if (!this.memoTaskHistoryService.isHistoryStatus(normalizedStatus)) {
        throw new BadRequestException(`invalid history status: ${normalizedStatus}`);
      }
      await this.upsertTaskHistory({
        agentId: todoDoc.agentId,
        taskId: targetTask.taskId,
        title: targetTask.title,
        description: targetTask.description,
        status: normalizedStatus,
        note,
        sourceType,
        orchestrationId: targetTask.orchestrationId,
        priority: targetTask.priority,
      });

      const nextTodoItems = todoItems.filter((item) => item.taskId !== targetTaskId);
      return this.updateMemo(id, {
        memoKind: 'todo',
        memoType: 'standard',
        payload: {
          ...((todoDoc.payload as Record<string, any>) || {}),
          status: nextTodoItems[0]?.status || 'pending',
          sourceType,
          tasks: nextTodoItems,
        },
          content: this.memoTaskTodoService.renderTodoContent(nextTodoItems, this.compact.bind(this)),
      });
    }

    if (!this.memoTaskTodoService.isTodoActiveStatus(normalizedStatus)) {
      throw new BadRequestException(`invalid todo status: ${normalizedStatus}`);
    }

    const nextTodoItems = this.memoTaskTodoService.upsertTodoItem(todoItems, {
      ...targetTask,
      status: normalizedStatus,
      updatedAt: new Date().toISOString(),
      note,
    });

    return this.updateMemo(id, {
      memoKind: 'todo',
      memoType: 'standard',
      payload: {
        ...((todoDoc.payload as Record<string, any>) || {}),
        status: normalizedStatus,
        sourceType,
        tasks: nextTodoItems,
      },
      content: this.memoTaskTodoService.renderTodoContent(nextTodoItems, this.compact.bind(this)),
    });
  }

  async completeTaskTodo(
    agentId: string,
    taskId?: string,
    note?: string,
    status: 'success' | 'failed' | 'cancelled' = 'success',
  ): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedAgentId || !normalizedTaskId) return;

    const todoDoc = await this.memoModel.findOne({ agentId: normalizedAgentId, memoKind: 'todo' }).exec();
    const todoItems = todoDoc ? this.memoTaskTodoService.readTodoItems(todoDoc.payload) : [];
    const existingTodoTask = todoItems.find((item) => item.taskId === normalizedTaskId);

    await this.upsertTaskHistory({
      agentId: normalizedAgentId,
      taskId: normalizedTaskId,
      title: existingTodoTask?.title || `Task ${normalizedTaskId}`,
      description: existingTodoTask?.description,
      status,
      note,
      sourceType: 'orchestration_task',
      orchestrationId: existingTodoTask?.orchestrationId,
      priority: existingTodoTask?.priority,
    });

    if (!todoDoc) return;

    const nextTodoItems = todoItems.filter((item) => item.taskId !== normalizedTaskId);
    await this.updateMemo(todoDoc.id, {
      memoKind: 'todo',
      memoType: 'standard',
      payload: {
        ...((todoDoc.payload as Record<string, any>) || {}),
        status: nextTodoItems[0]?.status || 'pending',
        sourceType: 'orchestration_task',
        tasks: nextTodoItems,
      },
      content: this.memoTaskTodoService.renderTodoContent(nextTodoItems, this.compact.bind(this)),
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
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return '';

    const candidateKinds: MemoKind[] = ['identity', 'todo', 'history', 'topic', 'custom'];
    const matched = await this.searchMemosFromCache(normalizedAgentId, query, candidateKinds, 4);
    if (matched.length) {
      return matched
        .map(
          (item, idx) =>
            `${idx + 1}. [${item.memoKind}] ${item.title} | topic=${item.topic || 'N/A'} | summary=${item.summary || ''}`,
        )
        .join('\n');
    }

    const dbMatched = await this.searchMemos(agentId, query, {
      limit: 4,
      progressive: true,
      detail: false,
    });
    if (!dbMatched.length) return '';
    return dbMatched
      .map(
        (item, idx) =>
          `${idx + 1}. [${item.memoKind}] ${item.title} | topic=${item.topic || 'N/A'} | summary=${item.summary || ''}`,
      )
      .join('\n');
  }

  async getIdentityMemos(agentId: string): Promise<AgentMemo[]> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return [];
    return (await this.memoModel
      .find({ agentId: normalizedAgentId, memoKind: 'identity' })
      .sort({ updatedAt: -1 })
      .limit(5)
      .exec()) as unknown as AgentMemo[];
  }

  async getFirstMemoContentMapByKind(agentIds: string[], memoKind: MemoKind): Promise<Map<string, string>> {
    const normalizedAgentIds = Array.from(new Set((agentIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
    const result = new Map<string, string>();
    if (!normalizedAgentIds.length) {
      return result;
    }

    const docs = await this.memoModel
      .find({
        agentId: { $in: normalizedAgentIds },
        memoKind,
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    for (const doc of docs) {
      const agentId = String((doc as any)?.agentId || '').trim();
      if (!agentId || result.has(agentId)) continue;
      result.set(agentId, String((doc as any)?.content || ''));
    }

    return result;
  }

  async enqueueRefreshTask(payload: {
    agentId: string;
    memoKinds?: MemoKind[];
    reason?: string;
    taskId?: string;
    summary?: string;
  }): Promise<{ queued: boolean; key: string }> {
    const agentId = String(payload.agentId || '').trim();
    if (!agentId) return { queued: false, key: '' };
    const key = `${REFRESH_KEY_PREFIX}:${agentId}`;
    const memoKinds = this.uniqueMemoKinds(payload.memoKinds || ['identity']);
    await this.redisService.lpush(
      key,
      JSON.stringify({
        id: uuidv4(),
        agentId,
        memoKinds,
        reason: payload.reason || 'manual',
        taskId: payload.taskId,
        summary: payload.summary,
        createdAt: new Date().toISOString(),
      }),
    );
    await this.redisService.ltrim(key, 0, EVENT_QUEUE_MAX - 1);
    await this.redisService.expire(key, EVENT_QUEUE_TTL_SECONDS);
    return { queued: true, key };
  }

  async flushRefreshQueue(agentId?: string): Promise<{ jobs: number; agents: number; writes: number }> {
    const normalizedAgentId = String(agentId || '').trim();
    const keys = normalizedAgentId
      ? [`${REFRESH_KEY_PREFIX}:${normalizedAgentId}`]
      : await this.redisService.keys(`${REFRESH_KEY_PREFIX}:*`);
    if (!keys.length) return { jobs: 0, agents: 0, writes: 0 };

    let jobs = 0;
    let writes = 0;
    const agentSet = new Set<string>();
    for (const key of keys) {
      const rows = await this.redisService.lrange(key, 0, -1);
      if (!rows.length) continue;

      const grouped = new Map<string, Set<MemoKind>>();
      for (const row of rows) {
        try {
          const item = JSON.parse(row);
          const owner = String(item.agentId || '').trim();
          if (!owner) continue;
          agentSet.add(owner);
          jobs += 1;
          const current = grouped.get(owner) || new Set<MemoKind>();
          this.uniqueMemoKinds(item.memoKinds || ['identity']).forEach((memoKind) => current.add(memoKind));
          grouped.set(owner, current);
        } catch {
          continue;
        }
      }

      for (const [owner, kinds] of grouped.entries()) {
        for (const memoKind of kinds) {
          await this.refreshMemoCacheByKind(owner, memoKind);
          writes += 1;
        }
      }

      await this.redisService.del(key);
    }

    return { jobs, agents: agentSet.size, writes };
  }

  async flushEventQueue(agentId?: string): Promise<{ agents: number; events: number; topics: number }> {
    const keys = agentId ? [`${EVENT_KEY_PREFIX}${agentId}`] : await this.redisService.keys(`${EVENT_KEY_PREFIX}*`);
    if (!keys.length) return { agents: 0, events: 0, topics: 0 };

    if (!this.topicAggregationEnabled) {
      let discardedEvents = 0;
      const touchedAgents = new Set<string>();
      for (const key of keys) {
        const rows = await this.redisService.lrange(key, 0, -1);
        if (!rows.length) {
          await this.redisService.del(key);
          continue;
        }
        const events = rows
          .map((row) => this.parseEvent(row))
          .filter((item): item is MemoryEvent => !!item);
        for (const event of events) {
          touchedAgents.add(event.agentId);
        }
        discardedEvents += events.length;
        await this.redisService.del(key);
      }
      if (discardedEvents > 0) {
        this.logger.log(`Topic aggregation paused, discarded events=${discardedEvents}, agents=${touchedAgents.size}`);
      }
      return {
        agents: touchedAgents.size,
        events: discardedEvents,
        topics: 0,
      };
    }

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

  async getAggregationStatus(agentId?: string): Promise<{
    redisReady: boolean;
    queueKeys: number;
    queuedEvents: number;
    refreshQueueKeys: number;
    refreshJobs: number;
    latestMemoUpdatedAt?: string;
    memoDocuments: number;
    agentId?: string;
  }> {
    const normalizedAgentId = String(agentId || '').trim();
    const keys = normalizedAgentId
      ? [`${EVENT_KEY_PREFIX}${normalizedAgentId}`]
      : await this.redisService.keys(`${EVENT_KEY_PREFIX}*`);

    let queuedEvents = 0;
    for (const key of keys) {
      queuedEvents += await this.redisService.llen(key);
    }

    const refreshKeys = normalizedAgentId
      ? [`${REFRESH_KEY_PREFIX}:${normalizedAgentId}`]
      : await this.redisService.keys(`${REFRESH_KEY_PREFIX}:*`);
    let refreshJobs = 0;
    for (const key of refreshKeys) {
      refreshJobs += await this.redisService.llen(key);
    }

    const memoFilter = normalizedAgentId ? { agentId: normalizedAgentId } : {};
    const [latest, count] = await Promise.all([
      this.memoModel.findOne(memoFilter).sort({ updatedAt: -1 }).exec(),
      this.memoModel.countDocuments(memoFilter).exec(),
    ]);

    return {
      redisReady: this.redisService.isReady(),
      queueKeys: keys.length,
      queuedEvents,
      refreshQueueKeys: refreshKeys.length,
      refreshJobs,
      memoDocuments: count,
      latestMemoUpdatedAt: latest?.updatedAt ? new Date(latest.updatedAt).toISOString() : undefined,
      agentId: normalizedAgentId || undefined,
    };
  }

  async repairCoreDocuments(agentId?: string): Promise<{ agents: number; fixedDocs: number }> {
    const targetAgentId = String(agentId || '').trim();
    const agentIds = targetAgentId ? [targetAgentId] : ((await this.memoModel.distinct('agentId').exec()) as string[]);
    let fixedDocs = 0;

    for (const id of agentIds) {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) continue;
      await this.ensureCoreDocuments(normalizedId);
      const beforeIdentity = await this.memoModel.countDocuments({ agentId: normalizedId, memoKind: 'identity' }).exec();
      const beforeTodo = await this.memoModel.countDocuments({ agentId: normalizedId, memoKind: 'todo' }).exec();
      await this.cleanupCoreDocDuplicates(normalizedId, 'identity');
      await this.cleanupCoreDocDuplicates(normalizedId, 'todo');
      const afterIdentity = await this.memoModel.countDocuments({ agentId: normalizedId, memoKind: 'identity' }).exec();
      const afterTodo = await this.memoModel.countDocuments({ agentId: normalizedId, memoKind: 'todo' }).exec();
      fixedDocs += Math.max(0, beforeIdentity - afterIdentity) + Math.max(0, beforeTodo - afterTodo);
    }

    await this.rebuildIndexSafely();
    return {
      agents: agentIds.length,
      fixedDocs,
    };
  }

  async ensureCoreDocuments(agentId: string): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;

    await this.createIfMissing({
      agentId: normalizedAgentId,
      memoKind: 'identity',
      memoType: 'standard',
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
      payload: {
        topic: 'identity',
      },
      tags: ['identity', 'responsibility'],
      contextKeywords: ['identity', 'role', 'responsibility'],
      source: 'system-seed',
    });

    await this.createIfMissing({
      agentId: normalizedAgentId,
      memoKind: 'todo',
      memoType: 'standard',
      title: 'TODO List',
      slug: this.buildStableSlug('todo', 'TODO List'),
      content: [
        '# TODO List',
        '',
        '## Tasks',
        '',
        '- No tasks yet.',
      ].join('\n'),
      payload: {
        topic: 'todo',
        status: 'pending',
      },
      tags: ['todo'],
      contextKeywords: ['todo', 'task'],
      source: 'system-seed',
    });
  }

  private async createIfMissing(payload: CreateMemoInput): Promise<void> {
    const defaults = this.resolveMemoDefaults(payload.memoKind, payload.memoType);
    const topic = typeof payload.payload?.topic === 'string' ? payload.payload.topic : undefined;
    const slug = payload.slug || this.buildStableSlug(defaults.memoKind, payload.title, topic);
    const exists = await this.memoModel.findOne(this.buildUpsertFilter(payload.agentId, defaults.memoKind, slug)).exec();
    if (exists) return;
    await this.createMemo(payload, { skipEnsureCoreDocs: true });
  }

  private buildUpsertFilter(agentId: string, memoKind: MemoKind, slug: string): Record<string, any> {
    if (memoKind === 'identity' || memoKind === 'todo' || this.isAppendOnlyMemoKind(memoKind)) {
      return { agentId, memoKind };
    }
    return { agentId, slug };
  }

  private async cleanupCoreDocDuplicates(agentId: string, memoKind: MemoKind, keepId?: string): Promise<void> {
    if (memoKind !== 'identity' && memoKind !== 'todo') return;
    const docs = await this.memoModel.find({ agentId, memoKind }).sort({ updatedAt: -1, createdAt: -1 }).exec();
    if (docs.length <= 1) return;

    const keeper = keepId ? docs.find((doc) => doc.id === keepId) || docs[0] : docs[0];
    const stale = docs.filter((doc) => doc.id !== keeper.id);
    for (const doc of stale) {
      await this.memoModel.deleteOne({ id: doc.id }).exec();
      await this.removeMemoSafely(doc as unknown as AgentMemo);
    }
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
      title,
      slug,
      payload: {
        ...((existing?.payload as Record<string, any>) || {}),
        topic,
      },
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
    const doc = await this.memoModel.findOne({ agentId, memoKind: 'todo' }).exec();
    if (doc) return doc as unknown as AgentMemo;
    return this.createMemo({
      agentId,
      memoKind: 'todo',
      memoType: 'standard',
      title: 'TODO List',
      slug,
      content: '# TODO List\n\n## Tasks\n\n- No tasks yet.',
      payload: {
        topic: 'todo',
        status: 'pending',
        sourceType: 'orchestration_task',
        tasks: [],
      },
      tags: ['todo'],
      contextKeywords: ['task', 'todo'],
      source: 'system-seed',
    });
  }

  private async getOrCreateHistoryDocument(agentId: string): Promise<AgentMemo> {
    const slug = this.buildStableSlug('history', 'History Log');
    const doc = await this.memoModel.findOne({ agentId, memoKind: 'history' }).exec();
    if (doc) return doc as unknown as AgentMemo;
    return this.createMemo({
      agentId,
      memoKind: 'history',
      memoType: 'standard',
      title: 'History Log',
      slug,
      content: '# History Log\n\n## Executed Tasks\n\n- No executed tasks yet.',
      payload: {
        topic: 'history',
        sourceType: 'orchestration_task',
        tasks: [],
      },
      tags: ['history', 'task'],
      contextKeywords: ['history', 'task', 'status'],
      source: 'system-seed',
    });
  }

  private async upsertTaskHistory(payload: {
    agentId: string;
    taskId: string;
    title: string;
    description?: string;
    status: 'running' | 'success' | 'failed' | 'cancelled';
    note?: string;
    sourceType: 'orchestration_task';
    orchestrationId?: string;
    priority?: 'low' | 'medium' | 'high';
    at?: string;
  }): Promise<AgentMemo> {
    const historyDoc = await this.getOrCreateHistoryDocument(payload.agentId);
    const historyItems = this.memoTaskHistoryService.readHistoryItems(historyDoc.payload);
    const compactedNote = payload.note ? this.compact(payload.note, 200) : undefined;
    const { nextItems, status } = this.memoTaskHistoryService.upsertHistoryItem(historyItems, {
      taskId: payload.taskId,
      title: payload.title,
      description: payload.description,
      status: payload.status,
      note: compactedNote,
      sourceType: payload.sourceType,
      orchestrationId: payload.orchestrationId,
      priority: payload.priority,
      at: payload.at,
      maxItems: 500,
    });

    return this.updateMemo(historyDoc.id, {
      memoKind: 'history',
      memoType: 'standard',
      title: historyDoc.title,
      content: this.memoTaskHistoryService.renderHistoryContent(nextItems, this.compact.bind(this)),
      payload: {
        ...((historyDoc.payload as Record<string, any>) || {}),
        topic: 'history',
        sourceType: payload.sourceType,
        status,
        tasks: nextItems,
      },
      tags: this.uniqueStrings([...(historyDoc.tags || []), 'history', 'task']),
      contextKeywords: this.uniqueStrings([
        ...(historyDoc.contextKeywords || []),
        ...this.extractKeywords(`${payload.title} ${payload.description || ''} ${payload.status}`),
      ]),
    });
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

  private assertMemoWritePermission(
    memoKind: MemoKind,
    agentId: string,
    source?: string,
    actor?: MemoActorContext,
  ): void {
    if (memoKind !== 'achievement' && memoKind !== 'criticism') {
      return;
    }

    const normalizedRole = this.normalizeActorValue(actor?.role);
    const normalizedSource = this.normalizeActorValue(source);
    const normalizedEmployeeId = this.normalizeActorValue(actor?.employeeId);
    const normalizedAgentId = this.normalizeActorValue(agentId);
    const isAgentSelf = normalizedRole === 'agent' && normalizedEmployeeId && normalizedEmployeeId === normalizedAgentId;
    const matchedAchievementRole = this.achievementAllowedRoles.some((role) => this.roleMatches(normalizedRole, role));

    if (memoKind === 'achievement') {
      if (isAgentSelf || this.roleMatches(normalizedSource, 'agent')) {
        throw new ForbiddenException('achievement memo can only be recorded by executive/human-exclusive-assistant/hr');
      }
      if (!matchedAchievementRole) {
        throw new ForbiddenException('achievement memo requires executive/human-exclusive-assistant/hr role');
      }
      return;
    }

    const matchedCriticismRole = this.criticismAllowedRoles.some((role) => this.roleMatches(normalizedRole, role));
    if (isAgentSelf || this.roleMatches(normalizedSource, 'agent') || matchedCriticismRole) {
      return;
    }

    throw new ForbiddenException('criticism memo requires executive/human-exclusive-assistant/hr/agent role');
  }

  private normalizeActorValue(value?: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private roleMatches(normalizedValue: string, expected: string): boolean {
    if (!normalizedValue) return false;
    if (normalizedValue === expected) return true;
    if (normalizedValue.includes(expected)) return true;
    if (expected === 'executive' && normalizedValue.includes('high-management')) return true;
    if (expected === 'human-exclusive-assistant' && normalizedValue.includes('exclusive-assistant')) return true;
    if (expected === 'hr' && (normalizedValue.includes('human-resource') || normalizedValue.includes('human-resources'))) {
      return true;
    }
    return false;
  }

  private buildQuery(filters?: ListMemoFilters): Record<string, any> {
    const query: Record<string, any> = {};
    if (filters?.agentId?.trim()) query.agentId = filters.agentId.trim();
    if (filters?.memoType) query.memoType = filters.memoType;
    if (filters?.memoKind) query.memoKind = filters.memoKind;
    if (filters?.topic?.trim()) query['payload.topic'] = filters.topic.trim();
    if (filters?.search?.trim()) {
      const regex = new RegExp(this.escapeRegex(filters.search.trim()), 'i');
      query.$or = [{ title: regex }, { content: regex }, { tags: regex }, { contextKeywords: regex }, { 'payload.topic': regex }];
    }
    return query;
  }

  private resolveMemoDefaults(memoKind?: MemoKind, memoType?: MemoType): { memoKind: MemoKind; memoType: MemoType } {
    const resolvedKind = memoKind || 'topic';
    if (resolvedKind === 'topic') {
      return { memoKind: resolvedKind, memoType: 'knowledge' };
    }
    const standardMemoKinds: MemoKind[] = [
      'identity',
      'todo',
      'history',
      'draft',
      'custom',
      'evaluation',
      'achievement',
      'criticism',
    ];
    if (standardMemoKinds.includes(resolvedKind)) {
      return { memoKind: resolvedKind, memoType: 'standard' };
    }
    return { memoKind: resolvedKind, memoType: memoType || 'knowledge' };
  }

  private assertMemoTypeKindCompatibility(memoKind: MemoKind | undefined, memoType: MemoType | undefined, phase: 'create' | 'update'): void {
    if (!memoType) return;

    const resolvedKind = (memoKind || 'topic') as MemoKind;
    if (resolvedKind === 'topic' && memoType !== 'knowledge') {
      throw new BadRequestException(`${phase}: memoKind=topic requires memoType=knowledge`);
    }

    const standardMemoKinds: MemoKind[] = [
      'identity',
      'todo',
      'history',
      'draft',
      'custom',
      'evaluation',
      'achievement',
      'criticism',
    ];
    if (standardMemoKinds.includes(resolvedKind) && memoType !== 'standard') {
      throw new BadRequestException(`${phase}: memoKind=${resolvedKind} requires memoType=standard`);
    }
  }

  private buildStableSlug(kind: MemoKind, title: string, topic?: string): string {
    if (kind === 'identity') return 'identity-and-responsibilities';
    if (kind === 'todo') return 'todo-list';
    if (kind === 'history') return 'history-log';
    if (kind === 'draft') return 'draft-buffer';
    if (kind === 'achievement') return 'achievement-log';
    if (kind === 'criticism') return 'criticism-log';
    if (kind === 'custom') {
      const customBase = this.normalizeTopic(topic || title || 'custom');
      return `custom-${customBase}`;
    }
    const base = this.normalizeTopic(topic || title || kind || 'general');
    return `${kind}-${base}`;
  }

  private resolveCanonicalMemoTitle(kind: MemoKind, inputTitle: string): string {
    if (kind === 'achievement') return 'Achievement';
    if (kind === 'criticism') return 'Criticism';
    return String(inputTitle || '').trim();
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

  private toNormalizedPayload(memoKind: MemoKind, payload: Record<string, any>, title: string): Record<string, any> {
    const next = { ...(payload || {}) };
    if (typeof next.topic !== 'string' || !next.topic.trim()) {
      if (memoKind === 'identity') next.topic = 'identity';
      else if (memoKind === 'todo') next.topic = 'todo';
      else next.topic = this.normalizeTopic(title);
    } else {
      next.topic = String(next.topic).trim();
    }
    return next;
  }

  private resolveChangeNote(updates: Partial<CreateMemoInput>): string {
    if (updates.content) return 'content updated';
    if (updates.payload) return 'payload updated';
    if (updates.title) return 'title updated';
    return 'memo updated';
  }

  private async createMemoVersionSnapshot(memo: AgentMemo, changeNote: string): Promise<void> {
    const version = Math.max(1, Number(memo.version || 1));
    const exists = await this.memoVersionModel.findOne({ memoId: memo.id, version }).exec();
    if (exists) return;
    await this.memoVersionModel.create({
      id: uuidv4(),
      memoId: memo.id,
      version,
      content: memo.content || '',
      changeNote: changeNote || 'memo updated',
    });
  }

  async listMemoVersions(memoId: string): Promise<AgentMemoVersion[]> {
    return (await this.memoVersionModel.find({ memoId }).sort({ version: -1 }).exec()) as unknown as AgentMemoVersion[];
  }

  private memoCacheKey(agentId: string, memoKind: MemoKind): string {
    return `memo:${agentId}:${memoKind}`;
  }

  private uniqueMemoKinds(kinds: MemoKind[]): MemoKind[] {
    const allowed: MemoKind[] = ['identity', 'todo', 'topic', 'history', 'draft', 'custom', 'evaluation', 'achievement', 'criticism'];
    const normalized = Array.from(new Set((kinds || []).map((item) => String(item || '').trim() as MemoKind).filter(Boolean)));
    return normalized.filter((item) => allowed.includes(item));
  }

  private isAppendOnlyMemoKind(memoKind: MemoKind): boolean {
    return this.appendOnlyMemoKinds.includes(memoKind);
  }

  private appendWithDivider(origin: string, incoming: string): string {
    const base = String(origin || '').trim();
    const next = String(incoming || '').trim();
    if (!next) return base;
    if (!base) return next;
    return `${base}\n\n—\n\n${next}`;
  }

  private async loadMemoKindCache(agentId: string, memoKind: MemoKind): Promise<Array<Record<string, any>>> {
    const key = this.memoCacheKey(agentId, memoKind);
    const cached = await this.redisService.get(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.items)) return parsed.items;
      } catch {
        // ignore cache parse error and rebuild
      }
    }

    await this.refreshMemoCacheByKind(agentId, memoKind);
    const rebuilt = await this.redisService.get(key);
    if (!rebuilt) return [];
    try {
      const parsed = JSON.parse(rebuilt);
      return Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
      return [];
    }
  }

  private async searchMemosFromCache(
    agentId: string,
    query: string,
    kinds: MemoKind[],
    limit: number,
  ): Promise<Array<{ memoKind: MemoKind; title: string; topic?: string; summary: string }>> {
    const keyword = String(query || '').trim().toLowerCase();
    if (!keyword) return [];

    const results: Array<{ memoKind: MemoKind; title: string; topic?: string; summary: string; updatedAt?: string }> = [];
    const uniqueKinds = this.uniqueMemoKinds(kinds);
    for (const memoKind of uniqueKinds) {
      const rows = await this.loadMemoKindCache(agentId, memoKind);
      for (const row of rows) {
        const title = String(row.title || '');
        const content = String(row.content || '');
        const topic = row?.payload?.topic ? String(row.payload.topic) : undefined;
        const tags = Array.isArray(row.tags) ? row.tags.join(' ') : '';
        const haystack = `${title} ${content} ${topic || ''} ${tags}`.toLowerCase();
        if (!haystack.includes(keyword)) continue;
        results.push({
          memoKind,
          title,
          topic,
          summary: this.toSummary(content, 220),
          updatedAt: row.updatedAt,
        });
      }
    }

    return results
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, Math.max(1, limit))
      .map(({ memoKind, title, topic, summary }) => ({ memoKind, title, topic, summary }));
  }

  private async refreshMemoCacheByKind(agentId: string, memoKind: MemoKind): Promise<void> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    const items = await this.memoModel.find({ agentId: normalizedAgentId, memoKind }).sort({ updatedAt: -1 }).limit(200).exec();
    const payload = {
      agentId: normalizedAgentId,
      memoKind,
      items,
      updatedAt: new Date().toISOString(),
    };
    await this.redisService.set(this.memoCacheKey(normalizedAgentId, memoKind), JSON.stringify(payload));
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
