import type { AgentTier } from '../../services/agentService';
import type { TierFilter } from './types';

export const TIER_LABEL_MAP: Record<AgentTier, string> = {
  leadership: '高管层',
  operations: '执行层',
  temporary: '临时工',
};

export const TIER_FILTER_OPTIONS: Array<{ value: TierFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'leadership', label: '高管层' },
  { value: 'operations', label: '执行层' },
  { value: 'temporary', label: '零时工' },
];

export const TIER_BADGE_CLASS_MAP: Record<AgentTier, string> = {
  leadership: 'bg-indigo-100 text-indigo-800',
  operations: 'bg-slate-100 text-slate-800',
  temporary: 'bg-amber-100 text-amber-800',
};

export const NAMESPACE_DISPLAY_MAP: Record<string, string> = {
  builtin: 'builtin',
  composio: 'composio',
  'sys-mg': '系统管理',
  communication: '通讯工具',
  'web-retrieval': 'WEB信息检索收集',
  'data-analysis': '数据分析',
  other: '其他',
};
