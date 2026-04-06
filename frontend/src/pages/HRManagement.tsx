import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { hrService, HRAgentRole } from '../services/hrService';
import { agentService, AgentToolPermissionSet } from '../services/agentService';
import { toolService } from '../services/toolService';
import ToolPermissionSetEditor, { ToolPermissionSetEditorData } from '../components/agents/ToolPermissionSetEditor';
import { 
  UserGroupIcon, 
  ChartBarIcon, 
  ExclamationTriangleIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

const HRManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleModalTab, setRoleModalTab] = useState<'basic' | 'toolPermission'>('basic');
  const [toolPermissionData, setToolPermissionData] = useState<ToolPermissionSetEditorData>({
    description: '',
    permissions: [],
    exposed: false,
    tools: [],
  });
  const [initialToolPermissionData, setInitialToolPermissionData] = useState<ToolPermissionSetEditorData>({
    description: '',
    permissions: [],
    exposed: false,
    tools: [],
  });
  const [isToolPermissionDirty, setIsToolPermissionDirty] = useState(false);
  const [roleForm, setRoleForm] = useState({
    code: '',
    name: '',
    tier: 'operations' as 'leadership' | 'operations' | 'temporary',
    description: '',
    promptTemplate: '',
    status: 'active' as 'active' | 'inactive',
  });
  const [roleArraysSnapshot, setRoleArraysSnapshot] = useState<{ capabilities: string[]; tools: string[] }>({
    capabilities: [],
    tools: [],
  });

  const { data: teamHealth } = useQuery('team-health', hrService.calculateTeamHealth);
  const { data: lowPerformers } = useQuery('low-performers', hrService.identifyLowPerformers);
  const { data: hiringRecommendations } = useQuery('hiring-recommendations', hrService.recommendHiring);
  const { data: roles } = useQuery('hr-agent-roles', () => hrService.getRoles());
  const { data: toolPermissionSets } = useQuery('agentToolPermissionSets', agentService.getToolPermissionSets);
  const { data: availableTools } = useQuery(['tool-registry'], () => toolService.getToolRegistry(), {
    enabled: isRoleModalOpen,
  });

  const permissionSetByRoleCode = useMemo(() => {
    const map = new Map<string, AgentToolPermissionSet>();
    (toolPermissionSets || []).forEach((permissionSet) => {
      map.set(permissionSet.roleCode, permissionSet);
    });
    return map;
  }, [toolPermissionSets]);

  const buildPermissionData = (permissionSet?: AgentToolPermissionSet | null): ToolPermissionSetEditorData => {
    if (!permissionSet) {
      return {
        description: '',
        permissions: [],
        exposed: false,
        tools: [],
      };
    }

    return {
      description: permissionSet.description || '',
      permissions: permissionSet.permissions || permissionSet.capabilities || [],
      exposed: permissionSet.exposed === true,
      tools: permissionSet.tools || [],
    };
  };

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setRoleModalTab('basic');
    setIsToolPermissionDirty(false);
    setRoleForm({
      code: '',
      name: '',
      tier: 'operations',
      description: '',
      promptTemplate: '',
      status: 'active',
    });
    setToolPermissionData({
      description: '',
      permissions: [],
      exposed: false,
      tools: [],
    });
    setInitialToolPermissionData({
      description: '',
      permissions: [],
      exposed: false,
      tools: [],
    });
    setRoleArraysSnapshot({ capabilities: [], tools: [] });
  };

  const isPermissionDataChanged = (nextData: ToolPermissionSetEditorData, baseData: ToolPermissionSetEditorData): boolean => {
    const normalize = (data: ToolPermissionSetEditorData) => ({
      description: data.description.trim(),
      exposed: data.exposed,
      permissions: [...data.permissions].map((item) => item.trim()).filter(Boolean).sort(),
      tools: [...data.tools].map((item) => item.trim()).filter(Boolean).sort(),
    });

    return JSON.stringify(normalize(nextData)) !== JSON.stringify(normalize(baseData));
  };

  const createRoleMutation = useMutation(hrService.createRole);

  const updateRoleMutation = useMutation(
    ({ roleId, payload }: { roleId: string; payload: Parameters<typeof hrService.updateRole>[1] }) =>
      hrService.updateRole(roleId, payload),
  );

  const upsertPermissionSetMutation = useMutation(
    ({ roleCode, updates }: { roleCode: string; updates: Pick<AgentToolPermissionSet, 'tools' | 'permissions' | 'exposed' | 'description'> }) =>
      agentService.upsertToolPermissionSet(roleCode, updates),
  );

  const deleteRoleMutation = useMutation(hrService.deleteRole, {
    onSuccess: () => {
      queryClient.invalidateQueries('hr-agent-roles');
      if (editingRoleId) {
        resetRoleForm();
      }
    },
  });

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      code: roleForm.code.trim(),
      name: roleForm.name.trim(),
      tier: roleForm.tier,
      description: roleForm.description.trim(),
      capabilities: roleArraysSnapshot.capabilities,
      tools: roleArraysSnapshot.tools,
      promptTemplate: roleForm.promptTemplate.trim(),
      status: roleForm.status,
    };

    if (!payload.code || !payload.name) {
      window.alert('角色 code 和名称不能为空');
      return;
    }

    try {
      if (editingRoleId) {
        await updateRoleMutation.mutateAsync({ roleId: editingRoleId, payload });
      } else {
        await createRoleMutation.mutateAsync(payload);
      }

      if (editingRoleId && isToolPermissionDirty) {
        await upsertPermissionSetMutation.mutateAsync({
          roleCode: payload.code,
          updates: toolPermissionData,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries('hr-agent-roles'),
        queryClient.invalidateQueries('agentToolPermissionSets'),
      ]);

      resetRoleForm();
      setIsRoleModalOpen(false);
    } catch (error) {
      window.alert(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleRoleEdit = (role: HRAgentRole) => {
    setEditingRoleId(role.id);
    setRoleModalTab('basic');
    setIsToolPermissionDirty(false);
    setRoleForm({
      code: role.code || '',
      name: role.name || '',
      tier: role.tier || 'operations',
      description: role.description || '',
      promptTemplate: role.promptTemplate || '',
      status: role.status || 'active',
    });
    setRoleArraysSnapshot({
      capabilities: role.capabilities || [],
      tools: role.tools || [],
    });
    const permissionData = buildPermissionData(permissionSetByRoleCode.get(role.code || ''));
    setToolPermissionData(permissionData);
    setInitialToolPermissionData(permissionData);
    setIsRoleModalOpen(true);
  };

  const closeRoleModal = () => {
    setIsRoleModalOpen(false);
    resetRoleForm();
  };

  const openCreateRoleModal = () => {
    resetRoleForm();
    setRoleModalTab('basic');
    setIsRoleModalOpen(true);
  };

  const handleRoleDelete = (roleId: string) => {
    if (!window.confirm('确认删除该角色吗？')) {
      return;
    }
    deleteRoleMutation.mutate(roleId);
  };

  useEffect(() => {
    if (!isRoleModalOpen || !editingRoleId || isToolPermissionDirty) {
      return;
    }
    const permissionData = buildPermissionData(permissionSetByRoleCode.get(roleForm.code));
    setToolPermissionData(permissionData);
    setInitialToolPermissionData(permissionData);
  }, [isRoleModalOpen, editingRoleId, isToolPermissionDirty, permissionSetByRoleCode, roleForm.code]);

  const HealthGradeBadge: React.FC<{ grade: string }> = ({ grade }) => {
    const colors = {
      excellent: 'bg-green-100 text-green-800',
      good: 'bg-blue-100 text-blue-800',
      fair: 'bg-yellow-100 text-yellow-800',
      poor: 'bg-red-100 text-red-800'
    };

    const labels = {
      excellent: '优秀',
      good: '良好',
      fair: '一般',
      poor: '较差'
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[grade as keyof typeof colors]}`}>
        {labels[grade as keyof typeof labels]}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">角色管理</h1>
        <p className="mt-1 text-sm text-gray-500">统一维护 Agent 角色定义与能力配置</p>
      </div>

      <div className="bg-white shadow rounded-lg p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">角色列表</h2>
            <p className="text-sm text-gray-500">默认展示全部角色，可随时新增或编辑</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">共 {roles?.length || 0} 个角色</span>
            <button
              type="button"
              onClick={openCreateRoleModal}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              创建角色
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">名称</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tier</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">状态</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Capabilities</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tools</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Exposed</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(roles || []).map((role) => {
                const permissionSet = permissionSetByRoleCode.get(role.code || '');
                return (
                  <tr key={role.id}>
                    <td className="px-4 py-3 text-gray-800 font-medium">{role.code}</td>
                    <td className="px-4 py-3 text-gray-700">{role.name}</td>
                    <td className="px-4 py-3 text-gray-700">{role.tier || 'operations'}</td>
                    <td className="px-4 py-3 text-gray-700">{role.status}</td>
                    <td className="px-4 py-3 text-gray-700">{(permissionSet?.permissions || role.capabilities || []).length}</td>
                    <td className="px-4 py-3 text-gray-700">{(permissionSet?.tools || role.tools || []).length}</td>
                    <td className="px-4 py-3 text-gray-700">{permissionSet ? (permissionSet.exposed ? '是' : '否') : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRoleEdit(role)}
                          className="px-2.5 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRoleDelete(role.id)}
                          className="px-2.5 py-1.5 border border-red-200 rounded text-red-600 hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(roles || []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    暂无角色，请先创建角色
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 团队健康度概览 */}
      {teamHealth && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <ChartBarIcon className="h-8 w-8 text-primary-600 mr-3" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">团队健康度</h2>
                <p className="text-gray-600">整体团队表现评估</p>
              </div>
            </div>
            <HealthGradeBadge grade={teamHealth.grade} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{teamHealth.metrics.overallScore}</div>
              <div className="text-sm text-gray-500">平均绩效分</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{teamHealth.highPerformers}</div>
              <div className="text-sm text-gray-500">高绩效员工</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{teamHealth.averagePerformers}</div>
              <div className="text-sm text-gray-500">中等绩效员工</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{teamHealth.lowPerformers}</div>
              <div className="text-sm text-gray-500">低绩效员工</div>
            </div>
          </div>

          {teamHealth.recommendations.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">团队建议</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                {teamHealth.recommendations.map((rec: string, index: number) => (
                  <li key={index} className="flex items-start">
                    <span className="text-primary-600 mr-1">•</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 低绩效员工警告 */}
      {lowPerformers && lowPerformers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <ExclamationTriangleIcon className="h-6 w-6 text-red-600 mr-2" />
            <h2 className="text-lg font-semibold text-red-900">低绩效员工警告</h2>
          </div>
          <div className="space-y-3">
            {lowPerformers.map((performer: any, index: number) => (
              <div key={index} className="bg-white rounded p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">Agent {performer.agentId}</span>
                  <span className="text-sm text-red-600">评分: {performer.report.overallScore}</span>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  风险原因: {performer.terminationRisks.join(', ')}
                </div>
                <div className="text-sm">
                  <span className="font-medium">建议操作:</span>
                  <ul className="mt-1 space-y-1">
                    {performer.recommendedActions.map((action: string, actionIndex: number) => (
                      <li key={actionIndex} className="flex items-start">
                        <span className="text-red-600 mr-1">•</span>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 招聘建议 */}
      {hiringRecommendations && hiringRecommendations.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <UserGroupIcon className="h-6 w-6 text-green-600 mr-2" />
            <h2 className="text-lg font-semibold text-green-900">招聘建议</h2>
          </div>
          <div className="space-y-3">
            {hiringRecommendations.map((rec: any, index: number) => (
              <div key={index} className="bg-white rounded p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">
                    {rec.type === 'expansion' ? `${rec.department} 扩张` : '工作负荷调整'}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    rec.priority === 'high' ? 'bg-red-100 text-red-800' :
                    rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {rec.priority === 'high' ? '高优先级' : rec.priority === 'medium' ? '中优先级' : '低优先级'}
                  </span>
                </div>
                
                {rec.type === 'expansion' ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      当前员工: {rec.currentEmployees} / {rec.maxCapacity} ({rec.utilization}%)
                    </p>
                    <div className="text-sm">
                      <span className="font-medium">建议职位:</span>
                      <ul className="mt-1 space-y-1">
                        {rec.suggestedRoles.map((role: any, roleIndex: number) => (
                          <li key={roleIndex} className="flex items-center justify-between">
                            <span>{role.title}</span>
                            <span className="text-gray-500">
                              ¥{role.salaryRange.min.toLocaleString()} - ¥{role.salaryRange.max.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      当前积压任务: {rec.currentBacklog}
                    </p>
                    <p className="text-sm text-gray-600">
                      建议招聘: {rec.recommendedNewHires} 人
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-3xl bg-white rounded-xl shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{editingRoleId ? '编辑角色' : '创建角色'}</h3>
                <p className="text-sm text-gray-500">配置角色基础信息与工具权限集</p>
              </div>
              <button
                type="button"
                onClick={closeRoleModal}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="px-6 pt-4 border-b border-gray-200">
              <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => setRoleModalTab('basic')}
                  className={`px-4 py-1.5 text-sm rounded ${
                    roleModalTab === 'basic' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  基础信息
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!editingRoleId) {
                      return;
                    }
                    setRoleModalTab('toolPermission');
                  }}
                  disabled={!editingRoleId}
                  className={`px-4 py-1.5 text-sm rounded ${
                    roleModalTab === 'toolPermission'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : editingRoleId
                        ? 'text-gray-600 hover:text-gray-800'
                        : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  工具权限管理
                </button>
              </div>
            </div>
            <form onSubmit={handleRoleSubmit} className="p-6 space-y-4">
              {roleModalTab === 'basic' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                    <input
                      type="text"
                      value={roleForm.code}
                      onChange={(e) => setRoleForm((prev) => ({ ...prev, code: e.target.value }))}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="例如: model-management-specialist"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                    <input
                      type="text"
                      value={roleForm.name}
                      onChange={(e) => setRoleForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="例如: 模型管理专员"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tier</label>
                    <select
                      value={roleForm.tier}
                      onChange={(e) =>
                        setRoleForm((prev) => ({
                          ...prev,
                          tier: e.target.value as 'leadership' | 'operations' | 'temporary',
                        }))
                      }
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="leadership">leadership（高管层）</option>
                      <option value="operations">operations（执行层）</option>
                      <option value="temporary">temporary（临时工）</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                    <select
                      value={roleForm.status}
                      onChange={(e) => setRoleForm((prev) => ({ ...prev, status: e.target.value as 'active' | 'inactive' }))}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                    <textarea
                      value={roleForm.description}
                      onChange={(e) => setRoleForm((prev) => ({ ...prev, description: e.target.value }))}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                      rows={2}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prompt 模板</label>
                    <textarea
                      value={roleForm.promptTemplate}
                      onChange={(e) => setRoleForm((prev) => ({ ...prev, promptTemplate: e.target.value }))}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {roleModalTab === 'toolPermission' && (
                <div>
                  {!editingRoleId ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                      请先创建角色，再配置工具权限
                    </div>
                  ) : (
                    <ToolPermissionSetEditor
                      initialData={initialToolPermissionData}
                      availableTools={availableTools || []}
                      onChange={(data) => {
                        setToolPermissionData(data);
                        setIsToolPermissionDirty(isPermissionDataChanged(data, initialToolPermissionData));
                      }}
                    />
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={closeRoleModal}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createRoleMutation.isLoading || updateRoleMutation.isLoading || upsertPermissionSetMutation.isLoading}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md disabled:opacity-50"
                >
                  {createRoleMutation.isLoading || updateRoleMutation.isLoading || upsertPermissionSetMutation.isLoading
                    ? '保存中...'
                    : editingRoleId
                      ? '保存角色'
                      : '创建角色'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default HRManagement;
