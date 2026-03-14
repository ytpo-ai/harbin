export const MEMO_AGGREGATION_COMMAND_QUEUE_KEY = 'queue:memo:aggregation:commands';
export const MEMO_AGGREGATION_RESULT_CHANNEL = 'memo:aggregation:result';
export const MEMO_AGGREGATION_DEAD_LETTER_KEY = 'queue:memo:aggregation:dead-letter';

export type MemoAggregationCommandType = 'flush_events' | 'full_aggregation';

export interface MemoAggregationCommandMessage {
  requestId: string;
  commandType: MemoAggregationCommandType;
  scheduleId?: string;
  taskId?: string;
  agentId?: string;
  triggeredBy?: string;
  requestedAt: string;
  attempt: number;
  maxAttempts: number;
}
