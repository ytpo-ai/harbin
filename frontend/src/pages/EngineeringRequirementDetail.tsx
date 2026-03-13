import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { engineeringIntelligenceService, RequirementStatus } from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';

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
  const queryClient = useQueryClient();

  const [statusNote, setStatusNote] = useState('');
  const [comment, setComment] = useState('');

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
      },
    },
  );

  const statusMutation = useMutation(
    async (status: RequirementStatus) => {
      const user = await authService.getCurrentUser();
      return engineeringIntelligenceService.updateRequirementStatus(requirementId, {
        status,
        changedById: user?.id,
        changedByName: user?.name,
        changedByType: 'human',
        note: statusNote.trim() || undefined,
      });
    },
    {
      onSuccess: () => {
        setStatusNote('');
        queryClient.invalidateQueries(['ei-requirement-detail', requirementId]);
        queryClient.invalidateQueries('ei-requirements');
        queryClient.invalidateQueries('ei-requirement-board');
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
      },
    },
  );

  const comments = useMemo(() => (detail?.comments || []).slice().reverse(), [detail?.comments]);
  const statusHistory = useMemo(() => (detail?.statusHistory || []).slice().reverse(), [detail?.statusHistory]);

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
            <Link to="/engineering-intelligence/requirements" className="px-3 py-2 border border-gray-300 rounded text-sm">返回列表</Link>
            <button onClick={() => refetch()} className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm"><ArrowPathIcon className="h-4 w-4" />刷新</button>
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
            </div>
            {detail?.githubLink?.issueUrl ? (
              <a href={detail.githubLink.issueUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-primary-700 hover:underline">
                GitHub #{detail.githubLink.issueNumber}
              </a>
            ) : null}
          </div>

          <div>
            <p className="text-xs text-gray-600 mb-1">状态说明（可选）</p>
            <input
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              placeholder="例如：等待评审"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  onClick={() => statusMutation.mutate(status)}
                  className="px-2 py-1.5 border border-gray-300 rounded text-xs"
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
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
    </div>
  );
};

export default EngineeringRequirementDetail;
