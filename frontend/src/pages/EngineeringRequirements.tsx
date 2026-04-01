import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import { PlusIcon, ArrowPathIcon, ArrowUpOnSquareIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  engineeringIntelligenceService,
  RequirementItem,
  RequirementPriority,
  RequirementStatus,
  RequirementCategory,
  RequirementComplexity,
} from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';
import { rdConversationService, RdProject } from '../services/rdConversationService';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

const STATUS_OPTIONS: RequirementStatus[] = ['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'];
const PRIORITY_OPTIONS: RequirementPriority[] = ['low', 'medium', 'high', 'critical'];
const CATEGORY_OPTIONS: RequirementCategory[] = ['fix', 'feature', 'optimize'];
const COMPLEXITY_OPTIONS: RequirementComplexity[] = ['low', 'medium', 'high', 'very_high'];

const STATUS_LABEL: Record<RequirementStatus, string> = {
  todo: 'Todo',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

const PRIORITY_LABEL: Record<RequirementPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
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

const EngineeringRequirements: React.FC = () => {
  const queryClient = useQueryClient();
  const { toast, showToast, clearToast } = useToast(4000);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | 'all'>('all');
  const [localProjectFilterId, setLocalProjectFilterId] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RequirementPriority>('medium');
  const [category, setCategory] = useState<RequirementCategory | ''>('');
  const [complexity, setComplexity] = useState<RequirementComplexity>('medium');
  const [labelsInput, setLabelsInput] = useState('');
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState('');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncTarget, setSyncTarget] = useState<RequirementItem | null>(null);
  const [syncOwner, setSyncOwner] = useState('');
  const [syncRepo, setSyncRepo] = useState('');
  const [syncLabelsInput, setSyncLabelsInput] = useState('');

  const { data: localProjects = [] } = useQuery<RdProject[]>(
    ['ei-local-projects-for-requirements'],
    () => rdConversationService.getProjects({ sourceType: 'local' }),
    { retry: false },
  );

  const localProjectById = useMemo(() => {
    const map = new Map<string, RdProject>();
    localProjects.forEach((item) => map.set(item._id, item));
    return map;
  }, [localProjects]);

  // 只有一个项目时自动选中
  React.useEffect(() => {
    if (localProjects.length === 1 && !selectedLocalProjectId) {
      setSelectedLocalProjectId(localProjects[0]._id);
    }
  }, [localProjects, selectedLocalProjectId]);

  const { data: requirements = [], isLoading, refetch } = useQuery(
    ['ei-requirements', statusFilter, search, localProjectFilterId],
    () =>
      engineeringIntelligenceService.listRequirements({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search.trim() || undefined,
        limit: 100,
        localProjectId: localProjectFilterId || undefined,
      }),
    { retry: false },
  );

  const createMutation = useMutation(
    async () => {
      const user = await authService.getCurrentUser();
      const labels = labelsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      return engineeringIntelligenceService.createRequirement({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        category: category || undefined,
        complexity,
        labels,
        localProjectId: selectedLocalProjectId || undefined,
        createdById: user?.id,
        createdByName: user?.name,
        createdByType: 'human',
      });
    },
    {
      onSuccess: () => {
        setTitle('');
        setDescription('');
        setPriority('medium');
        setCategory('');
        setComplexity('medium');
        setLabelsInput('');
        setSelectedLocalProjectId('');
        queryClient.invalidateQueries('ei-requirements');
        showToast('success', '需求创建成功');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const syncMutation = useMutation(
    async (payload: { item: RequirementItem; owner: string; repo: string; labels: string[] }) => {
      return engineeringIntelligenceService.syncRequirementToGithub(payload.item.requirementId, {
        owner: payload.owner.trim(),
        repo: payload.repo.trim(),
        labels: payload.labels,
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('ei-requirements');
        showToast('success', '已同步到 GitHub Issue');
        setIsSyncModalOpen(false);
        setSyncTarget(null);
        setSyncOwner('');
        setSyncRepo('');
        setSyncLabelsInput('');
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const openSyncModal = (item: RequirementItem) => {
    setSyncTarget(item);
    const project = item.localProjectId ? localProjectById.get(item.localProjectId) : undefined;
    const githubBinding = project?.githubBindingId && typeof project.githubBindingId !== 'string'
      ? project.githubBindingId
      : undefined;
    setSyncOwner(String(githubBinding?.githubOwner || item.githubLink?.owner || ''));
    setSyncRepo(String(githubBinding?.githubRepo || item.githubLink?.repo || ''));
    setSyncLabelsInput((item.labels || []).join(', '));
    setIsSyncModalOpen(true);
  };

  const submitSyncToGithub = () => {
    if (!syncTarget) return;
    const project = syncTarget.localProjectId ? localProjectById.get(syncTarget.localProjectId) : undefined;
    const githubBinding = project?.githubBindingId && typeof project.githubBindingId !== 'string'
      ? project.githubBindingId
      : undefined;
    const owner = String(githubBinding?.githubOwner || syncOwner || '').trim();
    const repo = String(githubBinding?.githubRepo || syncRepo || '').trim();
    if (!owner) {
      showToast('error', 'GitHub owner 不能为空');
      return;
    }
    if (!repo) {
      showToast('error', 'GitHub repo 不能为空');
      return;
    }
    const labels = syncLabelsInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    syncMutation.mutate({ item: syncTarget, owner, repo, labels });
  };

  const submitCreateRequirement = () => {
    if (!selectedLocalProjectId.trim()) {
      showToast('error', '请选择项目');
      return;
    }
    createMutation.mutate();
  };

  const groupedCount = useMemo(() => {
    const counts: Record<RequirementStatus, number> = {
      todo: 0,
      assigned: 0,
      in_progress: 0,
      review: 0,
      done: 0,
      blocked: 0,
    };
    requirements.forEach((item) => {
      counts[item.status] += 1;
    });
    return counts;
  }, [requirements]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h1 className="text-lg font-semibold text-gray-900">研发需求管理</h1>
        <p className="mt-1 text-sm text-gray-600">承接 Agent 与人类讨论后的需求，支持分发和 GitHub Issue 同步。</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">新建需求</p>
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
            <select
              value={selectedLocalProjectId}
              onChange={(e) => setSelectedLocalProjectId(e.target.value)}
              className="md:col-span-3 border border-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="">请选择所属本地项目</option>
              {localProjects.map((item) => (
                <option key={item._id} value={item._id}>{item.name}</option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as RequirementCategory | '')}
              className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="">分类</option>
              {CATEGORY_OPTIONS.map((item) => (
                <option key={item} value={item}>{CATEGORY_LABEL[item]}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as RequirementPriority)}
              className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
            >
              {PRIORITY_OPTIONS.map((item) => (
                <option key={item} value={item}>{PRIORITY_LABEL[item]}</option>
              ))}
            </select>
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value as RequirementComplexity)}
              className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
            >
              {COMPLEXITY_OPTIONS.map((item) => (
                <option key={item} value={item}>复杂度: {COMPLEXITY_LABEL[item]}</option>
              ))}
            </select>
            <input
              value={labelsInput}
              onChange={(e) => setLabelsInput(e.target.value)}
              placeholder="标签，用逗号分隔"
              className="md:col-span-3 border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="需求标题"
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="需求描述"
              rows={4}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={submitCreateRequirement}
              disabled={!title.trim() || !selectedLocalProjectId.trim() || createMutation.isLoading}
              className="inline-flex items-center justify-center gap-1 bg-primary-600 text-white rounded px-3 py-2 text-sm disabled:bg-gray-300"
            >
              <PlusIcon className="h-4 w-4" />
              新建
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-2 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题或描述"
              className="pl-8 border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RequirementStatus | 'all')}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="all">全部状态</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>{STATUS_LABEL[item]}</option>
            ))}
          </select>
          <select
            value={localProjectFilterId}
            onChange={(e) => setLocalProjectFilterId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="">全部项目</option>
            {localProjects.map((item) => (
              <option key={item._id} value={item._id}>{item.name}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            刷新
          </button>
          <Link
            to="/ei/board"
            className="ml-auto inline-flex items-center gap-1 px-3 py-2 border border-primary-200 text-primary-700 rounded text-sm"
          >
            智能研发看板
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {STATUS_OPTIONS.map((item) => (
            <div key={item} className="border border-gray-200 rounded px-3 py-2 bg-gray-50">
              <p className="text-xs text-gray-500">{STATUS_LABEL[item]}</p>
              <p className="text-base font-semibold text-gray-900">{groupedCount[item]}</p>
            </div>
          ))}
        </div>

        <div className="border border-gray-200 rounded overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">编号</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">标题</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">分类</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">状态</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">优先级</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">复杂度</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">负责人</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">项目</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">GitHub</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-500" colSpan={10}>加载中...</td>
                </tr>
              ) : requirements.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-400" colSpan={10}>暂无需求</td>
                </tr>
              ) : (
                requirements.map((item) => (
                  <tr key={item.requirementId} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">{item.requirementId}</td>
                    <td className="px-3 py-2 text-xs">
                      <Link to={`/ei/requirements/${item.requirementId}`} className="text-primary-700 hover:underline">
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.category ? CATEGORY_LABEL[item.category] : '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{STATUS_LABEL[item.status]}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{PRIORITY_LABEL[item.priority]}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.complexity ? COMPLEXITY_LABEL[item.complexity] : '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.currentAssigneeAgentName || item.currentAssigneeAgentId || '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.localProjectId ? localProjectById.get(item.localProjectId)?.name || item.localProjectId : '-'}</td>
                    <td className="px-3 py-2 text-xs">
                      {item.githubLink?.issueUrl ? (
                        <a href={item.githubLink.issueUrl} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">
                          #{item.githubLink.issueNumber}
                        </a>
                      ) : item.localProjectId && localProjectById.get(item.localProjectId)?.githubBindingId ? (
                        <span className="text-amber-600">已绑定仓库，未同步</span>
                      ) : item.localProjectId ? (
                        <span className="text-rose-600">未绑定 GitHub</span>
                      ) : (
                        <span className="text-gray-400">未选择项目</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">
                      {(() => {
                        const project = item.localProjectId ? localProjectById.get(item.localProjectId) : undefined;
                        const hasGithubBinding = Boolean(project?.githubBindingId);
                        return (
                      <button
                        onClick={() => openSyncModal(item)}
                        disabled={!hasGithubBinding}
                        className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded"
                      >
                        <ArrowUpOnSquareIcon className="h-3.5 w-3.5" />
                        同步 GitHub
                      </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isSyncModalOpen && (
        <div className="fixed inset-0 z-[90]">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (syncMutation.isLoading) return;
              setIsSyncModalOpen(false);
            }}
            aria-label="关闭同步弹窗"
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white border border-gray-200 shadow-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">同步到 GitHub</p>
              <p className="text-xs text-gray-500 mt-1">{syncTarget?.title || '-'}</p>
            </div>

            {syncTarget?.localProjectId && !localProjectById.get(syncTarget.localProjectId)?.githubBindingId ? (
              <p className="text-xs text-rose-600">该需求所属项目未绑定 GitHub 仓库，无法同步。</p>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                value={syncOwner}
                onChange={(e) => setSyncOwner(e.target.value)}
                placeholder="owner"
                disabled
                className="border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                value={syncRepo}
                onChange={(e) => setSyncRepo(e.target.value)}
                placeholder="repo"
                disabled
                className="border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                value={syncLabelsInput}
                onChange={(e) => setSyncLabelsInput(e.target.value)}
                placeholder="labels, comma separated"
                className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsSyncModalOpen(false)}
                disabled={syncMutation.isLoading}
                className="border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-400"
              >
                取消
              </button>
              <button
                onClick={submitSyncToGithub}
                disabled={syncMutation.isLoading}
                className="rounded px-3 py-2 text-sm bg-primary-600 text-white disabled:bg-gray-300"
              >
                {syncMutation.isLoading ? '同步中...' : '确认同步'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast ? <Toast toast={toast} onClose={clearToast} /> : null}
    </div>
  );
};

export default EngineeringRequirements;
