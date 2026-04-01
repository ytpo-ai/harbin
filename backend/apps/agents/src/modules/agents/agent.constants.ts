import {
  MODEL_ADD_TOOL_ID,
  MODEL_LIST_TOOL_ID,
} from './model-management-agent.constants';
import {
  GET_TOOL_SCHEMA_TOOL_ID,
  SEND_INTERNAL_MESSAGE_TOOL_ID,
} from '@agent/modules/tools/builtin-tool-definitions';

export const CODE_DOCS_READER_TOOL_ID = 'builtin.sys-mg.internal.rd-related.docs-read';
export const CODE_UPDATES_READER_TOOL_ID = 'builtin.sys-mg.internal.rd-related.updates-read';
export const REPO_READ_TOOL_ID = 'builtin.sys-mg.internal.rd-related.repo-read';
export const MEMO_MCP_SEARCH_TOOL_ID = 'builtin.sys-mg.internal.memory.search-memo';
export const MEMO_MCP_APPEND_TOOL_ID = 'builtin.sys-mg.internal.memory.append-memo';
export { GET_TOOL_SCHEMA_TOOL_ID, SEND_INTERNAL_MESSAGE_TOOL_ID };

export const ORCHESTRATION_TOOL_IDS = {
  createPlan: 'builtin.sys-mg.mcp.orchestration.create-plan',
  updatePlan: 'builtin.sys-mg.mcp.orchestration.update-plan',
  runPlan: 'builtin.sys-mg.mcp.orchestration.run-plan',
  getPlan: 'builtin.sys-mg.mcp.orchestration.get-plan',
  listPlans: 'builtin.sys-mg.mcp.orchestration.list-plans',
  submitTask: 'builtin.sys-mg.mcp.orchestration.submit-task',
  reportTaskRunResult: 'builtin.sys-mg.mcp.orchestration.report-task-run-result',
} as const;

export const REQUIREMENT_TOOL_IDS = {
  list: 'builtin.sys-mg.mcp.requirement.list',
  get: 'builtin.sys-mg.mcp.requirement.get',
  create: 'builtin.sys-mg.mcp.requirement.create',
  updateStatus: 'builtin.sys-mg.mcp.requirement.update-status',
  update: 'builtin.sys-mg.mcp.requirement.update',
  syncGithub: 'builtin.sys-mg.mcp.requirement.sync-github',
} as const;

export const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': ORCHESTRATION_TOOL_IDS.createPlan,
  'mcp.orchestration.updatePlan': ORCHESTRATION_TOOL_IDS.updatePlan,
  'mcp.orchestration.runPlan': ORCHESTRATION_TOOL_IDS.runPlan,
  'mcp.orchestration.getPlan': ORCHESTRATION_TOOL_IDS.getPlan,
  'mcp.orchestration.listPlans': ORCHESTRATION_TOOL_IDS.listPlans,
  'mcp.orchestration.submitTask': ORCHESTRATION_TOOL_IDS.submitTask,
  'mcp.orchestration.reportTaskRunResult': ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
  'mcp.model.list': MODEL_LIST_TOOL_ID,
  'mcp.model.add': MODEL_ADD_TOOL_ID,
  'mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'builtin.sys-mg.mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'internal.agents.list': 'builtin.sys-mg.internal.agent-master.list-agents',
  'internal.content.extract': 'builtin.data-analysis.internal.content-analysis.extract',
  'internal.web.search': 'builtin.web-retrieval.internal.web-search.exa',
  'internal.web.fetch': 'builtin.web-retrieval.internal.web-fetch.fetch',
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
