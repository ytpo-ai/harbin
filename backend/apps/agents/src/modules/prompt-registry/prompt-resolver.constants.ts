export const PROMPT_SCENES = {
  meeting: 'meeting',
  orchestration: 'orchestration',
} as const;

export const PROMPT_ROLES = {
  meetingExecutionPolicy: 'meeting-execution-policy',
  plannerTaskDecomposition: 'planner-task-decomposition',
  plannerGenerating: 'planner-generating',
  plannerInitialize: 'planner-initialize',
  plannerDefaultOutline: 'planner-default-outline',
  preExecuteContext: 'pre-execute-context',
  postExecuteContext: 'post-execute-context',
  researchOutputContract: 'research-output-contract',
} as const;

export type PromptResolveSource = 'session_override' | 'db_published' | 'redis_cache' | 'code_default';
