import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { engineeringIntelligenceService, RequirementStatus } from '../services/engineeringIntelligenceService';
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
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500">需求详情</p>
            <h1 className="text-lg font-semibold text-gray-900">{detail?.title || requirementId}</h1>
            <p className="mt-1 text-sm text-gray-600">状态：{detail ? STATUS_LABEL[detail.status] : '-'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/ei/requirements" className="px-3 py-2 border border-gray-300 rounded text-sm">返回列表</Link>
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
                onClick={() => assignMutation.mutate()}
                className="px-3 py-2 border border-gray-300 rounded text-sm"
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
            {detail?.githubLink?.issueUrl ? (
              <a href={detail.githubLink.issueUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-primary-700 hover:underline">
                GitHub #{detail.githubLink.issueNumber}
              </a>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900">状态轨迹</p>
            <div className="mt-2 space-y-2 max-h-[280px] overflow-y-auto">
              {statusHistory.length === 0 ? (
                <p className="text-xs text-gray-400">暂无状态更新</p>
              ) : (
                statusHistory.map((item) => (
                  <div key={item.eventId} className="border border-gray-200 rounded p-2 bg-gray-50">
                    <p className="text-xs text-gray-800">{STATUS_LABEL[item.fromStatus]} → {STATUS_LABEL[item.toStatus]}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{item.changedByName || item.changedById || 'unknown'} · {new Date(item.changedAt).toLocaleString()}</p>
                    {item.note ? <p className="mt-1 text-xs text-gray-600">{item.note}</p> : null}
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
