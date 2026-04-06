import {
  TOOL_ID__AGENT_MEMORY_APPEND_MEMO,
  TOOL_ID__AGENT_MEMORY_SEARCH_MEMO,
  TOOL_ID__AGENT_MODEL_ADD,
  TOOL_ID__AGENT_MODEL_LIST,
  TOOL_ID__AGENT_LIST,
  TOOL_ID__CONTENT_EXTRACT,
  TOOL_ID__EMPLYEE_LOGS,
  TOOL_ID__ENGINEERING_COMMIT_READ,
  TOOL_ID__ENGINEERING_DOCS_READ,
  TOOL_ID__ENGINEERING_REPO_READ,
  TOOL_ID__GET_TOOL_SCHEMA,
  TOOL_ID__ORCHESTRATION_CREATE_PLAN,
  TOOL_ID__ORCHESTRATION_GET_PLAN,
  TOOL_ID__ORCHESTRATION_LIST_PLANS,
  TOOL_ID__ORCHESTRATION_RUN_PLAN,
  TOOL_ID__ORCHESTRATION_SUBMIT_TASK,
  TOOL_ID__ORCHESTRATION_SUBMIT_TASK_RUN_RESULT,
  TOOL_ID__ORCHESTRATION_UPDATE_PLAN,
  TOOL_ID__REQUIREMENT_CREATE,
  TOOL_ID__REQUIREMENT_GET,
  TOOL_ID__REQUIREMENT_LIST,
  TOOL_ID__REQUIREMENT_SYNC_GITHUB,
  TOOL_ID__REQUIREMENT_UPDATE,
  TOOL_ID__REQUIREMENT_UPDATE_STATUS,
  TOOL_ID__SEND_INTERNAL_MESSAGE,
  TOOL_ID__WEB_FETCH,
  TOOL_ID__WEB_SEARCH_EXA,
} from '@agent/modules/tools/builtin-tool-definitions';

export const CODE_DOCS_READER_TOOL_ID = TOOL_ID__ENGINEERING_DOCS_READ;
export const CODE_UPDATES_READER_TOOL_ID = TOOL_ID__ENGINEERING_COMMIT_READ;
export const REPO_READ_TOOL_ID = TOOL_ID__ENGINEERING_REPO_READ;
export const MEMO_MCP_SEARCH_TOOL_ID = TOOL_ID__AGENT_MEMORY_SEARCH_MEMO;
export const MEMO_MCP_APPEND_TOOL_ID = TOOL_ID__AGENT_MEMORY_APPEND_MEMO;
export const GET_TOOL_SCHEMA_TOOL_ID = TOOL_ID__GET_TOOL_SCHEMA;
export const SEND_INTERNAL_MESSAGE_TOOL_ID = TOOL_ID__SEND_INTERNAL_MESSAGE;

export const ORCHESTRATION_TOOL_IDS = {
  createPlan: TOOL_ID__ORCHESTRATION_CREATE_PLAN,
  updatePlan: TOOL_ID__ORCHESTRATION_UPDATE_PLAN,
  runPlan: TOOL_ID__ORCHESTRATION_RUN_PLAN,
  getPlan: TOOL_ID__ORCHESTRATION_GET_PLAN,
  listPlans: TOOL_ID__ORCHESTRATION_LIST_PLANS,
  submitTask: TOOL_ID__ORCHESTRATION_SUBMIT_TASK,
  reportTaskRunResult: TOOL_ID__ORCHESTRATION_SUBMIT_TASK_RUN_RESULT,
} as const;

export const REQUIREMENT_TOOL_IDS = {
  list: TOOL_ID__REQUIREMENT_LIST,
  get: TOOL_ID__REQUIREMENT_GET,
  create: TOOL_ID__REQUIREMENT_CREATE,
  updateStatus: TOOL_ID__REQUIREMENT_UPDATE_STATUS,
  update: TOOL_ID__REQUIREMENT_UPDATE,
  syncGithub: TOOL_ID__REQUIREMENT_SYNC_GITHUB,
} as const;

export const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': ORCHESTRATION_TOOL_IDS.createPlan,
  'mcp.orchestration.updatePlan': ORCHESTRATION_TOOL_IDS.updatePlan,
  'mcp.orchestration.runPlan': ORCHESTRATION_TOOL_IDS.runPlan,
  'mcp.orchestration.getPlan': ORCHESTRATION_TOOL_IDS.getPlan,
  'mcp.orchestration.listPlans': ORCHESTRATION_TOOL_IDS.listPlans,
  'mcp.orchestration.submitTask': ORCHESTRATION_TOOL_IDS.submitTask,
  'mcp.orchestration.reportTaskRunResult': ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
  'mcp.model.list': TOOL_ID__AGENT_MODEL_LIST,
  'mcp.model.add': TOOL_ID__AGENT_MODEL_ADD,
  'mcp.humanOperationLog.list': TOOL_ID__EMPLYEE_LOGS,
  'builtin.sys-mg.mcp.humanOperationLog.list': TOOL_ID__EMPLYEE_LOGS,
  'internal.agents.list': TOOL_ID__AGENT_LIST,
  'internal.content.extract': TOOL_ID__CONTENT_EXTRACT,
  'internal.web.search': TOOL_ID__WEB_SEARCH_EXA,
  'internal.web.fetch': TOOL_ID__WEB_FETCH,
};

export const DEFAULT_MAX_TOOL_ROUNDS = 30;

export const SKILL_CONTENT_MAX_INJECT_LENGTH = Math.max(500, Number(process.env.SKILL_CONTENT_MAX_INJECT_LENGTH || 4000));

export const AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS = Math.max(60, Number(process.env.AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS || 300));

export const SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS = Math.max(
  300,
  Number(process.env.AGENT_SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS || 7200),
);

// ---- shared utility functions ----

export function normalizeToolId(toolId: string): string {
  const normalized = String(toolId || '').trim();
  if (!normalized) {
    return '';
  }
  return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
}

export function normalizeToolIds(toolIds: string[]): string[] {
  return uniqueStrings(toolIds || []).map((id) => normalizeToolId(id));
}

export function uniqueStrings(...groups: string[][]): string[] {
  const merged = groups.flat().map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

export function compactLogText(input: string | undefined, maxLength = 120): string {
  const normalized = String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (!normalized) {
    return 'N/A';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function toLogError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: compactLogText(error.message, 500),
      stack: error.stack,
    };
  }

  return {
    message: compactLogText(String(error || 'Unknown error'), 500),
  };
}
