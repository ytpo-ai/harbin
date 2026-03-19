import { Injectable } from '@nestjs/common';
import {
  MEMO_WRITE_COMMAND_QUEUE_KEY,
  MemoWriteCommandMessage,
  MemoWriteCommandType,
} from '@libs/common';
import { RedisService } from '@libs/infra';
import { v4 as uuidv4 } from 'uuid';

type TodoStatus =
  | 'pending'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'in_progress'
  | 'completed';

type TaskSourceType = 'orchestration_task' | 'meeting_chat' | 'runtime_note';

type MemoActorContext = { employeeId?: string; role?: string };

type MemoMutationOptions = {
  skipEnsureCoreDocs?: boolean;
  actor?: MemoActorContext;
  skipRolePermissionCheck?: boolean;
};

type CreateMemoInput = {
  agentId: string;
  title: string;
  content: string;
  memoType?: string;
  memoKind?: string;
  payload?: Record<string, unknown>;
  slug?: string;
  tags?: string[];
  contextKeywords?: string[];
  source?: string;
};

type UpdateMemoInput = Partial<CreateMemoInput>;

export interface MemoWriteQueueAck {
  accepted: boolean;
  requestId: string;
  commandType: MemoWriteCommandType;
  queuedAt: string;
}

@Injectable()
export class MemoWriteQueueService {
  private readonly maxAttempts = Math.max(1, Number(process.env.MEMO_WRITE_MAX_ATTEMPTS || 3));

  constructor(private readonly redisService: RedisService) {}

  async queueCreateMemo(body: CreateMemoInput, options?: MemoMutationOptions): Promise<MemoWriteQueueAck> {
    return this.enqueue('create_memo', { body, options }, `create:${body.agentId}:${body.memoKind || 'topic'}:${body.title || ''}`);
  }

  async queueUpdateMemo(id: string, updates: UpdateMemoInput, options?: MemoMutationOptions): Promise<MemoWriteQueueAck> {
    return this.enqueue('update_memo', { id, updates, options }, `update:${id}`);
  }

  async queueDeleteMemo(id: string): Promise<MemoWriteQueueAck> {
    return this.enqueue('delete_memo', { id }, `delete:${id}`);
  }

  async queueUpsertTaskTodo(
    agentId: string,
    task: {
      id?: string;
      title?: string;
      description?: string;
      status?: TodoStatus;
      note?: string;
      sourceType?: TaskSourceType;
      orchestrationId?: string;
      priority?: 'low' | 'medium' | 'high';
    },
  ): Promise<MemoWriteQueueAck> {
    return this.enqueue('upsert_task_todo', { agentId, task }, `upsert_todo:${agentId}:${task.id || 'auto'}`);
  }

  async queueUpdateTodoStatus(
    id: string,
    status: TodoStatus,
    note?: string,
    options?: { taskId?: string; sourceType?: TaskSourceType },
  ): Promise<MemoWriteQueueAck> {
    return this.enqueue('update_todo_status', { id, status, note, options }, `todo_status:${id}:${options?.taskId || 'default'}`);
  }

  async queueCompleteTaskTodo(
    agentId: string,
    taskId?: string,
    note?: string,
    status: 'success' | 'failed' | 'cancelled' = 'success',
  ): Promise<MemoWriteQueueAck> {
    return this.enqueue('complete_task_todo', { agentId, taskId, note, status }, `complete_todo:${agentId}:${taskId || 'unknown'}`);
  }

  async queueRecordBehavior(payload: {
    agentId: string;
    event: 'task_start' | 'decision' | 'task_complete' | 'task_failed';
    taskId?: string;
    title?: string;
    details: string;
    tags?: string[];
    topic?: string;
  }): Promise<MemoWriteQueueAck> {
    return this.enqueue('record_behavior', payload, `behavior:${payload.agentId}:${payload.taskId || payload.event}:${Date.now()}`);
  }

  private async enqueue(
    commandType: MemoWriteCommandType,
    payload: Record<string, unknown>,
    idempotencySeed?: string,
  ): Promise<MemoWriteQueueAck> {
    const requestId = uuidv4();
    const queuedAt = new Date().toISOString();
    const command: MemoWriteCommandMessage = {
      requestId,
      commandType,
      payload,
      idempotencyKey: this.normalizeIdempotencyKey(idempotencySeed || requestId),
      requestedAt: queuedAt,
      source: 'agents-runtime',
      attempt: 1,
      maxAttempts: this.maxAttempts,
    };
    await this.redisService.lpush(MEMO_WRITE_COMMAND_QUEUE_KEY, JSON.stringify(command));
    return {
      accepted: true,
      requestId,
      commandType,
      queuedAt,
    };
  }

  private normalizeIdempotencyKey(seed: string): string {
    return String(seed || '')
      .trim()
      .replace(/[^a-zA-Z0-9:_-]/g, '_')
      .slice(0, 180);
  }
}
