export const PROMPT_SCENES = {
  meeting: 'meeting',
  orchestration: 'orchestration',
} as const;

export const PROMPT_ROLES = {
  meetingExecutionPolicy: 'meeting-execution-policy',
  plannerTaskDecomposition: 'planner-task-decomposition',
} as const;

export type PromptResolveSource = 'session_override' | 'db_published' | 'redis_cache' | 'code_default';
