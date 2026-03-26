export const ORCH_EVENTS = {
  ADVANCE_REQUESTED: 'orchestration.advance.requested',
  TASK_GENERATED: 'orchestration.task.generated',
  TASK_PRE_EXECUTED: 'orchestration.task.pre_executed',
  TASK_EXECUTED: 'orchestration.task.executed',
  TASK_POST_PROCESSED: 'orchestration.task.post_processed',
  PLAN_COMPLETED: 'orchestration.plan.completed',
  PLAN_FAILED: 'orchestration.plan.failed',
} as const;

export type OrchestrationSource = 'internal' | 'api' | 'scheduler' | 'external';

export interface OrchestrationAdvanceEvent {
  planId: string;
  source: OrchestrationSource;
  targetPhase?: 'generating' | 'pre_execute' | 'executing' | 'post_execute' | 'idle';
  metadata?: Record<string, unknown>;
}

export interface OrchestrationPhaseEvent {
  planId: string;
  taskId: string;
  step: number;
  phase: 'generating' | 'pre_execute' | 'executing' | 'post_execute';
  result?: Record<string, unknown>;
}
