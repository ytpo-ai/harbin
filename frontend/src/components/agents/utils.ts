import type { AgentBusinessRole, AgentTier } from '../../services/agentService';
import type { ApiKey } from '../../services/apiKeyService';
import type { AIModel, Agent } from '../../types';
import { NAMESPACE_DISPLAY_MAP, TIER_BADGE_CLASS_MAP, TIER_LABEL_MAP } from './constants';

export const normalizeProvider = (provider?: string): string => {
  const value = (provider || '').toLowerCase().trim();
  if (!value) return '';

  if (value === 'claude' || value === 'anthropic') return 'anthropic';
  if (value === 'chatgpt' || value === 'openai') return 'openai';
  if (value === 'gemini' || value === 'google') return 'google';
  if (value === 'kimi' || value === 'moonshot') return 'moonshotai';
  if (value === 'qianwen' || value === 'qwen' || value === 'tongyi') return 'alibaba';
  if (value === 'aliyun' || value === 'alicloud' || value === 'dashscope') return 'alibaba';
  if (value === 'zhipu') return 'zhipuai';

  if (value.includes('openai')) return 'openai';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
  if (value.includes('google') || value.includes('gemini')) return 'google';
  if (value.includes('moonshot') || value.includes('kimi')) return 'moonshotai';
  if (value.includes('qianwen') || value.includes('qwen') || value.includes('tongyi')) return 'alibaba';
  if (value.includes('zhipu') || value.includes('glm')) return 'zhipuai';

  return value;
};

export const isProviderCompatible = (modelProvider?: string, keyProvider?: string): boolean => {
  return normalizeProvider(modelProvider) === normalizeProvider(keyProvider);
};

const toFiniteCost = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getModelPriceValues = (model: AIModel): number[] => {
  const values = [
    toFiniteCost(model.cost?.input),
    toFiniteCost(model.cost?.output),
    toFiniteCost(model.cost?.cache_read),
    toFiniteCost(model.cost?.cache_write),
    toFiniteCost(model.cost?.reasoning),
  ];
  return values.filter((value): value is number => value !== undefined);
};

export const getModelPriceRank = (model: AIModel): number => {
  const values = getModelPriceValues(model);
  if (!values.length) return -1;
  return Math.max(...values);
};

export const compareModelsByPriceDesc = (a: AIModel, b: AIModel): number => {
  const rankDiff = getModelPriceRank(b) - getModelPriceRank(a);
  if (rankDiff !== 0) return rankDiff;

  const outputDiff = (toFiniteCost(b.cost?.output) ?? -1) - (toFiniteCost(a.cost?.output) ?? -1);
  if (outputDiff !== 0) return outputDiff;

  const inputDiff = (toFiniteCost(b.cost?.input) ?? -1) - (toFiniteCost(a.cost?.input) ?? -1);
  if (inputDiff !== 0) return inputDiff;

  return a.name.localeCompare(b.name);
};

export const filterAndSortModelsByApiKeys = (models: AIModel[], apiKeys: ApiKey[]): AIModel[] => {
  const configuredProviders = new Set(
    (apiKeys || [])
      .filter((key) => Boolean(key?.provider) && key.isActive !== false)
      .map((key) => normalizeProvider(key.provider)),
  );

  return (models || [])
    .filter((model) => configuredProviders.has(normalizeProvider(model.provider)))
    .sort(compareModelsByPriceDesc);
};

const formatUnitPrice = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return '$0';
  if (value < 0.001) return `$${value.toExponential(2)}`;
  return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
};

export const formatModelPriceSummary = (model: AIModel): string => {
  const inputPrice = formatUnitPrice(model.cost?.input);
  const outputPrice = formatUnitPrice(model.cost?.output);
  const maxRankPrice = formatUnitPrice(getModelPriceRank(model));

  if (inputPrice && outputPrice) {
    return `in ${inputPrice} / out ${outputPrice}`;
  }
  if (outputPrice) {
    return `out ${outputPrice}`;
  }
  if (inputPrice) {
    return `in ${inputPrice}`;
  }
  if (maxRankPrice) {
    return `price ${maxRankPrice}`;
  }

  return 'price N/A';
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const extractDailyCostBudgetLimit = (config?: Record<string, unknown>): string => {
  if (!isRecord(config)) {
    return '';
  }

  const budget = config.budget;
  if (!isRecord(budget)) {
    return '';
  }

  const unit = String(budget.unit || '').trim();
  const period = String(budget.period || '').trim();
  const limit = Number(budget.limit);
  if (unit !== 'dailyCost' || period !== 'day' || !Number.isFinite(limit) || limit <= 0) {
    return '';
  }

  return String(limit);
};

export const upsertDailyCostBudget = (
  config: Record<string, unknown>,
  dailyCostLimitInput: string,
): Record<string, unknown> => {
  const normalizedInput = String(dailyCostLimitInput || '').trim();
  const parsedLimit = Number(normalizedInput);
  const nextConfig: Record<string, unknown> = { ...config };

  if (!normalizedInput || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    const budget = nextConfig.budget;
    if (isRecord(budget) && String(budget.unit || '').trim() === 'dailyCost') {
      delete nextConfig.budget;
    }
    return nextConfig;
  }

  nextConfig.budget = {
    period: 'day',
    unit: 'dailyCost',
    limit: parsedLimit,
  };
  return nextConfig;
};

export const validateDailyCostBudgetConflict = (
  config: Record<string, unknown>,
  dailyCostLimitInput: string,
): string | undefined => {
  const normalizedInput = String(dailyCostLimitInput || '').trim();
  const parsedLimit = Number(normalizedInput);
  if (!normalizedInput || !Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return undefined;
  }

  const budget = config.budget;
  if (!isRecord(budget)) {
    return undefined;
  }

  const budgetUnit = String(budget.unit || '').trim();
  if (!budgetUnit || budgetUnit === 'dailyCost') {
    return undefined;
  }

  return '检测到 Config JSON 中已存在非 dailyCost 的 budget 配置。请删除该 budget，或将每日 Cost 额度输入框清空后再保存。';
};
