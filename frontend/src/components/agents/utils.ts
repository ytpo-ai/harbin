import type { AgentBusinessRole, AgentTier } from '../../services/agentService';
import type { Agent } from '../../types';
import { NAMESPACE_DISPLAY_MAP, TIER_BADGE_CLASS_MAP, TIER_LABEL_MAP } from './constants';

export const normalizeProvider = (provider?: string): string => {
  const value = (provider || '').toLowerCase().trim();
  if (!value) return '';

  if (value === 'claude' || value === 'anthropic') return 'anthropic';
  if (value === 'chatgpt' || value === 'openai') return 'openai';
  if (value === 'gemini' || value === 'google') return 'google';
  if (value === 'azure-openai' || value === 'azure_openai' || value === 'microsoft') return 'microsoft';

  return value;
};

export const isProviderCompatible = (modelProvider?: string, keyProvider?: string): boolean => {
  return normalizeProvider(modelProvider) === normalizeProvider(keyProvider);
};

export const shouldApplyNextDefault = (currentValue: string, previousDefault?: string): boolean => {
  const normalized = (currentValue || '').trim();
  if (!normalized) return true;
  return !!previousDefault && normalized === previousDefault.trim();
};

export const getRoleDisplayName = (role?: AgentBusinessRole): string => {
  if (!role) return '-';
  return role.name || role.code || role.id;
};

export const normalizeTier = (value?: string): AgentTier => {
  if (value === 'leadership' || value === 'operations' || value === 'temporary') {
    return value;
  }
  return 'operations';
};

export const getTierLabel = (value?: string): string => TIER_LABEL_MAP[normalizeTier(value)];

export const getTierBadgeClassName = (value?: string): string => TIER_BADGE_CLASS_MAP[normalizeTier(value)];

export const getToolKey = (tool?: any): string => {
  return String(tool?.toolId || tool?.id || '').trim();
};

export const getToolNamespace = (tool?: any): string => {
  if (tool?.namespace) return String(tool.namespace).trim();
  const key = getToolKey(tool);
  if (!key.includes('.')) return 'other';

  const parts = key.split('.');
  if (parts.length >= 2) {
    const candidate = parts[1];
    if (['sys-mg', 'communication', 'web-retrieval', 'data-analysis', 'other'].includes(candidate)) {
      return candidate;
    }
  }
  return parts[0] || 'other';
};

export const getToolNamespaceDisplay = (toolNamespace: string): string => {
  return NAMESPACE_DISPLAY_MAP[toolNamespace] || toolNamespace;
};

export const getToolProvider = (tool?: any): string => {
  return String(tool?.provider || 'unknown').trim();
};

export const getToolRequiredPermissionIds = (tool?: any): string[] => {
  const requiredPermissions = Array.isArray(tool?.requiredPermissions) ? tool.requiredPermissions : [];
  return Array.from(
    new Set(
      requiredPermissions
        .map((item: any) => String(item?.id || '').trim())
        .filter(Boolean),
    ),
  );
};

export const buildAutoGrantedPermissions = (selectedToolIds: string[], tools: any[], basePermissions: string[]): string[] => {
  const selectedSet = new Set((selectedToolIds || []).map((item) => String(item || '').trim()).filter(Boolean));
  const derivedPermissions = (tools || [])
    .filter((tool) => selectedSet.has(getToolKey(tool)))
    .flatMap((tool) => getToolRequiredPermissionIds(tool));

  return Array.from(new Set([...(basePermissions || []), ...derivedPermissions].map((item) => String(item || '').trim()).filter(Boolean)));
};

export const getAgentAvatarUrl = (agent: Agent): string => {
  const withAvatar = agent as Agent & {
    avatar?: string;
    avatarUrl?: string;
    profileImage?: string;
    image?: string;
  };

  const candidates = [withAvatar.avatar, withAvatar.avatarUrl, withAvatar.profileImage, withAvatar.image];
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim();
};

export const prettyConfigText = (config?: Record<string, unknown>): string => {
  return JSON.stringify(config || {}, null, 2);
};

export const parseConfigText = (raw: string): { config?: Record<string, unknown>; error?: string } => {
  const text = String(raw || '').trim();
  if (!text) {
    return { config: {} };
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'config 必须是 JSON 对象' };
    }
    return { config: parsed as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    return { error: `config JSON 解析失败: ${message}` };
  }
};
