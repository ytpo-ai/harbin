import { DEPRECATED_TOOL_IDS, VIRTUAL_TOOL_IDS } from './builtin-tool-definitions';

export interface ParsedToolIdentity {
  provider: string;
  executionChannel: string;
  namespace: string;
  toolkit: string;
  toolkitId: string;
  resource: string;
  action: string;
}

export function inferProviderFromToolId(toolId: string): string {
  return parseToolIdentity(toolId).provider;
}

export function parseToolIdentity(toolId: string): ParsedToolIdentity {
  const parts = String(toolId || '').split('.').filter(Boolean);
  if (!parts.length) {
    return {
      provider: 'builtin',
      executionChannel: 'internal',
      namespace: 'other',
      toolkit: 'generic',
      toolkitId: 'builtin.other.internal.generic',
      resource: 'generic',
      action: 'execute',
    };
  }

  if ((parts[0] === 'builtin' || parts[0] === 'composio') && parts.length >= 5 && ['mcp', 'internal'].includes(parts[2])) {
    const provider = parts[0];
    const namespace = parts[1] || 'other';
    const executionChannel = parts[2] || 'internal';
    const toolkit = parts[3] || 'generic';
    const action = parts.slice(4).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource: toolkit,
      action,
    };
  }

  if (parts[0] === 'builtin' || parts[0] === 'composio') {
    const provider = parts[0];
    const executionChannel = parts[1] || (provider === 'composio' ? 'mcp' : 'internal');
    const namespace = parts[2] || 'other';
    const toolkit = parts[2] || 'generic';
    const resource = parts[2] || 'generic';
    const action = parts.slice(3).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource,
      action,
    };
  }

  if (parts[0] === 'gh') {
    const provider = 'builtin';
    const executionChannel = 'mcp';
    const namespace = 'sys-mg';
    const toolkit = 'rd-related';
    const action = parts.slice(1).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource: toolkit,
      action,
    };
  }

  const provider = parts[0] === 'composio' ? 'composio' : 'builtin';
  const executionChannel = parts[0] === 'internal' ? 'internal' : parts[1] || 'internal';
  const namespace = parts[2] || parts[1] || parts[0] || 'other';
  const toolkit = parts[3] || namespace;
  const action = parts.slice(4).join('.') || parts.slice(3).join('.') || 'execute';
  return {
    provider,
    executionChannel,
    namespace,
    toolkit,
    toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
    resource: toolkit,
    action,
  };
}

export function inferExecutionChannel(toolId: string): string {
  return parseToolIdentity(toolId).executionChannel;
}

export function inferNamespaceFromToolId(toolId: string): string {
  return parseToolIdentity(toolId).namespace;
}

export function inferToolkitFromToolId(toolId: string): string {
  return parseToolIdentity(toolId).toolkit;
}

export function inferToolkitIdFromToolId(toolId: string): string {
  return parseToolIdentity(toolId).toolkitId;
}

export function inferResourceAndAction(toolId: string): { resource: string; action: string } {
  const parsed = parseToolIdentity(toolId);
  return { resource: parsed.resource, action: parsed.action };
}

export function getToolkitDisplayName(toolkit: string): string {
  if (toolkit === 'rd-related') return 'RD Toolkit';
  return toolkit
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function buildBuiltinToolMetadata(toolData: {
  id: string;
  category: string;
  implementation?: { parameters?: Record<string, unknown> };
}) {
  const canonicalId = toolData.id;
  const identity = parseToolIdentity(canonicalId);
  const provider = identity.provider;
  const executionChannel = identity.executionChannel;
  const namespace = identity.namespace;
  const { resource, action } = inferResourceAndAction(canonicalId);
  return {
    canonicalId,
    provider,
    executionChannel,
    toolkitId: identity.toolkitId,
    namespace,
    resource,
    action,
    capabilitySet: [toolData.category.toLowerCase().replace(/\s+/g, '_')],
    tags: [namespace, provider, executionChannel, identity.toolkit],
    status: 'active' as const,
    deprecated: false,
    aliases: canonicalId === toolData.id ? [] : [toolData.id],
    inputSchema: toolData.implementation?.parameters || {},
    outputSchema: {},
  };
}

export function inferToolkitAuthStrategy(provider: string, namespace: string, toolkit?: string): 'oauth2' | 'apiKey' | 'none' {
  if (provider === 'composio' && ['gmail', 'slack', 'github'].includes(toolkit || namespace)) return 'oauth2';
  if (provider === 'builtin') return 'none';
  return 'apiKey';
}

export function isSystemManagementTool(toolId: string): boolean {
  const normalized = String(toolId || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith('builtin.sys-mg.mcp.orchestration.') ||
    normalized.startsWith('builtin.sys-mg.mcp.model-admin.') ||
    normalized.startsWith('builtin.sys-mg.mcp.skill-master.') ||
    normalized.startsWith('builtin.sys-mg.mcp.prompt-registry.') ||
    normalized.startsWith('builtin.sys-mg.mcp.audit.') ||
    normalized.startsWith('builtin.sys-mg.internal.agent-master.') ||
    normalized.startsWith('builtin.sys-mg.internal.agent-role-master.')
  );
}

export function normalizeStringArray(items?: unknown[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}
