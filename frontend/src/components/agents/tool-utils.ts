import type { Tool } from '../../types';

export const NAMESPACE_OPTIONS = [
  { value: 'sys-mg', label: '系统管理' },
  { value: 'communication', label: '通讯工具' },
  { value: 'web-retrieval', label: 'WEB信息检索收集' },
  { value: 'data-analysis', label: '数据分析' },
  { value: 'other', label: '其他' },
] as const;

const NAMESPACE_ALIAS_MAP: Record<string, string> = {
  'sys-mg': 'sys-mg',
  '系统管理': 'sys-mg',
  communication: 'communication',
  '通讯工具': 'communication',
  'web-retrieval': 'web-retrieval',
  'web信息检索收集': 'web-retrieval',
  'web信息检索搜集': 'web-retrieval',
  'web information retrieval': 'web-retrieval',
  'data-analysis': 'data-analysis',
  '数据分析': 'data-analysis',
  other: 'other',
  '其他': 'other',
};

const NAMESPACE_LABEL_MAP = NAMESPACE_OPTIONS.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

export const getToolKey = (tool?: Partial<Tool> | null): string => {
  return String(tool?.toolId || tool?.id || '').trim();
};

export const getToolProvider = (tool?: Partial<Tool> | null): string => {
  return String(tool?.provider || '').trim();
};

export const normalizeNamespace = (namespace?: string): string => {
  const raw = String(namespace || '').trim();
  if (!raw) return '';
  return NAMESPACE_ALIAS_MAP[raw] || NAMESPACE_ALIAS_MAP[raw.toLowerCase()] || raw;
};

export const getNamespaceLabel = (namespace?: string): string => {
  const normalized = normalizeNamespace(namespace);
  return NAMESPACE_LABEL_MAP[normalized] || normalized || '—';
};
