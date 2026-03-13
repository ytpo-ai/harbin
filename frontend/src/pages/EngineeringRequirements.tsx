import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import { PlusIcon, ArrowPathIcon, ArrowUpOnSquareIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  engineeringIntelligenceService,
  RequirementItem,
  RequirementPriority,
  RequirementStatus,
} from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';

const STATUS_OPTIONS: RequirementStatus[] = ['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'];
const PRIORITY_OPTIONS: RequirementPriority[] = ['low', 'medium', 'high', 'critical'];

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

const EngineeringRequirements: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | 'all'>('all');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RequirementPriority>('medium');
  const [labelsInput, setLabelsInput] = useState('');

  const { data: requirements = [], isLoading, refetch } = useQuery(
    ['ei-requirements', statusFilter, search],
    () =>
      engineeringIntelligenceService.listRequirements({
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search.trim() || undefined,
        limit: 100,
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
        labels,
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
        setLabelsInput('');
        queryClient.invalidateQueries('ei-requirements');
      },
    },
  );

  const syncMutation = useMutation(
    async (item: RequirementItem) => {
      const owner = window.prompt('GitHub owner', item.githubLink?.owner || '');
      if (!owner) return null;
      const repo = window.prompt('GitHub repo', item.githubLink?.repo || '');
      if (!repo) return null;
      return engineeringIntelligenceService.syncRequirementToGithub(item.requirementId, {
        owner: owner.trim(),
        repo: repo.trim(),
        labels: item.labels,
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('ei-requirements');
      },
    },
  );

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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="需求标题"
            className="md:col-span-5 border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as RequirementPriority)}
            className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
          >
            {PRIORITY_OPTIONS.map((item) => (
              <option key={item} value={item}>{PRIORITY_LABEL[item]}</option>
            ))}
          </select>
          <input
            value={labelsInput}
            onChange={(e) => setLabelsInput(e.target.value)}
            placeholder="标签，用逗号分隔"
            className="md:col-span-3 border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isLoading}
            className="md:col-span-2 inline-flex items-center justify-center gap-1 bg-primary-600 text-white rounded px-3 py-2 text-sm disabled:bg-gray-300"
          >
            <PlusIcon className="h-4 w-4" />
            创建
          </button>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="需求描述"
            rows={3}
            className="md:col-span-12 border border-gray-300 rounded px-3 py-2 text-sm"
          />
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
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            刷新
          </button>
          <Link
            to="/engineering-intelligence/board"
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
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">标题</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">状态</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">优先级</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">负责人</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">GitHub</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-500" colSpan={6}>加载中...</td>
                </tr>
              ) : requirements.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-400" colSpan={6}>暂无需求</td>
                </tr>
              ) : (
                requirements.map((item) => (
                  <tr key={item.requirementId} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs">
                      <Link to={`/engineering-intelligence/requirements/${item.requirementId}`} className="text-primary-700 hover:underline">
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{STATUS_LABEL[item.status]}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{PRIORITY_LABEL[item.priority]}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.currentAssigneeAgentName || item.currentAssigneeAgentId || '-'}</td>
                    <td className="px-3 py-2 text-xs">
                      {item.githubLink?.issueUrl ? (
                        <a href={item.githubLink.issueUrl} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">
                          #{item.githubLink.issueNumber}
                        </a>
                      ) : (
                        <span className="text-gray-400">未关联</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">
                      <button
                        onClick={() => syncMutation.mutate(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded"
                      >
                        <ArrowUpOnSquareIcon className="h-3.5 w-3.5" />
                        同步 GitHub
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default EngineeringRequirements;
