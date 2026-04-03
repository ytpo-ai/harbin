import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  CalendarIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import {
  incubationProjectService,
  IncubationProject,
  IncubationProjectStats,
  IncubationProjectStatus,
} from '../services/incubationProjectService';

type DetailTab = 'agents' | 'requirements';

const STATUS_LABEL: Record<IncubationProjectStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

const STATUS_COLOR: Record<IncubationProjectStatus, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-600',
};

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  return dateStr.slice(0, 10);
}

const IncubationProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DetailTab>('agents');

  // ---- Project detail ----
  const {
    data: project,
    isLoading: projectLoading,
    error: projectError,
  } = useQuery<IncubationProject>(
    ['incubation-project-detail', id],
    () => incubationProjectService.getById(id!),
    { enabled: Boolean(id), retry: false },
  );

  // ---- Stats ----
  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery<IncubationProjectStats>(
    ['incubation-project-stats', id],
    () => incubationProjectService.getProjectStats(id!),
    { enabled: Boolean(id), retry: false },
  );

  // ---- Agents ----
  const {
    data: agents = [],
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useQuery<any[]>(
    ['incubation-project-agents', id],
    () => incubationProjectService.getProjectAgents(id!),
    { enabled: Boolean(id) && activeTab === 'agents', retry: false },
  );

  // ---- Requirements ----
  const {
    data: requirements = [],
    isLoading: requirementsLoading,
    refetch: refetchRequirements,
  } = useQuery<any[]>(
    ['incubation-project-requirements', id],
    () => incubationProjectService.getProjectRequirements(id!),
    { enabled: Boolean(id) && activeTab === 'requirements', retry: false },
  );

  if (projectLoading) {
    return <div className="p-6 text-sm text-gray-500">加载中...</div>;
  }

  if (projectError || !project) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-red-600">项目加载失败或不存在。</p>
        <button onClick={() => navigate('/ei')} className="text-sm text-primary-600 hover:underline">
          返回项目管理
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate('/ei')}
            className="text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">{project.name}</h1>
          <span className={`inline-block px-2 py-0.5 text-xs rounded ${STATUS_COLOR[project.status]}`}>
            {STATUS_LABEL[project.status]}
          </span>
        </div>
        {project.goal && <p className="text-sm text-gray-700">{project.goal}</p>}
        {project.description && <p className="text-xs text-gray-500 mt-1">{project.description}</p>}
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
          <span>创建: {formatDate(project.createdAt)}</span>
          {project.startDate && <span>开始: {formatDate(project.startDate)}</span>}
          {project.endDate && <span>截止: {formatDate(project.endDate)}</span>}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard icon={<UserGroupIcon className="h-4 w-4 text-blue-500" />} label="Agent" value={stats?.agents} loading={statsLoading} />
        <StatCard icon={<ClipboardDocumentListIcon className="h-4 w-4 text-indigo-500" />} label="计划" value={stats?.plans.total} loading={statsLoading} />
        <StatCard icon={<DocumentTextIcon className="h-4 w-4 text-green-500" />} label="需求" value={stats?.requirements.total} loading={statsLoading} />
        <StatCard icon={<CalendarIcon className="h-4 w-4 text-orange-500" />} label="调度" value={stats?.schedules.total} loading={statsLoading} />
        <StatCard icon={<ChatBubbleLeftRightIcon className="h-4 w-4 text-purple-500" />} label="会议" value={stats?.meetings.total} loading={statsLoading} />
        <StatCard
          icon={<ArrowPathIcon className="h-4 w-4 text-teal-500" />}
          label="运行"
          value={stats?.runs.total}
          loading={statsLoading}
        />
      </div>

      {/* Tab bar + content */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 pt-3 pb-0 border-b border-gray-200 flex gap-2">
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-3 py-1.5 text-xs rounded-t ${activeTab === 'agents' ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Agent ({agents.length})
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            className={`px-3 py-1.5 text-xs rounded-t ${activeTab === 'requirements' ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            需求 ({requirements.length})
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'agents' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500">项目专属 Agent</p>
                <button
                  onClick={() => refetchAgents()}
                  className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />刷新
                </button>
              </div>
              {agentsLoading ? (
                <p className="text-sm text-gray-500">加载中...</p>
              ) : agents.length === 0 ? (
                <p className="text-sm text-gray-400">暂无项目 Agent，请在 Agent 管理页创建并关联此项目。</p>
              ) : (
                <div className="space-y-2">
                  {agents.map((agent: any) => (
                    <div key={agent.id || agent._id} className="border border-gray-200 rounded p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                          {agent.tier === 'leadership' && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">负责人</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${agent.isActive ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                            {agent.isActive ? '活跃' : '停用'}
                          </span>
                        </div>
                        <Link
                          to={`/agents/${agent.id || agent._id}`}
                          className="text-xs text-primary-600 hover:underline"
                        >
                          查看详情
                        </Link>
                      </div>
                      {agent.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{agent.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'requirements' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500">项目关联需求</p>
                <button
                  onClick={() => refetchRequirements()}
                  className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />刷新
                </button>
              </div>
              {requirementsLoading ? (
                <p className="text-sm text-gray-500">加载中...</p>
              ) : requirements.length === 0 ? (
                <p className="text-sm text-gray-400">暂无项目需求，请在需求管理页创建并关联此项目。</p>
              ) : (
                <div className="space-y-2">
                  {requirements.map((req: any) => {
                    const reqId = req.requirementId || req._id;
                    return (
                      <div key={reqId} className="border border-gray-200 rounded p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{req.title}</p>
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{req.status}</span>
                            {req.priority && (
                              <span className="text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">{req.priority}</span>
                            )}
                          </div>
                          <Link
                            to={`/ei/requirements/${reqId}`}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            查看
                          </Link>
                        </div>
                        {req.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{req.description}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---- Stat card component ----
function StatCard({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value?: number; loading?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-semibold text-gray-900">{loading ? '-' : (value ?? 0)}</p>
      </div>
    </div>
  );
}

export default IncubationProjectDetail;
