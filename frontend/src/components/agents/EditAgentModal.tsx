import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useQuery } from 'react-query';
import { PromptTemplateRefPicker } from '../PromptTemplateRefPicker';
import type { AgentTestResult } from '../../services/agentService';
import { agentService } from '../../services/agentService';
import { apiKeyService } from '../../services/apiKeyService';
import type { PromptTemplateRef } from '../../types';
import { ModelTestPanel } from './ModelTestPanel';
import { useAgentFormSync } from './hooks/useAgentFormSync';
import { useAgentToolFilter } from './hooks/useAgentToolFilter';
import type { EditAgentModalProps } from './types';
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
  prettyConfigText,
} from './utils';

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

export const EditAgentModal: React.FC<EditAgentModalProps> = ({
  agent,
  availableModels,
  availableTools,
  toolPermissionSets,
  businessRoles,
  onClose,
  onSave,
  isLoading,
}) => {
  const initialRoleTier = normalizeTier(businessRoles.find((role) => role.id === agent.roleId)?.tier);
  const initialAgentTier = normalizeTier(agent.tier || initialRoleTier);

  const [activeTab, setActiveTab] = useState<'model' | 'tools' | 'basic'>('model');
  const [autoGrantPermissions, setAutoGrantPermissions] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState(agent.model?.id || '');
  const [selectedApiKeyId, setSelectedApiKeyId] = useState(agent.apiKeyId || '');
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.tools || []);
  const [name, setName] = useState(agent.name || '');
  const [roleId, setRoleId] = useState(agent.roleId || '');
  const [tier, setTier] = useState(initialAgentTier);
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

  const parsedCapabilities = useMemo(() => {
    return capabilitiesText
      .split(',')
      .map((cap) => cap.trim())
      .filter(Boolean);
  }, [capabilitiesText]);

  const { getRoleCodeByRoleId, syncRoleChange } = useAgentFormSync({ businessRoles, toolPermissionSets });
  const selectedRoleCode = getRoleCodeByRoleId(roleId);
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

  const invalidSelectedTools = selectedTools.filter((toolId) => !allowedToolIds.has(toolId));

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
  }, [allowedToolIds]);

  useEffect(() => {
    if (!selectedApiKeyId) return;
    const matched = filteredApiKeys.some((key) => (key.id || key._id) === selectedApiKeyId);
    if (!matched) {
      setSelectedApiKeyId('');
    }
  }, [filteredApiKeys, selectedApiKeyId]);

  const handleEditRoleChange = (nextRoleId: string) => {
    const synced = syncRoleChange({
      nextRoleId,
      currentRoleId: roleId,
      currentSystemPrompt: systemPrompt,
      currentSelectedTools: selectedTools,
      emptyPromptFallback: 'empty',
    });
    setRoleId(nextRoleId);
    setTier(synced.tier);
    setSystemPrompt(synced.systemPrompt);
    setSelectedTools(synced.selectedTools);
  };

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
    const withMongoId = agent as typeof agent & { _id?: string };
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
              <label className="block text-sm font-medium text-gray-700 mb-2">选择模型 <span className="text-red-500">*</span></label>
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

            <ModelTestPanel
              selectedModel={selectedModel}
              selectedModelId={selectedModelId}
              testResult={testResult}
              testedModelId={testedModelId}
              isTesting={isTesting}
              streamingResponse={streamingResponse}
              onTest={handleTest}
            />
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
            <div className="max-h-[58vh] overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
              {groupedTools.map((group) => (
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
                            onChange={(e) => {
                              setSelectedTools((prev) => (
                                e.target.checked ? [...prev, toolId] : prev.filter((id) => id !== toolId)
                              ));
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
              <label className="block text-sm font-medium text-gray-700 mb-1">能力集 (逗号分隔)</label>
              <input
                type="text"
                value={capabilitiesText}
                onChange={(e) => setCapabilitiesText(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 文本生成, 代码编写, 数据分析"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                rows={6}
                placeholder="定义Agent的行为和角色..."
              />
            </div>

            <div>
              <PromptTemplateRefPicker
                value={promptTemplateRef}
                onChange={setPromptTemplateRef}
                onApplyTemplate={({ content }) => setSystemPrompt(content)}
                helperText="仅用于填充 Prompt 文本，不会在 Agent 上保存模板绑定关系。"
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
