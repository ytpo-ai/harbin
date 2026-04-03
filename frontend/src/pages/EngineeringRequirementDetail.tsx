import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  engineeringIntelligenceService,
  RequirementStatus,
  RequirementCategory,
  RequirementComplexity,
} from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

function extractRequestErrorMessage(error: any): string {
  const candidates = [
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '请求失败，请稍后重试';
}

const STATUS_OPTIONS: RequirementStatus[] = ['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'];

const STATUS_LABEL: Record<RequirementStatus, string> = {
  todo: 'Todo',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

const CATEGORY_LABEL: Record<RequirementCategory, string> = {
  fix: 'Bug 修复',
  feature: '新功能',
  optimize: '优化',
};

const COMPLEXITY_LABEL: Record<RequirementComplexity, string> = {
  low: '低',
  medium: '中',
  high: '高',
  very_high: '超高',
};

const EngineeringRequirementDetail: React.FC = () => {
  const { requirementId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast, showToast, clearToast } = useToast(4000);

  const [statusNote, setStatusNote] = useState('');
  const [comment, setComment] = useState('');
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<RequirementStatus>('todo');

  const { data: detail, isLoading, refetch } = useQuery(
    ['ei-requirement-detail', requirementId],
    () => engineeringIntelligenceService.getRequirementById(requirementId),
    { enabled: Boolean(requirementId), retry: false },
  );

  const assignMutation = useMutation(
    async () => {
      const toAgentId = window.prompt('分发给 Agent ID', detail?.currentAssigneeAgentId || '');
      if (!toAgentId) return null;
      const toAgentName = window.prompt('Agent 名称（可选）', detail?.currentAssigneeAgentName || '') || undefined;
      const reason = window.prompt('分发原因（可选）', '') || undefined;
      const user = await authService.getCurrentUser();
      return engineeringIntelligenceService.assignRequirement(requirementId, {
        toAgentId: toAgentId.trim(),
        toAgentName: toAgentName?.trim() || undefined,
        assignedById: user?.id,
        assignedByName: user?.name,
        reason,
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['ei-requirement-detail', requirementId]);
        queryClient.invalidateQueries('ei-requirements');
        showToast('success', '分发成功');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const statusMutation = useMutation(
    async () => {
      const user = await authService.getCurrentUser();
      return engineeringIntelligenceService.updateRequirementStatus(requirementId, {
        status: targetStatus,
        changedById: user?.id,
        changedByName: user?.name,
        changedByType: 'human',
        note: statusNote.trim() || undefined,
      });
    },
    {
      onSuccess: () => {
        setStatusNote('');
        setIsStatusModalOpen(false);
        queryClient.invalidateQueries(['ei-requirement-detail', requirementId]);
        queryClient.invalidateQueries('ei-requirements');
        queryClient.invalidateQueries('ei-requirement-board');
        showToast('success', '状态更新成功');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const commentMutation = useMutation(
    async () => {
      const user = await authService.getCurrentUser();
      return engineeringIntelligenceService.addRequirementComment(requirementId, {
        content: comment.trim(),
        authorId: user?.id,
        authorName: user?.name,
        authorType: 'human',
      });
    },
    {
      onSuccess: () => {
        setComment('');
        queryClient.invalidateQueries(['ei-requirement-detail', requirementId]);
        showToast('success', '评论已发送');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const syncMutation = useMutation(
    async () => {
      const owner = window.prompt('GitHub owner', detail?.githubLink?.owner || '');
      if (!owner) return null;
      const repo = window.prompt('GitHub repo', detail?.githubLink?.repo || '');
      if (!repo) return null;
      return engineeringIntelligenceService.syncRequirementToGithub(requirementId, {
        owner: owner.trim(),
        repo: repo.trim(),
        labels: detail?.labels || [],
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['ei-requirement-detail', requirementId]);
        queryClient.invalidateQueries('ei-requirements');
        showToast('success', '同步 GitHub 成功');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const deleteMutation = useMutation(
    () => engineeringIntelligenceService.deleteRequirement(requirementId),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('ei-requirements');
        queryClient.invalidateQueries('ei-requirement-board');
        showToast('success', '需求已删除');
        window.setTimeout(() => {
          navigate('/ei/requirements');
        }, 200);
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const comments = useMemo(() => (detail?.comments || []).slice().reverse(), [detail?.comments]);
  const statusHistory = useMemo(() => (detail?.statusHistory || []).slice().reverse(), [detail?.statusHistory]);
  const canAssignAgent = useMemo(() => {
    if (!detail) {
      return false;
    }
    if (typeof detail.canAssignAgent === 'boolean') {
      return detail.canAssignAgent;
    }
    const hasLinkedPlan = (detail.linkedPlanIds || []).length > 0;
    const hasAssignedAgent = Boolean(String(detail.currentAssigneeAgentId || '').trim());
    return !(hasLinkedPlan && hasAssignedAgent);
  }, [detail]);
  const assignAgentDisabledReason = detail?.assignAgentDisabledReason || '已绑定计划且已分配负责人，不可重复分配';
  const assignAgentButtonDisabled = assignMutation.isLoading || !canAssignAgent;

  const openStatusModal = () => {
    setTargetStatus(detail?.status || 'todo');
    setStatusNote('');
    setIsStatusModalOpen(true);
  };

  const closeStatusModal = () => {
    if (statusMutation.isLoading) {
      return;
    }
    setIsStatusModalOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              to="/ei/requirements"
              className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              返回需求列表
            </Link>
            <p className="text-xs text-gray-400 font-mono">{requirementId}</p>
            <h1 className="text-lg font-semibold text-gray-900">{detail?.title || requirementId}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span>状态：{detail ? STATUS_LABEL[detail.status] : '-'}</span>
              {detail?.category ? <span>分类：{CATEGORY_LABEL[detail.category]}</span> : null}
              {detail?.complexity ? <span>复杂度：{COMPLEXITY_LABEL[detail.complexity]}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => refetch()} className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm"><ArrowPathIcon className="h-4 w-4" />刷新</button>
            <button
              onClick={() => {
                if (!window.confirm('确认删除该需求？该操作不可恢复。')) return;
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isLoading}
              className="px-3 py-2 border border-rose-300 text-rose-700 rounded text-sm disabled:opacity-50"
            >
              {deleteMutation.isLoading ? '删除中...' : '删除'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">需求说明</p>
            <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{detail?.description || '-'}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">讨论</p>
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {isLoading ? (
                <p className="text-xs text-gray-500">加载中...</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-gray-400">暂无讨论</p>
              ) : (
                comments.map((item) => (
                  <div key={item.commentId} className="border border-gray-200 rounded p-2 bg-gray-50">
                    <p className="text-xs text-gray-800">{item.content}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{item.authorName || item.authorId || 'unknown'} · {new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="添加讨论内容"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <button
                onClick={() => commentMutation.mutate()}
                disabled={!comment.trim() || commentMutation.isLoading}
                className="px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:bg-gray-300"
              >
                发送
              </button>
            </div>
          </div>
        </section>

        <section className="xl:col-span-4 bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">分发与状态</p>
            <p className="mt-1 text-xs text-gray-600">当前负责人：{detail?.currentAssigneeAgentName || detail?.currentAssigneeAgentId || '-'}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  if (assignAgentButtonDisabled) {
                    return;
                  }
                  assignMutation.mutate();
                }}
                disabled={assignAgentButtonDisabled}
                title={detail && !canAssignAgent ? assignAgentDisabledReason : undefined}
                className="px-3 py-2 border border-gray-300 rounded text-sm disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                分发给 Agent
              </button>
              <button
                onClick={() => syncMutation.mutate()}
                className="px-3 py-2 border border-gray-300 rounded text-sm"
              >
                同步 GitHub
              </button>
              <button
                onClick={openStatusModal}
                className="px-3 py-2 border border-gray-300 rounded text-sm"
              >
                修改状态
              </button>
            </div>
            {detail && !canAssignAgent ? <p className="mt-2 text-xs text-amber-700">{assignAgentDisabledReason}</p> : null}
            {detail?.githubLink?.issueUrl ? (
              <a href={detail.githubLink.issueUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-primary-700 hover:underline">
                GitHub #{detail.githubLink.issueNumber}
              </a>
            ) : null}
          </div>

          {detail?.linkedPlanIds && detail.linkedPlanIds.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-gray-900">关联计划</p>
              <div className="mt-2 space-y-1">
                {detail.linkedPlanIds.map((planId) => (
                  <Link
                    key={planId}
                    to={`/orchestration/plans/${planId}`}
                    className="block text-xs text-primary-700 hover:underline font-mono truncate"
                  >
                    {planId}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-sm font-semibold text-gray-900">状态轨迹</p>
            <div className="mt-2 space-y-2 max-h-[360px] overflow-y-auto">
              {statusHistory.length === 0 ? (
                <p className="text-xs text-gray-400">暂无状态更新</p>
              ) : (
                statusHistory.map((item) => (
                  <div key={item.eventId} className="border border-gray-200 rounded p-2 bg-gray-50">
                    <p className="text-xs text-gray-800">{STATUS_LABEL[item.fromStatus]} → {STATUS_LABEL[item.toStatus]}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{item.changedByName || item.changedById || 'unknown'} · {new Date(item.changedAt).toLocaleString()}</p>
                    {item.note ? <p className="mt-1 text-xs text-gray-600">{item.note}</p> : null}
                    {item.taskType || item.executorAgentName || item.planId ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.taskType ? <span className="inline-block text-[10px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">{item.taskType}</span> : null}
                        {item.executorAgentName ? <span className="inline-block text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">{item.executorAgentName}</span> : null}
                        {item.planId ? (
                          <Link to={`/orchestration/plans/${item.planId}`} className="inline-block text-[10px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 hover:underline">
                            计划
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                    {item.taskTitle ? <p className="mt-1 text-[11px] text-gray-500 italic">{item.taskTitle}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
      {isStatusModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
            <p className="text-base font-semibold text-gray-900">修改状态</p>
            <p className="mt-1 text-xs text-gray-600">设置目标状态，可选补充状态说明。</p>

            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs text-gray-600 mb-1">目标状态</p>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as RequirementStatus)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="text-xs text-gray-600 mb-1">状态说明（可选）</p>
                <input
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder={targetStatus === 'done' ? '例如：手动标记完成原因' : '例如：等待评审'}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={closeStatusModal}
                disabled={statusMutation.isLoading}
                className="px-3 py-2 border border-gray-300 rounded text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => statusMutation.mutate()}
                disabled={statusMutation.isLoading}
                className="px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:bg-gray-300"
              >
                {statusMutation.isLoading ? '提交中...' : '提交'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? <Toast toast={toast} onClose={clearToast} /> : null}
    </div>
  );
};

export default EngineeringRequirementDetail;
