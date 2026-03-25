import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { agentService } from '../services/agentService';
import type { AgentTestResult } from '../services/agentService';
import type { AgentBusinessRole } from '../services/agentService';
import type { AgentToolPermissionSet } from '../services/agentService';
import type { AgentTier } from '../services/agentService';
import { modelService } from '../services/modelService';
import { apiKeyService } from '../services/apiKeyService';
import { toolService } from '../services/toolService';
import { authService } from '../services/authService';
import { meetingService } from '../services/meetingService';
import { PromptTemplateRefPicker } from '../components/PromptTemplateRefPicker';
import { Agent, AIModel, PromptTemplateRef } from '../types';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  PowerIcon, 
  UserGroupIcon,
  CpuChipIcon,
  CheckCircleIcon,
  LockClosedIcon,
  BeakerIcon,
  XCircleIcon,
  WrenchScrewdriverIcon,
  ChatBubbleLeftRightIcon,
  EyeIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

const normalizeProvider = (provider?: string): string => {
  const value = (provider || '').toLowerCase().trim();
  if (!value) return '';

  if (value === 'claude' || value === 'anthropic') return 'anthropic';
  if (value === 'chatgpt' || value === 'openai') return 'openai';
  if (value === 'gemini' || value === 'google') return 'google';
  if (value === 'azure-openai' || value === 'azure_openai' || value === 'microsoft') return 'microsoft';

  return value;
};

const isProviderCompatible = (modelProvider?: string, keyProvider?: string): boolean => {
  return normalizeProvider(modelProvider) === normalizeProvider(keyProvider);
};

const shouldApplyNextDefault = (currentValue: string, previousDefault?: string): boolean => {
  const normalized = (currentValue || '').trim();
  if (!normalized) return true;
  return !!previousDefault && normalized === previousDefault.trim();
};

const getRoleDisplayName = (role?: AgentBusinessRole): string => {
  if (!role) return '-';
  return role.name || role.code || role.id;
};

const TIER_LABEL_MAP: Record<AgentTier, string> = {
  leadership: '高管层',
  operations: '执行层',
  temporary: '临时工',
};

type TierFilter = 'all' | AgentTier;

const TIER_FILTER_OPTIONS: Array<{ value: TierFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'leadership', label: '高管层' },
  { value: 'operations', label: '执行层' },
  { value: 'temporary', label: '零时工' },
];

const TIER_BADGE_CLASS_MAP: Record<AgentTier, string> = {
  leadership: 'bg-indigo-100 text-indigo-800',
  operations: 'bg-slate-100 text-slate-800',
  temporary: 'bg-amber-100 text-amber-800',
};

const normalizeTier = (value?: string): AgentTier => {
  if (value === 'leadership' || value === 'operations' || value === 'temporary') {
    return value;
  }
  return 'operations';
};

const getTierLabel = (value?: string): string => TIER_LABEL_MAP[normalizeTier(value)];

const getTierBadgeClassName = (value?: string): string => TIER_BADGE_CLASS_MAP[normalizeTier(value)];

const NAMESPACE_DISPLAY_MAP: Record<string, string> = {
  'builtin': 'builtin',
  'composio': 'composio',
  'sys-mg': '系统管理',
  'communication': '通讯工具',
  'web-retrieval': 'WEB信息检索收集',
  'data-analysis': '数据分析',
  'other': '其他',
};

const getToolKey = (tool?: any): string => {
  return String(tool?.toolId || tool?.id || '').trim();
};

const getToolNamespace = (tool?: any): string => {
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

const getToolNamespaceDisplay = (toolNamespace: string): string => {
  return NAMESPACE_DISPLAY_MAP[toolNamespace] || toolNamespace;
};

const getToolProvider = (tool?: any): string => {
  return String(tool?.provider || 'unknown').trim();
};

const getToolRequiredPermissionIds = (tool?: any): string[] => {
  const requiredPermissions = Array.isArray(tool?.requiredPermissions) ? tool.requiredPermissions : [];
  return Array.from(
    new Set(
      requiredPermissions
        .map((item: any) => String(item?.id || '').trim())
        .filter(Boolean),
    ),
  );
};

const buildAutoGrantedPermissions = (selectedToolIds: string[], tools: any[], basePermissions: string[]): string[] => {
  const selectedSet = new Set((selectedToolIds || []).map((item) => String(item || '').trim()).filter(Boolean));
  const derivedPermissions = (tools || [])
    .filter((tool) => selectedSet.has(getToolKey(tool)))
    .flatMap((tool) => getToolRequiredPermissionIds(tool));

  return Array.from(new Set([...(basePermissions || []), ...derivedPermissions].map((item) => String(item || '').trim()).filter(Boolean)));
};

const getAgentAvatarUrl = (agent: Agent): string => {
  const withAvatar = agent as Agent & {
    avatar?: string;
    avatarUrl?: string;
    profileImage?: string;
    image?: string;
  };

  const candidates = [withAvatar.avatar, withAvatar.avatarUrl, withAvatar.profileImage, withAvatar.image];
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim();
};

const prettyConfigText = (config?: Record<string, unknown>): string => {
  return JSON.stringify(config || {}, null, 2);
};

const parseConfigText = (raw: string): { config?: Record<string, unknown>; error?: string } => {
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

const Agents: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [startingChatAgentId, setStartingChatAgentId] = useState<string>('');
  const [avatarLoadErrors, setAvatarLoadErrors] = useState<Record<string, boolean>>({});
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  const getAgentId = (agent: Agent | null): string => {
    const withMongoId = agent as (Agent & { _id?: string }) | null;
    return withMongoId?.id || withMongoId?._id || '';
  };

  const getAgentCandidateIds = (agent: Agent): string[] => {
    const withMongoId = agent as Agent & { _id?: string };
    return Array.from(new Set([withMongoId.id, withMongoId._id].filter(Boolean) as string[]));
  };

  const { data: agents, isLoading } = useQuery('agents', agentService.getAgents);
  const { data: availableModels } = useQuery('models', modelService.getAvailableModels);
  const { data: availableTools } = useQuery('tools', toolService.getTools);
  const { data: toolPermissionSets } = useQuery('agentToolPermissionSets', agentService.getToolPermissionSets);
  const { data: businessRoles } = useQuery('agentBusinessRoles', () => agentService.getRoles('all'));

  const roleMap = useMemo(() => {
    const map = new Map<string, AgentBusinessRole>();
    for (const role of businessRoles || []) {
      if (role?.id) {
        map.set(role.id, role);
      }
    }
    return map;
  }, [businessRoles]);

  const filteredAgents = useMemo(() => {
    const list = agents || [];
    if (tierFilter === 'all') return list;

    return list.filter((agent) => {
      const role = roleMap.get(agent.roleId);
      const tier = normalizeTier(agent.tier || role?.tier);
      return tier === tierFilter;
    });
  }, [agents, roleMap, tierFilter]);

  const deleteAgentMutation = useMutation(agentService.deleteAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
    },
  });

  const toggleAgentMutation = useMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) => 
      agentService.updateAgent(id, { isActive }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
      },
    }
  );

  const updateAgentMutation = useMutation(
    ({ id, updates }: { id: string; updates: Partial<Agent> }) =>
      agentService.updateAgent(id, updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
        setIsEditModalOpen(false);
        setEditingAgent(null);
      },
    }
  );

  const handleDelete = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法删除');
      return;
    }
    if (window.confirm('确定要删除这个Agent吗？')) {
      deleteAgentMutation.mutate(id);
    }
  };

  const handleToggleActive = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法更新状态');
      return;
    }
    toggleAgentMutation.mutate({ id, isActive: !agent.isActive });
  };

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setIsEditModalOpen(true);
  };

  const handleStartChat = async (agent: Agent) => {
    const agentId = getAgentId(agent);
    if (!agentId) {
      alert('Agent ID 无效，无法开始聊天');
      return;
    }

    if (!agent.isActive) {
      alert('该 Agent 当前未激活，请先启用后再开始聊天');
      return;
    }

    setStartingChatAgentId(agentId);
    try {
      const currentUser = await authService.getCurrentUser();
      if (!currentUser?.id) {
        throw new Error('未获取到当前用户信息，请重新登录后重试');
      }

      const meeting = await meetingService.getOrCreateOneToOneMeeting({
        employeeId: currentUser.id,
        employeeName: currentUser.name || currentUser.email || '用户',
        agentId,
        agentName: agent.name,
        agentCandidateIds: getAgentCandidateIds(agent),
      });

      navigate(`/meetings?meetingId=${encodeURIComponent(meeting.id)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建一对一聊天失败';
      alert(message);
    } finally {
      setStartingChatAgentId('');
    }
  };

  const handleViewDetail = (agent: Agent) => {
    const agentId = getAgentId(agent);
    if (!agentId) {
      alert('Agent ID 无效，无法查看详情');
      return;
    }
    navigate(`/agents/${encodeURIComponent(agentId)}`);
  };

  const isFounder = (agent: Agent) => {
    const roleCode = (roleMap.get(agent.roleId)?.code || '').trim();
    return roleCode === 'executive-lead' || agent.name === 'Alex Chen' || agent.name === 'Sarah Kim';
  };

  const getFounderRole = (agent: Agent) => {
    if (agent.name === 'Alex Chen') return 'CEO';
    if (agent.name === 'Sarah Kim') return 'CTO';
    return null;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agent管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理和配置AI Agent</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="agent-tier-filter" className="text-sm text-gray-600">筛选</label>
            <select
              id="agent-tier-filter"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as TierFilter)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {TIER_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            创建Agent
          </button>
        </div>
      </div>

      {/* Agent列表 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => {
            const agentId = getAgentId(agent) || agent.name;
            const avatarUrl = getAgentAvatarUrl(agent);
            const showAvatarImage = !!avatarUrl && !avatarLoadErrors[agentId];
            const role = roleMap.get(agent.roleId);
            const agentTier = normalizeTier(agent.tier || role?.tier);

            return (
              <div
                key={agentId}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-100">
                      {showAvatarImage ? (
                        <img
                          src={avatarUrl}
                          alt={`${agent.name} 头像`}
                          className="h-full w-full object-cover"
                          onError={() => {
                            setAvatarLoadErrors((prev) => ({ ...prev, [agentId]: true }));
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-500">
                          <UserCircleIcon className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-gray-900">{agent.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{getRoleDisplayName(role)}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    agent.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {agent.isActive ? '活跃' : '非活跃'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {isFounder(agent) && (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      getFounderRole(agent) === 'CEO' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {getFounderRole(agent)}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                    <CpuChipIcon className="mr-1 h-3 w-3" />
                    {agent.model?.name || '-'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                    <WrenchScrewdriverIcon className="mr-1 h-3 w-3" />
                    工具 {agent.tools?.length || 0}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getTierBadgeClassName(agentTier)}`}>
                    {getTierLabel(agentTier)}
                  </span>
                </div>

                <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-gray-600">{agent.description || '暂无描述'}</p>

                <p className="mt-2 text-xs text-gray-500">
                  能力: {agent.capabilities?.length ? `${agent.capabilities.slice(0, 3).join('、')}${agent.capabilities.length > 3 ? '...' : ''}` : '未配置'}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleStartChat(agent)}
                    disabled={startingChatAgentId === getAgentId(agent)}
                    className="inline-flex items-center justify-center rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
                    title="开始聊天"
                  >
                    <ChatBubbleLeftRightIcon className="mr-1 h-3.5 w-3.5" />
                    {startingChatAgentId === getAgentId(agent) ? '进入中...' : '开始聊天'}
                  </button>
                  <button
                    onClick={() => handleViewDetail(agent)}
                    className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    title="查看详情"
                  >
                    <EyeIcon className="mr-1 h-3.5 w-3.5" />
                    详情
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-end gap-1 border-t border-gray-100 pt-2">
                  <button
                    onClick={() => handleToggleActive(agent)}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title={agent.isActive ? '停用' : '启用'}
                  >
                    <PowerIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleEditAgent(agent)}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="编辑"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(agent)}
                    className="rounded-md p-2 text-red-400 hover:bg-red-50 hover:text-red-600"
                    title="删除"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}

        {(agents?.length || 0) > 0 && filteredAgents.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无匹配结果</h3>
            <p className="mt-1 text-sm text-gray-500">当前筛选条件下暂无 Agent</p>
          </div>
        )}

        {agents?.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有Agent</h3>
            <p className="mt-1 text-sm text-gray-500">开始创建你的第一个AI Agent</p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                创建Agent
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 创建Agent模态框 */}
      {isCreateModalOpen && (
            <CreateAgentModal 
              availableModels={availableModels || []}
              availableTools={availableTools || []}
              toolPermissionSets={toolPermissionSets || []}
              businessRoles={businessRoles || []}
              onClose={() => setIsCreateModalOpen(false)}
              onSuccess={() => {
                setIsCreateModalOpen(false);
            queryClient.invalidateQueries('agents');
          }}
        />
      )}

      {isEditModalOpen && editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          availableModels={availableModels || []}
          availableTools={availableTools || []}
          toolPermissionSets={toolPermissionSets || []}
          businessRoles={businessRoles || []}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingAgent(null);
          }}
          onSave={(updates) => {
            const id = getAgentId(editingAgent);
            if (!id) {
              alert('Agent ID 无效，无法保存配置');
              return;
            }
            updateAgentMutation.mutate({ id, updates });
          }}
          isLoading={updateAgentMutation.isLoading}
        />
      )}

    </div>
  );
};

// 创建Agent模态框组件
const CreateAgentModal: React.FC<{
  availableModels: AIModel[];
  availableTools: Array<{ id: string; toolId?: string; name: string; enabled?: boolean; requiredPermissions?: Array<{ id?: string }> }>;
  toolPermissionSets: AgentToolPermissionSet[];
  businessRoles: AgentBusinessRole[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ availableModels, availableTools, toolPermissionSets, businessRoles, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const [toolProviderFilter, setToolProviderFilter] = useState('');
  const [toolNamespaceFilter, setToolNamespaceFilter] = useState('');
  const [autoGrantPermissions, setAutoGrantPermissions] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    roleId: '',
    tier: 'operations' as AgentTier,
    description: '',
    systemPrompt: '',
    promptTemplateRef: undefined as PromptTemplateRef | undefined,
    capabilities: '',
    modelId: availableModels[0]?.id || '',
    apiKeyId: '',
    selectedTools: [] as string[],
    configText: '{\n  "execution": {\n    "provider": "opencode"\n  }\n}',
  });

  const { data: apiKeys } = useQuery('apiKeys', apiKeyService.getAllApiKeys);
  const selectedModel = availableModels.find(m => m.id === formData.modelId);
  const filteredApiKeys = (apiKeys || []).filter((key) => {
    if (!selectedModel?.provider || !key?.provider) return false;
    return isProviderCompatible(selectedModel.provider, key.provider) && key.isActive && !key.isDeprecated;
  });

  const createAgentMutation = useMutation(agentService.createAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
      onSuccess();
    },
  });

  const selectedRole = businessRoles.find((role) => role.id === formData.roleId);
  const selectedRoleCode = (selectedRole?.code || '').trim();
  const allowedToolIds = new Set(
    (toolPermissionSets.find((set) => set.roleCode === selectedRoleCode)?.tools || []).filter(Boolean),
  );
  const allowedTools = availableTools.filter(
    (tool) => tool.enabled !== false && allowedToolIds.has(getToolKey(tool)),
  );

  const createToolProviderOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolProvider(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const createToolNamespaceOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolNamespace(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const groupedAllowedTools = useMemo(() => {
    const filtered = allowedTools
      .filter((tool) => !toolProviderFilter || getToolProvider(tool) === toolProviderFilter)
      .filter((tool) => !toolNamespaceFilter || getToolNamespace(tool) === toolNamespaceFilter);

    const grouped = new Map<string, typeof filtered>();
    for (const tool of filtered) {
      const namespace = getToolNamespace(tool);
      if (!grouped.has(namespace)) grouped.set(namespace, []);
      grouped.get(namespace)!.push(tool);
    }

    return Array.from(grouped.entries())
      .map(([namespace, items]) => ({
        namespace,
        items: items.sort((a, b) => getToolKey(a).localeCompare(getToolKey(b))),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
  }, [allowedTools, toolProviderFilter, toolNamespaceFilter]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      selectedTools: prev.selectedTools.filter((toolId) => allowedToolIds.has(toolId)),
    }));
  }, [selectedRoleCode]);

  const handleCreateRoleChange = (nextRoleId: string) => {
    setFormData((prev) => {
      const previousRole = businessRoles.find((role) => role.id === prev.roleId);
      const nextRole = businessRoles.find((role) => role.id === nextRoleId);
      const nextRoleCode = (nextRole?.code || '').trim();
      const nextAllowedToolIds = new Set(
        (toolPermissionSets.find((set) => set.roleCode === nextRoleCode)?.tools || []).filter(Boolean),
      );
      const nextPrompt = shouldApplyNextDefault(prev.systemPrompt, previousRole?.promptTemplate)
        ? (nextRole?.promptTemplate || prev.systemPrompt)
        : prev.systemPrompt;

      return {
        ...prev,
        roleId: nextRoleId,
        tier: normalizeTier(nextRole?.tier),
        systemPrompt: nextPrompt,
        selectedTools: prev.selectedTools.filter((toolId) => nextAllowedToolIds.has(toolId)),
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedModel) {
      alert('请选择一个模型');
      return;
    }

    const basePermissions: string[] = [];
    const nextPermissions = autoGrantPermissions
      ? buildAutoGrantedPermissions(formData.selectedTools, allowedTools, basePermissions)
      : basePermissions;

    const agentData = {
      name: formData.name,
      roleId: formData.roleId,
      tier: formData.tier,
      description: formData.description,
      systemPrompt: formData.systemPrompt,
      promptTemplateRef: formData.promptTemplateRef,
      capabilities: formData.capabilities.split(',').map(cap => cap.trim()).filter(Boolean),
      model: selectedModel,
      apiKeyId: formData.apiKeyId || undefined,
      isActive: true,
      tools: formData.selectedTools,
      permissions: nextPermissions,
      personality: {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80
      },
      learningAbility: 80
    };

    const configParsed = parseConfigText(formData.configText);
    if (configParsed.error) {
      alert(configParsed.error);
      return;
    }

    (agentData as any).config = configParsed.config || {};

    createAgentMutation.mutate(agentData as any);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[600px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-6">创建新Agent</h3>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="例如: 智能助手"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">角色 <span className="text-red-500">*</span></label>
              <select
                required
                value={formData.roleId}
                onChange={(e) => handleCreateRoleChange(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">选择角色...</option>
                {businessRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {getRoleDisplayName(role)}（{getTierLabel(role.tier)}）
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">层级 Tier <span className="text-red-500">*</span></label>
              <select
                required
                value={formData.tier}
                onChange={(e) => setFormData((prev) => ({ ...prev, tier: normalizeTier(e.target.value) }))}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="leadership">leadership（高管层）</option>
                <option value="operations">operations（执行层）</option>
                <option value="temporary">temporary（临时工）</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">建议与角色默认层级保持一致；不一致会被后端校验拒绝。</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={2}
                placeholder="简要描述这个Agent的职责和能力..."
              />
            </div>
            
            <div>
              <PromptTemplateRefPicker
                value={formData.promptTemplateRef}
                onChange={(next) => setFormData({ ...formData, promptTemplateRef: next })}
                helperText="可选增强：模板内容会追加到 systemPrompt 之后注入 Identity Layer；解析失败时仅保留 systemPrompt。"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">系统提示 (System Prompt)</label>
              <textarea
                required
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                rows={4}
                placeholder="定义Agent的行为和角色，例如: 你是一位专业的软件工程师..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">能力 (逗号分隔)</label>
              <input
                type="text"
                value={formData.capabilities}
                onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 文本生成, 代码编写, 数据分析"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CpuChipIcon className="h-4 w-4 inline mr-1" />
                模型设置 <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value, apiKeyId: '' })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">请选择模型...</option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
              {selectedModel && (
                <div className="mt-2 rounded-md bg-gray-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Tokens:</span>
                    <span className="font-medium">{selectedModel.maxTokens.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-gray-600">Temperature:</span>
                    <span className="font-medium">{selectedModel.temperature}</span>
                  </div>
                </div>
              )}
            </div>

            {selectedModel && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  <LockClosedIcon className="mr-1 inline h-4 w-4" />
                  选择API密钥
                  <span className="ml-1 text-xs text-gray-500">(可选，使用环境变量作为默认)</span>
                </label>
                <select
                  value={formData.apiKeyId}
                  onChange={(e) => setFormData({ ...formData, apiKeyId: e.target.value })}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">使用系统默认密钥</option>
                  {filteredApiKeys.map((key) => {
                    const keyId = key.id || key._id;
                    const masked = key.keyMasked || '****';
                    return (
                      <option key={keyId} value={keyId}>
                        {masked} ({key.provider})
                      </option>
                    );
                  })}
                </select>
                {filteredApiKeys.length === 0 && selectedModel && (
                  <p className="mt-2 text-sm text-amber-600">
                    未找到 {selectedModel.provider} 的活跃API密钥，将使用系统默认配置
                  </p>
                )}
                {filteredApiKeys.length > 0 && !formData.apiKeyId && (
                  <p className="mt-2 text-sm text-blue-600">
                    已配置 {filteredApiKeys.length} 个 {selectedModel.provider} API密钥可供选择
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Config (JSON)</label>
              <textarea
                value={formData.configText}
                onChange={(e) => setFormData({ ...formData, configText: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-xs"
                rows={8}
                placeholder='例如: {"execution":{"provider":"opencode"},"budget":{"period":"day","limit":10,"unit":"runCount"}}'
              />
              <p className="mt-1 text-xs text-gray-500">仅支持 JSON 对象，创建时将原样传给后端 `config` 字段。</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">工具设置</label>
              <label className="mb-2 inline-flex items-center text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={autoGrantPermissions}
                  onChange={(e) => setAutoGrantPermissions(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2">自动赋权（默认开启）：勾选工具时自动补齐工具所需权限</span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                <select
                  value={toolProviderFilter}
                  onChange={(e) => setToolProviderFilter(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="">全部 Provider</option>
                  {createToolProviderOptions.map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
                <select
                  value={toolNamespaceFilter}
                  onChange={(e) => setToolNamespaceFilter(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="">全部 Namespace</option>
                  {createToolNamespaceOptions.map((namespace) => (
                    <option key={namespace} value={namespace}>{getToolNamespaceDisplay(namespace)}</option>
                  ))}
                </select>
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
                {groupedAllowedTools.map((group) => (
                  <div key={group.namespace} className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{getToolNamespaceDisplay(group.namespace)}</p>
                    {group.items.map((tool) => {
                      const toolId = getToolKey(tool);
                      const checked = formData.selectedTools.includes(toolId);
                      const requiredPermissionIds = getToolRequiredPermissionIds(tool);
                      return (
                        <label key={toolId} className="block border border-gray-100 rounded-md p-2 hover:bg-gray-50">
                          <div className="flex items-start justify-between gap-3 text-sm text-gray-700">
                            <div>
                              <p className="font-medium text-gray-900">{tool.name}</p>
                              <p className="text-xs text-gray-400 mt-0.5">ID: {toolId}</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {requiredPermissionIds.length > 0 ? (
                                  requiredPermissionIds.map((permissionId) => (
                                    <span key={`${toolId}-${permissionId}`} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                                      {permissionId}
                                    </span>
                                  ))
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
                                    无需额外权限
                                  </span>
                                )}
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setFormData((prev) => ({
                                  ...prev,
                                  selectedTools: e.target.checked
                                    ? [...prev.selectedTools, toolId]
                                    : prev.selectedTools.filter((id) => id !== toolId),
                                }));
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mt-1"
                            />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
                {groupedAllowedTools.length === 0 && (
                  <p className="text-xs text-gray-500">暂无可用工具</p>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">白名单模式：仅可选择当前角色工具权限集中的工具子集。</p>
            </div>
            
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createAgentMutation.isLoading || !formData.modelId || !formData.roleId}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {createAgentMutation.isLoading ? '创建中...' : '创建Agent'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const EditAgentModal: React.FC<{
  agent: Agent;
  availableModels: AIModel[];
  availableTools: Array<{ id: string; toolId?: string; name: string; description?: string; enabled?: boolean; requiredPermissions?: Array<{ id?: string }> }>;
  toolPermissionSets: AgentToolPermissionSet[];
  businessRoles: AgentBusinessRole[];
  onClose: () => void;
  onSave: (updates: Partial<Agent>) => void;
  isLoading: boolean;
}> = ({ agent, availableModels, availableTools, toolPermissionSets, businessRoles, onClose, onSave, isLoading }) => {
  const initialRoleTier = normalizeTier(businessRoles.find((role) => role.id === agent.roleId)?.tier);
  const initialAgentTier = normalizeTier(agent.tier || initialRoleTier);
  const [activeTab, setActiveTab] = useState<'model' | 'tools' | 'basic'>('model');
  const [toolProviderFilter, setToolProviderFilter] = useState('');
  const [toolNamespaceFilter, setToolNamespaceFilter] = useState('');
  const [autoGrantPermissions, setAutoGrantPermissions] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState(agent.model?.id || '');
  const [selectedApiKeyId, setSelectedApiKeyId] = useState(agent.apiKeyId || '');
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.tools || []);
  const [name, setName] = useState(agent.name || '');
  const [roleId, setRoleId] = useState(agent.roleId || '');
  const [tier, setTier] = useState<AgentTier>(initialAgentTier);
  const [description, setDescription] = useState(agent.description || '');
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt || '');
  const [promptTemplateRef, setPromptTemplateRef] = useState<PromptTemplateRef | undefined>(agent.promptTemplateRef);
  const [capabilitiesText, setCapabilitiesText] = useState((agent.capabilities || []).join(', '));
  const [configText, setConfigText] = useState(prettyConfigText(agent.config));
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [testedModelId, setTestedModelId] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState('');

  const { data: apiKeys } = useQuery('apiKeys', apiKeyService.getAllApiKeys);

  const selectedModel = availableModels.find((m) => m.id === selectedModelId);
  const filteredApiKeys = (apiKeys || []).filter((key) => {
    if (!selectedModel?.provider || !key?.provider) return false;
    return isProviderCompatible(selectedModel.provider, key.provider) && key.isActive;
  });

  const parsedCapabilities = capabilitiesText
    .split(',')
    .map((cap) => cap.trim())
    .filter(Boolean);

  const selectedRoleCode = (businessRoles.find((role) => role.id === roleId)?.code || '').trim();
  const allowedToolIds = new Set(
    (toolPermissionSets.find((set) => set.roleCode === selectedRoleCode)?.tools || []).filter(Boolean),
  );
  const allowedTools = availableTools.filter(
    (tool) => tool.enabled !== false && allowedToolIds.has(getToolKey(tool)),
  );

  const editToolProviderOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolProvider(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const editToolNamespaceOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolNamespace(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const groupedAllowedTools = useMemo(() => {
    const filtered = allowedTools
      .filter((tool) => !toolProviderFilter || getToolProvider(tool) === toolProviderFilter)
      .filter((tool) => !toolNamespaceFilter || getToolNamespace(tool) === toolNamespaceFilter);

    const grouped = new Map<string, typeof filtered>();
    for (const tool of filtered) {
      const namespace = getToolNamespace(tool);
      if (!grouped.has(namespace)) grouped.set(namespace, []);
      grouped.get(namespace)!.push(tool);
    }

    return Array.from(grouped.entries())
      .map(([namespace, items]) => ({
        namespace,
        items: items.sort((a, b) => getToolKey(a).localeCompare(getToolKey(b))),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
  }, [allowedTools, toolProviderFilter, toolNamespaceFilter]);
  const invalidSelectedTools = selectedTools.filter((toolId) => !allowedToolIds.has(toolId));

  const arraysEqual = (a: string[] = [], b: string[] = []) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((value, index) => value === sortedB[index]);
  };

  const promptTemplateRefEqual = (a?: PromptTemplateRef, b?: PromptTemplateRef) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.scene === b.scene && a.role === b.role;
  };

  const hasChanges =
    selectedModelId !== (agent.model?.id || '') ||
    selectedApiKeyId !== (agent.apiKeyId || '') ||
    !arraysEqual(selectedTools, agent.tools || []) ||
    name.trim() !== (agent.name || '').trim() ||
    roleId.trim() !== (agent.roleId || '').trim() ||
    tier !== initialAgentTier ||
    description.trim() !== (agent.description || '').trim() ||
    systemPrompt.trim() !== (agent.systemPrompt || '').trim() ||
    !promptTemplateRefEqual(promptTemplateRef, agent.promptTemplateRef) ||
    !arraysEqual(parsedCapabilities, agent.capabilities || []) ||
    configText.trim() !== prettyConfigText(agent.config).trim();

  useEffect(() => {
    setSelectedTools((prev) => prev.filter((toolId) => allowedToolIds.has(toolId)));
  }, [selectedRoleCode]);

  const anthropicModelMayBeDeprecated =
    selectedModel?.provider === 'anthropic' &&
    /20240229/.test(selectedModel.model);

  useEffect(() => {
    if (!selectedApiKeyId) return;
    const matched = filteredApiKeys.some((key) => (key.id || key._id) === selectedApiKeyId);
    if (!matched) {
      setSelectedApiKeyId('');
    }
  }, [selectedApiKeyId, filteredApiKeys]);

  const handleSave = () => {
    if (!selectedModel) {
      alert('请选择一个模型');
      setActiveTab('model');
      return;
    }
    if (!name.trim()) {
      alert('Agent 名称不能为空');
      setActiveTab('basic');
      return;
    }
    if (!roleId.trim()) {
      alert('角色不能为空');
      setActiveTab('basic');
      return;
    }
    if (!systemPrompt.trim()) {
      alert('Prompt 不能为空');
      setActiveTab('basic');
      return;
    }

    const configParsed = parseConfigText(configText);
    if (configParsed.error) {
      alert(configParsed.error);
      setActiveTab('basic');
      return;
    }

    const selectedAllowedTools = selectedTools.filter((toolId) => allowedToolIds.has(toolId));
    const basePermissions = Array.isArray(agent.permissions) ? agent.permissions : [];
    const nextPermissions = autoGrantPermissions
      ? buildAutoGrantedPermissions(selectedAllowedTools, allowedTools, basePermissions)
      : basePermissions;

    onSave({
      config: configParsed.config || {},
      model: selectedModel,
      apiKeyId: selectedApiKeyId || undefined,
      tools: selectedAllowedTools,
      permissions: nextPermissions,
      name: name.trim(),
      roleId: roleId.trim(),
      tier,
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      promptTemplateRef,
      capabilities: parsedCapabilities,
    });
  };

  const handleTest = async () => {
    if (!selectedModel) return;
    const withMongoId = agent as Agent & { _id?: string };
    const agentId = withMongoId.id || withMongoId._id;
    if (!agentId) {
      setTestResult({
        success: false,
        error: 'Agent ID 无效，无法测试',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setIsTesting(true);
    setStreamingResponse('');
    setTestResult(null);

    try {
      const result = await agentService.testAgentStream(
        agentId,
        { model: selectedModel, apiKeyId: selectedApiKeyId || undefined },
        {
          onStart: () => setStreamingResponse(''),
          onChunk: (_chunk, fullText) => setStreamingResponse(fullText),
          onDone: (fullText) => setStreamingResponse(fullText),
        },
      );
      setTestedModelId(selectedModel.id);
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型测试超时或失败';
      setTestedModelId(selectedModel.id);
      setTestResult({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      openai: '#10a37f',
      anthropic: '#d97757',
      google: '#4285f4',
      deepseek: '#4f46e5',
      mistral: '#ff7000',
      meta: '#0668e1',
      alibaba: '#ff6a00',
      moonshot: '#000000',
      baichuan: '#1a73e8',
      zhipu: '#3b82f6',
      xunfei: '#0ea5e9',
      minimax: '#f59e0b',
      microsoft: '#00a4ef',
    };
    return colors[provider] || '#6b7280';
  };

  const toggleTool = (toolId: string, checked: boolean) => {
    setSelectedTools((prev) =>
      checked ? [...prev, toolId] : prev.filter((id) => id !== toolId)
    );
  };

  const handleEditRoleChange = (nextRoleId: string) => {
    const previousRole = businessRoles.find((role) => role.id === roleId);
    const nextRole = businessRoles.find((role) => role.id === nextRoleId);
    const canUpdatePrompt = shouldApplyNextDefault(systemPrompt, previousRole?.promptTemplate);

    setRoleId(nextRoleId);
    setTier(normalizeTier(nextRole?.tier));
    if (canUpdatePrompt) {
      setSystemPrompt(nextRole?.promptTemplate || '');
    }
    const nextAllowedToolIds = new Set(
      (toolPermissionSets.find((set) => set.roleCode === String(nextRole?.code || '').trim())?.tools || []).filter(Boolean),
    );
    setSelectedTools((prev) => prev.filter((toolId) => nextAllowedToolIds.has(toolId)));
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[680px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">编辑 Agent</h3>
        <p className="text-sm text-gray-500 mb-5">
          当前编辑对象：<span className="font-medium text-gray-900">{agent.name}</span>
        </p>

        <div className="border-b border-gray-200 mb-5">
          <nav className="-mb-px flex space-x-6">
            <button
              onClick={() => setActiveTab('model')}
              className={`py-2 text-sm font-medium border-b-2 ${
                activeTab === 'model'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              模型
            </button>
            <button
              onClick={() => setActiveTab('tools')}
              className={`py-2 text-sm font-medium border-b-2 ${
                activeTab === 'tools'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              工具管理
            </button>
            <button
              onClick={() => setActiveTab('basic')}
              className={`py-2 text-sm font-medium border-b-2 ${
                activeTab === 'basic'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              基础信息
            </button>
          </nav>
        </div>

        {activeTab === 'model' && (
          <div className="space-y-5">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">当前模型</p>
              <div className="flex items-center">
                <span className="font-medium text-gray-900">{agent.model?.name}</span>
                <span
                  className="ml-2 px-2 py-0.5 rounded text-xs text-white"
                  style={{ backgroundColor: getProviderColor(agent.model?.provider || '') }}
                >
                  {agent.model?.provider}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                当前密钥: {agent.apiKeyId ? 'Agent 绑定密钥' : '系统默认密钥'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择模型 <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedModelId}
                onChange={(e) => {
                  setSelectedModelId(e.target.value);
                  setTestResult(null);
                  setTestedModelId(null);
                  setStreamingResponse('');
                }}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">请选择模型...</option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
            </div>

            {selectedModel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <LockClosedIcon className="h-4 w-4 inline mr-1" />
                  选择 API 密钥
                  <span className="text-xs text-gray-500 ml-1">(可选，默认使用系统密钥)</span>
                </label>
                <select
                  value={selectedApiKeyId}
                  onChange={(e) => {
                    setSelectedApiKeyId(e.target.value);
                    setTestResult(null);
                    setStreamingResponse('');
                  }}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">使用系统默认密钥</option>
                  {filteredApiKeys.map((key) => {
                    const keyId = key.id || key._id;
                    const masked = key.keyMasked || '****';
                    return (
                      <option key={keyId} value={keyId}>
                        {masked} ({key.provider})
                      </option>
                    );
                  })}
                </select>
                {filteredApiKeys.length === 0 && (
                  <p className="mt-2 text-sm text-amber-600">
                    未找到 {selectedModel.provider} 的可用密钥，将使用系统默认配置
                  </p>
                )}
              </div>
            )}

            {selectedModel && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center mb-3">
                  <CheckCircleIcon className="h-5 w-5 text-blue-600 mr-2" />
                  <span className="font-medium text-blue-900">模型信息</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-blue-700">模型名称:</span>
                    <span className="font-medium text-blue-900">{selectedModel.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">提供商:</span>
                    <span
                      className="px-2 py-0.5 rounded text-xs text-white"
                      style={{ backgroundColor: getProviderColor(selectedModel.provider) }}
                    >
                      {selectedModel.provider}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Max Tokens:</span>
                    <span className="font-medium">{selectedModel.maxTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">Temperature:</span>
                    <span className="font-medium">{selectedModel.temperature}</span>
                  </div>
                </div>
              </div>
            )}

            {anthropicModelMayBeDeprecated && (
              <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                当前选择的 Anthropic 模型版本可能已下线。若测试失败，请切换到较新的 Claude 模型后重试。
              </div>
            )}

            <div>
              <button
                onClick={handleTest}
                disabled={isTesting || !selectedModel}
                className="inline-flex items-center px-4 py-2 border border-indigo-300 text-sm font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
              >
                <BeakerIcon className="h-4 w-4 mr-1" />
                {isTesting ? '测试中...' : '测试模型连接'}
              </button>
              <p className="mt-2 text-xs text-gray-500">会用当前Agent设定向所选模型发送一条测试消息。</p>

              {(isTesting || streamingResponse) && (
                <div className="mt-3 p-3 rounded-md border bg-indigo-50 border-indigo-200">
                  <div className="flex items-center mb-1">
                    <BeakerIcon className="h-4 w-4 text-indigo-600 mr-1" />
                    <span className="text-sm font-medium text-indigo-800">
                      {isTesting ? '流式返回中...' : '流式返回结果'}
                    </span>
                  </div>
                  <pre className="text-xs text-indigo-800 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                    {streamingResponse || '等待模型返回...'}
                  </pre>
                </div>
              )}

              {testResult && testedModelId === selectedModelId && (
                <div className={`mt-3 p-3 rounded-md border ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center mb-1">
                    {testResult.success ? (
                      <CheckCircleIcon className="h-4 w-4 text-green-600 mr-1" />
                    ) : (
                      <XCircleIcon className="h-4 w-4 text-red-600 mr-1" />
                    )}
                    <span className={`text-sm font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {testResult.success ? '模型连接成功' : '模型连接失败'}
                    </span>
                  </div>
                  <div className={`text-xs ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                    {testResult.success ? (
                      <>
                        <p>耗时: {testResult.duration || '-'}</p>
                        <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                        {testResult.note && <p className="mt-1 break-words">说明: {testResult.note}</p>}
                        <p className="mt-1 break-words">响应: {testResult.response || '-'}</p>
                      </>
                    ) : (
                      <>
                        <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                        <p className="break-words">错误: {testResult.error || '未知错误'}</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="space-y-3">
            {invalidSelectedTools.length > 0 && (
              <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                发现 {invalidSelectedTools.length} 个历史工具不在当前角色白名单中，保存时将自动移除。
              </div>
            )}
            <label className="inline-flex items-center text-xs text-gray-700">
              <input
                type="checkbox"
                checked={autoGrantPermissions}
                onChange={(e) => setAutoGrantPermissions(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="ml-2">自动赋权（默认开启）：勾选工具时自动补齐工具所需权限</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <select
                value={toolProviderFilter}
                onChange={(e) => setToolProviderFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              >
                <option value="">全部 Provider</option>
                {editToolProviderOptions.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
              <select
                value={toolNamespaceFilter}
                onChange={(e) => setToolNamespaceFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              >
                <option value="">全部 Namespace</option>
                {editToolNamespaceOptions.map((namespace) => (
                  <option key={namespace} value={namespace}>{getToolNamespaceDisplay(namespace)}</option>
                ))}
              </select>
            </div>
            <div className="max-h-[58vh] overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
            {groupedAllowedTools.map((group) => (
              <div key={group.namespace} className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{getToolNamespaceDisplay(group.namespace)}</p>
                {group.items.map((tool) => {
                  const toolId = getToolKey(tool);
                  const checked = selectedTools.includes(toolId);
                  const requiredPermissionIds = getToolRequiredPermissionIds(tool);
                  return (
                    <label key={toolId} className="block border border-gray-100 rounded-md p-2 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{tool.name}</p>
                          {tool.description && <p className="text-xs text-gray-500 mt-0.5">{tool.description}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">ID: {toolId}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {requiredPermissionIds.length > 0 ? (
                              requiredPermissionIds.map((permissionId) => (
                                <span key={`${toolId}-${permissionId}`} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                                  {permissionId}
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 border border-gray-200">
                                无需额外权限
                              </span>
                            )}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleTool(toolId, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mt-1"
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            ))}
            {groupedAllowedTools.length === 0 && (
              <p className="text-xs text-gray-500">暂无可配置工具</p>
            )}
            </div>
            <p className="text-xs text-gray-500">白名单模式：仅可选择当前角色工具权限集中的工具子集。</p>
          </div>
        )}

        {activeTab === 'basic' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Agent 名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 智能助手"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">角色 <span className="text-red-500">*</span></label>
              <select
                value={roleId}
                onChange={(e) => handleEditRoleChange(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">选择角色...</option>
                {businessRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {getRoleDisplayName(role)}（{getTierLabel(role.tier)}）
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">层级 Tier <span className="text-red-500">*</span></label>
              <select
                value={tier}
                onChange={(e) => setTier(normalizeTier(e.target.value))}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="leadership">leadership（高管层）</option>
                <option value="operations">operations（执行层）</option>
                <option value="temporary">temporary（临时工）</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">建议与角色默认层级保持一致；不一致会被后端校验拒绝。</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={2}
                placeholder="简要描述这个Agent的职责和能力..."
              />
            </div>

            <div>
              <PromptTemplateRefPicker
                value={promptTemplateRef}
                onChange={setPromptTemplateRef}
                helperText="可选增强：模板内容会追加到 systemPrompt 之后注入 Identity Layer；解析失败时仅保留 systemPrompt。"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prompt <span className="text-red-500">*</span></label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                rows={6}
                placeholder="定义Agent的行为和角色..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Config (JSON)</label>
              <textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-xs"
                rows={8}
                placeholder='例如: {"execution":{"provider":"opencode"},"budget":{"period":"day","limit":10,"unit":"runCount"}}'
              />
              <p className="mt-1 text-xs text-gray-500">编辑并保存后将更新 Agent 的 `config` 字段。</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">能力集 (逗号分隔)</label>
              <input
                type="text"
                value={capabilitiesText}
                onChange={(e) => setCapabilitiesText(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 文本生成, 代码编写, 数据分析"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !hasChanges}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading ? '保存中...' : '保存变更'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Agents;
