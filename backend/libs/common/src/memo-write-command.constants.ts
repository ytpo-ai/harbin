export const MEMO_WRITE_COMMAND_QUEUE_KEY = 'queue:memo:write:commands';
export const MEMO_WRITE_RESULT_CHANNEL = 'memo:write:result';
export const MEMO_WRITE_DEAD_LETTER_KEY = 'queue:memo:write:dead-letter';

export type MemoWriteCommandType =
  | 'create_memo'
  | 'update_memo'
  | 'delete_memo'
  | 'upsert_task_todo'
  | 'update_todo_status'
  | 'complete_task_todo'
  | 'record_behavior';

export interface MemoWriteCommandMessage {
  requestId: string;
  commandType: MemoWriteCommandType;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  requestedAt: string;
  source?: string;
  attempt: number;
  maxAttempts: number;
}
