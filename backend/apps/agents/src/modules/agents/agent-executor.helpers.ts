import { AIModel, ChatMessage, Task } from '@legacy/shared/types';
import { CollaborationContext } from '@libs/contracts';

import { compactLogText, toLogError } from './agent.constants';

export type OpenCodeRuntimeSource =
  | 'agent_config_endpoint'
  | 'agent_config_endpoint_ref'
  | 'runtime_endpoint'
  | 'runtime_endpoint_ref'
  | 'env_default';

export function resolveLatestUserContent(task: Task, messages: ChatMessage[]): string {
  const latestUserMessage = [...(task.messages || []), ...(messages || [])]
    .reverse()
    .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;

  return latestUserMessage || task.description || task.title || '';
}

export function isMeetingLikeTask(
  task: Task,
  context?: {
    collaborationContext?: any;
    taskType?: string;
  },
): boolean {
  if (task.type === 'meeting' || context?.taskType === 'meeting') {
    return true;
  }

  const collaborationContext = context?.collaborationContext as Record<string, unknown> | undefined;
  if (!collaborationContext || typeof collaborationContext !== 'object') {
    return false;
  }

  if (String(collaborationContext.scenarioMode || '').trim() === 'meeting') {
    return true;
  }

  return Boolean(collaborationContext.meetingId && collaborationContext.collaborationMode === 'meeting');
}

export function resolveResponseFormatFromCollaborationContext(
  collaborationContext: CollaborationContext | Record<string, unknown> | undefined,
  modelConfig?: AIModel,
): { type: 'json_object' } | undefined {
  if (!collaborationContext || typeof collaborationContext !== 'object') {
    return undefined;
  }

  if (isReasoningModel(modelConfig)) {
    return undefined;
  }

  const responseDirective = String((collaborationContext as Record<string, unknown>).responseDirective || '').trim();
  if (responseDirective === 'json-only') {
    return { type: 'json_object' };
  }

  if (String((collaborationContext as Record<string, unknown>).format || '').trim() === 'json') {
    return { type: 'json_object' };
  }

  return undefined;
}

function isReasoningModel(modelConfig?: AIModel): boolean {
  if (!modelConfig) {
    return false;
  }

  const provider = String(modelConfig.provider || '').trim().toLowerCase();
  if (provider !== 'openai') {
    return false;
  }

  if (modelConfig.reasoning?.enabled) {
    return true;
  }

  const modelName = String(modelConfig.model || '').trim().toLowerCase();
  return modelName.startsWith('o1') || modelName.startsWith('o3') || modelName.startsWith('o4') || modelName.startsWith('gpt-5');
}

export function isMeaninglessAssistantResponse(response: string | undefined): boolean {
  const normalized = String(response || '').trim();
  if (!normalized) {
    return true;
  }
  if (['-', '—', '–', '...', '…'].includes(normalized)) {
    return true;
  }
  return /^[\s\-—–_.…]+$/.test(normalized);
}

export function shouldRetryGenerationError(error: unknown): boolean {
  const message = toLogError(error).message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('temporar') ||
    message.includes('rate limit') ||
    message.includes('503') ||
    message.includes('502')
  );
}

export function isModelTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const lower = message.toLowerCase();
  return (
    lower.includes('request timed out') ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('abort')
  );
}

export function resolveOpenCodeRuntimeOptions(
  executionConfig: {
    endpoint?: string;
    endpointRef?: string;
    authEnable: boolean;
  },
  runtime?: {
    endpoint?: string;
    endpointRef?: string;
    authEnable?: boolean;
  },
): {
  baseUrl?: string;
  authEnable: boolean;
  source: OpenCodeRuntimeSource;
} {
  const endpoint = String(executionConfig.endpoint || '').trim();
  if (endpoint) {
    return {
      baseUrl: endpoint,
      authEnable: executionConfig.authEnable,
      source: 'agent_config_endpoint',
    };
  }

  const endpointRef = String(executionConfig.endpointRef || '').trim();
  if (endpointRef) {
    return {
      baseUrl: endpointRef,
      authEnable: executionConfig.authEnable,
      source: 'agent_config_endpoint_ref',
    };
  }

  const runtimeEndpoint = String(runtime?.endpoint || '').trim();
  if (runtimeEndpoint) {
    return {
      baseUrl: runtimeEndpoint,
      authEnable: runtime?.authEnable ?? executionConfig.authEnable,
      source: 'runtime_endpoint',
    };
  }

  const runtimeEndpointRef = String(runtime?.endpointRef || '').trim();
  if (runtimeEndpointRef) {
    return {
      baseUrl: runtimeEndpointRef,
      authEnable: runtime?.authEnable ?? executionConfig.authEnable,
      source: 'runtime_endpoint_ref',
    };
  }

  return {
    baseUrl: undefined,
    authEnable: executionConfig.authEnable,
    source: 'env_default',
  };
}

export function extractToolCall(response: string): { tool: string; parameters: any } | null {
  const all = extractAllToolCalls(response);
  return all.length > 0 ? all[0] : null;
}

export function extractAllToolCalls(response: string): Array<{ tool: string; parameters: any }> {
  const results: Array<{ tool: string; parameters: any }> = [];

  // Strategy 1: Match all closed <tool_call>...</tool_call> blocks
  const closedTagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = closedTagRegex.exec(response)) !== null) {
    const parsed = parseToolCallPayload(match[1]);
    if (parsed) {
      results.push(parsed);
    }
  }
  if (results.length > 0) {
    return results;
  }

  // Strategy 2: Match dangling <tool_call> with no closing tag (single only)
  const openTagOnlyMatch = response.match(/<tool_call>\s*([\s\S]*)$/i);
  if (openTagOnlyMatch) {
    const parsed = parseToolCallPayload(openTagOnlyMatch[1]);
    if (parsed) {
      return [parsed];
    }
  }

  // Strategy 3: Bare JSON with "tool" and "parameters" keys (single only)
  if (response.includes('"tool"') && response.includes('"parameters"')) {
    const parsed = parseToolCallPayload(response);
    if (parsed) {
      return [parsed];
    }
  }

  return [];
}

export function isToolInputErrorMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('invalid tool parameters')) return true;
  if (normalized.includes('missing required field')) return true;
  if (normalized.includes('requires') && normalized.includes('parameter')) return true;
  if (normalized.includes('requires receiveragentid')) return true;
  if (normalized.includes('requires title and content')) return true;
  if (normalized.includes('title and content are required')) return true;
  return false;
}

export function buildToolInputRepairInstruction(
  normalizedToolId: string,
  schema: Record<string, unknown>,
  previousParameters: Record<string, unknown>,
  errorReason?: string,
): string {
  const schemaText = compactLogText(JSON.stringify(schema || {}), 2400);
  const paramsText = compactLogText(JSON.stringify(previousParameters || {}), 1200);
  return [
    `参数修正要求：你刚刚调用工具 ${normalizedToolId} 时参数不符合契约。`,
    errorReason ? `错误原因：${errorReason}` : '',
    '仅基于以下工具定义修正参数并立即重试，不要补充其他解释文本。',
    `inputSchema=${schemaText}`,
    `lastParameters=${paramsText}`,
    `请只输出 <tool_call>{"tool":"${normalizedToolId}","parameters":{...}}</tool_call>`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildToolSchemaHint(toolId: string, schema: Record<string, unknown>): string | null {
  const properties = (schema as any)?.properties;
  if (!properties || typeof properties !== 'object') return null;

  const required = new Set(
    Array.isArray((schema as any).required)
      ? (schema as any).required.map((r: unknown) => String(r || ''))
      : [],
  );

  const propEntries = Object.entries(properties as Record<string, any>);
  if (propEntries.length === 0) return null;

  const lines: string[] = [`工具参数契约 ${toolId}:`];

  if (required.size > 0) {
    lines.push(`required: [${[...required].join(', ')}]`);
  }

  const additionalProperties = (schema as any)?.additionalProperties;
  if (additionalProperties === false) {
    lines.push('additionalProperties: false（禁止传入未定义的字段）');
  }

  lines.push('properties:');
  for (const [key, spec] of propEntries) {
    const type = spec?.type || 'any';
    const enumValues = Array.isArray(spec?.enum) ? `, enum=${JSON.stringify(spec.enum)}` : '';
    const desc = spec?.description ? ` - ${spec.description}` : '';
    const req = required.has(key) ? ' (必填)' : '';
    lines.push(`  ${key}: ${type}${enumValues}${req}${desc}`);
  }

  return lines.join('\n');
}

export function hasEffectiveSchema(schema: Record<string, unknown>): boolean {
  const properties = (schema as any)?.properties;
  if (!properties || typeof properties !== 'object') return false;
  return Object.keys(properties).length > 0;
}

export function getToolInputPreflightError(
  schema: Record<string, unknown> | undefined,
  parameters: any,
): string | null {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return 'parameters must be object';
  }

  const required = Array.isArray((schema as any).required)
    ? (schema as any).required.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  for (const key of required) {
    if (!(key in parameters) || parameters[key] === undefined || parameters[key] === null) {
      return `missing required field '${key}'`;
    }
  }

  const properties = (schema as any).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return null;
  }

  if ((schema as any).additionalProperties === false) {
    const allowed = new Set(Object.keys(properties));
    const extras = Object.keys(parameters).filter((key) => !allowed.has(key));
    if (extras.length) {
      return `unknown fields ${extras.join(',')}`;
    }
  }

  for (const [key, spec] of Object.entries(properties as Record<string, unknown>)) {
    if (!(key in parameters)) continue;
    const expectedType = String((spec as any)?.type || '').trim();
    if (!expectedType) continue;
    const value = parameters[key];
    if (value === undefined || value === null) continue;

    if (expectedType === 'string' && typeof value !== 'string') return `field '${key}' must be string`;
    if (expectedType === 'number' && typeof value !== 'number') return `field '${key}' must be number`;
    if (expectedType === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
      return `field '${key}' must be integer`;
    }
    if (expectedType === 'boolean' && typeof value !== 'boolean') return `field '${key}' must be boolean`;
    if (expectedType === 'array' && !Array.isArray(value)) return `field '${key}' must be array`;
    if (expectedType === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      return `field '${key}' must be object`;
    }
  }

  return null;
}

export function stripToolCallMarkup(content: string): string {
  const withoutClosedBlocks = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  const withoutDanglingBlocks = withoutClosedBlocks.replace(/<tool_call>\s*[\s\S]*$/gi, '');
  return withoutDanglingBlocks.trim();
}

export function buildTaskResultMemo(response: string): string {
  const normalized = String(response || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 800) return normalized;
  return `${normalized.slice(0, 797)}...`;
}

function sanitizeJsonString(raw: string): string {
  // 将实际换行/回车/制表符替换为 JSON 转义序列（LLM 最常见的 JSON 缺陷）
  let s = raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  // 移除其他控制字符
  let normalized = '';
  for (let i = 0; i < s.length; i += 1) {
    const char = s[i];
    if (char.charCodeAt(0) >= 32) {
      normalized += char;
    }
  }
  s = normalized;
  // 移除尾部多余逗号: ,} → } 和 ,] → ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

function tryParseToolJson(text: string): { tool: string; parameters: any } | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
      return {
        tool: parsed.tool,
        parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function parseToolCallPayload(payload: string): { tool: string; parameters: any } | null {
  const cleaned = payload.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const candidates: string[] = [];

  // 候选 1: 原始清理后的文本
  candidates.push(cleaned);

  // 候选 2: 第一个 { 到最后一个 } 之间的内容
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1).trim());
  }

  // 对每个候选：原始 → sanitize → 逐步去尾部多余 }
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const text of [candidate, sanitizeJsonString(candidate)]) {
      const result = tryParseToolJson(text);
      if (result) return result;

      // 尾部多余 } 修复：LLM 有时会多输出一个闭合大括号
      if (text.endsWith('}')) {
        let trimmed = text;
        for (let i = 0; i < 3; i++) {
          trimmed = trimmed.slice(0, -1).trim();
          if (!trimmed.endsWith('}')) break;
          const r = tryParseToolJson(trimmed);
          if (r) return r;
        }
      }
    }
  }

  return null;
}
