import React, { useEffect, useState } from 'react';
import { CpuChipIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useQuery } from 'react-query';
import { PromptTemplateRefPicker } from '../PromptTemplateRefPicker';
import type { PromptTemplateRefValue } from '../PromptTemplateRefPicker';
import { apiKeyService } from '../../services/apiKeyService';
import type { AgentTier } from '../../services/agentService';
import { useAgentFormSync } from './hooks/useAgentFormSync';
import { useAgentToolFilter } from './hooks/useAgentToolFilter';
import type { CreateAgentModalProps } from './types';
import {
  buildAutoGrantedPermissions,
  getRoleDisplayName,
  getTierLabel,
  getToolKey,
  getToolNamespaceDisplay,
  getToolRequiredPermissionIds,
  isProviderCompatible,
  normalizeTier,
  parseConfigText,
} from './utils';

export const CreateAgentModal: React.FC<CreateAgentModalProps> = ({
  availableModels,
  availableTools,
  toolPermissionSets,
  businessRoles,
  isLoading,
  onClose,
  onCreate,
}) => {
  const [autoGrantPermissions, setAutoGrantPermissions] = useState(true);
  const [formData, setFormData] = useState<{
    name: string;
    roleId: string;
    tier: AgentTier;
    description: string;
    systemPrompt: string;
    promptTemplateRef: PromptTemplateRefValue | undefined;
    capabilities: string;
    modelId: string;
    apiKeyId: string;
    selectedTools: string[];
    configText: string;
  }>({
    name: '',
    roleId: '',
    tier: 'operations' as AgentTier,
    description: '',
    systemPrompt: '',
    promptTemplateRef: undefined,
    capabilities: '',
    modelId: availableModels[0]?.id || '',
    apiKeyId: '',
    selectedTools: [] as string[],
    configText: '{\n  "execution": {\n    "provider": "opencode"\n  }\n}',
  });

  const { data: apiKeys } = useQuery('apiKeys', apiKeyService.getAllApiKeys);
  const selectedModel = availableModels.find((m) => m.id === formData.modelId);
  const filteredApiKeys = (apiKeys || []).filter((key) => {
    if (!selectedModel?.provider || !key?.provider) return false;
    return isProviderCompatible(selectedModel.provider, key.provider) && key.isActive && !key.isDeprecated;
  });

  const { getRoleCodeByRoleId, syncRoleChange } = useAgentFormSync({ businessRoles, toolPermissionSets });
  const selectedRoleCode = getRoleCodeByRoleId(formData.roleId);
  const {
    toolProviderFilter,
    setToolProviderFilter,
    toolNamespaceFilter,
    setToolNamespaceFilter,
    allowedToolIds,
    allowedTools,
    providerOptions,
    namespaceOptions,
    groupedTools,
  } = useAgentToolFilter({ availableTools, toolPermissionSets, selectedRoleCode });

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      selectedTools: prev.selectedTools.filter((toolId) => allowedToolIds.has(toolId)),
    }));
  }, [allowedToolIds]);

  const handleCreateRoleChange = (nextRoleId: string) => {
    setFormData((prev) => {
      const synced = syncRoleChange({
        nextRoleId,
        currentRoleId: prev.roleId,
        currentSystemPrompt: prev.systemPrompt,
        currentSelectedTools: prev.selectedTools,
        emptyPromptFallback: 'keep-current',
      });

      return {
        ...prev,
        roleId: nextRoleId,
        tier: synced.tier,
        systemPrompt: synced.systemPrompt,
        selectedTools: synced.selectedTools,
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

    const configParsed = parseConfigText(formData.configText);
    if (configParsed.error) {
      alert(configParsed.error);
      return;
    }

    onCreate({
      name: formData.name,
      roleId: formData.roleId,
      tier: formData.tier,
      description: formData.description,
      systemPrompt: formData.systemPrompt,
      promptTemplateRef: formData.promptTemplateRef,
      capabilities: formData.capabilities.split(',').map((cap) => cap.trim()).filter(Boolean),
      model: selectedModel,
      apiKeyId: formData.apiKeyId || undefined,
      isActive: true,
      tools: formData.selectedTools,
      permissions: nextPermissions,
      personality: {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80,
      },
      learningAbility: 80,
      config: configParsed.config || {},
    } as any);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[600px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-gray-900 mb-6">创建新Agent</h3>
        <form onSubmit={handleSubmit} className="space-y-5">
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
              {filteredApiKeys.length === 0 && (
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
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
              <select
                value={toolNamespaceFilter}
                onChange={(e) => setToolNamespaceFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              >
                <option value="">全部 Namespace</option>
                {namespaceOptions.map((namespace) => (
                  <option key={namespace} value={namespace}>{getToolNamespaceDisplay(namespace)}</option>
                ))}
              </select>
            </div>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
              {groupedTools.map((group) => (
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
              {groupedTools.length === 0 && (
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
              disabled={isLoading || !formData.modelId || !formData.roleId}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading ? '创建中...' : '创建Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
