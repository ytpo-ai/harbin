export const AGENT_LIST_TOOL_ID = 'builtin.sys-mg.internal.agent-master.list-agents';
export const LEGACY_AGENT_LIST_TOOL_ID = 'builtin.sys-mg.internal.agent-admin.list-agents';
export const AGENT_CREATE_TOOL_ID = 'builtin.sys-mg.internal.agent-master.create-agent';
export const RD_DOCS_WRITE_TOOL_ID = 'builtin.sys-mg.internal.rd-related.docs-write';
export const RD_REPO_WRITER_TOOL_ID = 'builtin.sys-mg.internal.rd-related.repo-writer';
export const PROMPT_REGISTRY_SAVE_TEMPLATE_TOOL_ID = 'builtin.sys-mg.mcp.prompt-registry.save-template';

export const VIRTUAL_TOOL_IDS = [
  'web_search',
  'code_execution',
  'file_read',
  'file_write',
  'data_analysis',
  'video_editing',
  'api_call',
];

export const DEPRECATED_TOOL_IDS = [
  'code-docs-mcp',
  'code-docs-reader',
  'code-updates-mcp',
  'code-updates-reader',
  'websearch',
  'webfetch',
  'content_extract',
  'slack',
  'gmail',
  'repo-read',
  'gh-repo-docs-reader-mcp',
  'gh-repo-updates-mcp',
  'local-repo-docs-reader',
  'local-repo-updates-reader',
  'agents_mcp_list',
  'model_mcp_list_models',
  'model_mcp_search_latest',
  'model_mcp_add_model',
  'memo_mcp_search',
  'memo_mcp_append',
  'human_operation_log_mcp_list',
  'orchestration_create_plan',
  'orchestration_update_plan',
  'orchestration_run_plan',
  'orchestration_get_plan',
  'orchestration_list_plans',
  'orchestration_reassign_task',
  'orchestration_complete_human_task',
  'orchestration_create_schedule',
  'orchestration_update_schedule',
  'orchestration_debug_task',
];
