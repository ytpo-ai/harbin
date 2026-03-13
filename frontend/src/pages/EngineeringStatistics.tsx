import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { engineeringIntelligenceService } from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';
import { schedulerService } from '../services/schedulerService';

function formatBytes(value?: number): string {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let num = bytes / 1024;
  let idx = 0;
  while (num >= 1024 && idx < units.length - 1) {
    num /= 1024;
    idx += 1;
  }
  return `${num.toFixed(2)} ${units[idx]}`;
}

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleString();
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${mins}m ${rest}s`;
}

type SnapshotStatusFilter = 'all' | 'running' | 'success' | 'failed';
type SnapshotDrawerTab = 'summary' | 'projects' | 'errors';

function statusMeta(status?: 'running' | 'success' | 'failed') {
  if (status === 'success') {
    return { label: '成功', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  }
  if (status === 'failed') {
    return { label: '失败', className: 'text-rose-700 bg-rose-50 border-rose-200' };
  }
  return { label: '统计中', className: 'text-amber-700 bg-amber-50 border-amber-200' };
}

function scopeLabel(scope?: 'all' | 'docs' | 'frontend' | 'backend') {
  if (scope === 'docs') return '仅 Docs';
  if (scope === 'frontend') return '仅前端';
  if (scope === 'backend') return '仅后端';
  return '全量';
}

function tokenModeLabel(mode?: 'estimate' | 'exact') {
  return mode === 'exact' ? '精算' : '估算';
}

const EngineeringStatistics: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const snapshotId = (searchParams.get('snapshotId') || '').trim();
  const [statusFilter, setStatusFilter] = React.useState<SnapshotStatusFilter>('all');
  const [limit, setLimit] = React.useState(50);
  const [page, setPage] = React.useState(1);
  const [drawerTab, setDrawerTab] = React.useState<SnapshotDrawerTab>('summary');

  const PAGE_SIZE = 10;

  const { data: latest, refetch: refetchLatest } = useQuery(
    'ei-statistics-latest',
    () => engineeringIntelligenceService.getLatestStatisticsSnapshot(),
    { retry: false },
  );

  const {
    data: history = [],
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery(
    ['ei-statistics-history', limit],
    () => engineeringIntelligenceService.listStatisticsSnapshots(limit),
    {
      retry: false,
      refetchInterval: (rows) => (rows?.some((item) => item.status === 'running') ? 5000 : false),
    },
  );

  const {
    data: selectedSnapshot,
    isLoading: selectedLoading,
    isError: selectedError,
    refetch: refetchSelected,
  } = useQuery(
    ['ei-statistics-selected', snapshotId],
    () => engineeringIntelligenceService.getStatisticsSnapshotById(snapshotId),
    {
      enabled: Boolean(snapshotId),
      retry: false,
      refetchInterval: (snapshot) => (snapshot?.status === 'running' ? 5000 : false),
    },
  );

  const runMutation = useMutation(
    async () => {
      const currentUser = await authService.getCurrentUser();
      return schedulerService.triggerSystemEngineeringStatistics({
        receiverId: currentUser?.id,
      });
    },
    {
      onSuccess: () => {
        setTimeout(() => {
          queryClient.invalidateQueries('ei-statistics-latest');
          queryClient.invalidateQueries('ei-statistics-history');
        }, 1200);
      },
    },
  );

  const filteredHistory = React.useMemo(() => {
    if (statusFilter === 'all') return history;
    return history.filter((item) => item.status === statusFilter);
  }, [history, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, limit]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  React.useEffect(() => {
    if (snapshotId) {
      setDrawerTab('summary');
    }
  }, [snapshotId]);

  const pagedHistory = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredHistory.slice(start, start + PAGE_SIZE);
  }, [filteredHistory, page]);

  const latestSummary = latest?.summary;
  const detailSnapshot = selectedSnapshot || history.find((item) => item.snapshotId === snapshotId) || null;
  const projectErrors = (detailSnapshot?.projects || [])
    .map((project) => project.error)
    .filter((error): error is string => Boolean(error));
  const errorMessages = Array.from(new Set([...(detailSnapshot?.errors || []), ...projectErrors]));

  const openSnapshot = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('snapshotId', id);
    setSearchParams(params);
  };

  const closeDrawer = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('snapshotId');
    setSearchParams(params);
  };

  const refreshAll = () => {
    refetchLatest();
    refetchHistory();
    if (snapshotId) {
      refetchSelected();
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">工程统计</h1>
            <p className="mt-1 text-sm text-gray-600">统计 docs、frontend、backend 项目数据，并生成汇总快照。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              刷新
            </button>
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isLoading}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:bg-gray-300"
            >
              <ChartBarIcon className="h-4 w-4" />
              {runMutation.isLoading ? '统计中...' : '统计'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">最近统计状态</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{latest ? statusMeta(latest.status).label : '暂无'}</p>
          <p className="mt-1 text-xs text-gray-500">{latest ? formatDateTime(latest.completedAt || latest.startedAt) : '-'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Docs 字节数</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(latestSummary?.totalDocsBytes)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Docs Token</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{latestSummary?.totalDocsTokens || 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">前端字节数</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(latestSummary?.totalFrontendBytes)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">总字节数</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(latestSummary?.grandTotalBytes)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-semibold">历史统计列表</p>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as SnapshotStatusFilter)}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value="all">全部状态</option>
              <option value="running">统计中</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
            >
              <option value={20}>拉取 20 条</option>
              <option value={50}>拉取 50 条</option>
              <option value={100}>拉取 100 条</option>
            </select>
            <ClockIcon className="h-4 w-4 text-gray-500" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">统计时间</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">状态</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">范围</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Token 模式</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">项目数</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">总字节</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">触发人</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">耗时</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-500" colSpan={9}>加载中...</td>
                </tr>
              ) : historyError ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-rose-600" colSpan={9}>
                    历史记录加载失败。
                    <button
                      type="button"
                      onClick={() => refetchHistory()}
                      className="ml-2 inline-flex items-center rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                    >
                      重试
                    </button>
                  </td>
                </tr>
              ) : pagedHistory.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-400" colSpan={9}>暂无历史记录</td>
                </tr>
              ) : (
                pagedHistory.map((item) => {
                  const meta = statusMeta(item.status);
                  return (
                  <tr key={item.snapshotId} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs text-gray-800">{formatDateTime(item.completedAt || item.startedAt)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${meta.className}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{scopeLabel(item.scope)}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{tokenModeLabel(item.tokenMode)}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{item.summary?.projectCount || 0}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{formatBytes(item.summary?.grandTotalBytes)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{item.triggeredBy || '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{formatDuration(item.startedAt, item.completedAt)}</td>
                    <td className="px-3 py-2 text-xs text-right">
                      <button
                        type="button"
                        onClick={() => openSnapshot(item.snapshotId)}
                        className="inline-flex items-center rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                      >
                        查看快照
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2">
          <p className="text-xs text-gray-500">
            共 {filteredHistory.length} 条，当前第 {page} / {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {snapshotId && (
        <div className="fixed inset-0 z-40">
          <button className="absolute inset-0 bg-black/30" onClick={closeDrawer} aria-label="关闭快照详情抽屉" />
          <aside className="absolute right-0 top-0 h-full w-full overflow-y-auto border-l border-gray-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[60vw]">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">快照详情</p>
                <p className="mt-0.5 text-xs text-gray-500">{snapshotId}</p>
              </div>
              <button onClick={closeDrawer} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="关闭抽屉">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-gray-200 px-4 py-2">
              <div className="inline-flex gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerTab('summary')}
                  className={`rounded px-3 py-1.5 text-xs ${drawerTab === 'summary' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  汇总
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('projects')}
                  className={`rounded px-3 py-1.5 text-xs ${drawerTab === 'projects' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  项目明细
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('errors')}
                  className={`rounded px-3 py-1.5 text-xs ${drawerTab === 'errors' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  异常信息
                </button>
              </div>
            </div>

            <div className="space-y-3 p-4">
              {selectedLoading ? (
                <p className="text-sm text-gray-500">快照加载中...</p>
              ) : selectedError ? (
                <div className="rounded border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm text-rose-700">快照详情加载失败，请重试。</p>
                  <button
                    type="button"
                    onClick={() => refetchSelected()}
                    className="mt-2 rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                  >
                    重新加载
                  </button>
                </div>
              ) : !detailSnapshot ? (
                <p className="text-sm text-gray-500">未找到快照数据。</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${statusMeta(detailSnapshot.status).className}`}>
                      {statusMeta(detailSnapshot.status).label}
                    </span>
                    <span className="text-xs text-gray-500">范围：{scopeLabel(detailSnapshot.scope)}</span>
                    <span className="text-xs text-gray-500">Token：{tokenModeLabel(detailSnapshot.tokenMode)}</span>
                    <span className="text-xs text-gray-500">开始：{formatDateTime(detailSnapshot.startedAt)}</span>
                    <span className="text-xs text-gray-500">完成：{formatDateTime(detailSnapshot.completedAt)}</span>
                  </div>

                  {drawerTab === 'summary' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">总项目数</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">{detailSnapshot.summary?.projectCount || 0}</p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">成功/失败</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">
                            {detailSnapshot.summary?.successCount || 0} / {detailSnapshot.summary?.failureCount || 0}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">后端字节数</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">{formatBytes(detailSnapshot.summary?.totalBackendBytes)}</p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">总字节数</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">{formatBytes(detailSnapshot.summary?.grandTotalBytes)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">Docs 字节</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{formatBytes(detailSnapshot.summary?.totalDocsBytes)}</p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">前端字节</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{formatBytes(detailSnapshot.summary?.totalFrontendBytes)}</p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">Docs Token</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">{detailSnapshot.summary?.totalDocsTokens || 0}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {drawerTab === 'projects' && (
                    <div className="overflow-x-auto rounded border border-gray-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">项目</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">类型</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">路径</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">文件数</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">字节</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">行数</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Token</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailSnapshot.projects || []).length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-xs text-gray-400" colSpan={8}>暂无项目明细</td>
                            </tr>
                          ) : (
                            (detailSnapshot.projects || []).map((project) => (
                              <tr key={`${project.projectId}-${project.metricType}-${project.rootPath}`} className="border-t border-gray-100">
                                <td className="px-3 py-2 text-xs text-gray-800">{project.projectName}</td>
                                <td className="px-3 py-2 text-xs text-gray-700">{project.metricType}</td>
                                <td className="px-3 py-2 text-xs text-gray-500">{project.rootPath}</td>
                                <td className="px-3 py-2 text-xs text-right text-gray-800">{project.fileCount}</td>
                                <td className="px-3 py-2 text-xs text-right text-gray-800">{formatBytes(project.bytes)}</td>
                                <td className="px-3 py-2 text-xs text-right text-gray-800">{project.lines}</td>
                                <td className="px-3 py-2 text-xs text-right text-gray-800">{project.tokens || 0}</td>
                                <td className="px-3 py-2 text-xs">
                                  {project.error ? (
                                    <span className="inline-flex items-center gap-1 text-rose-600">
                                      <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                                      失败
                                    </span>
                                  ) : (
                                    <span className="text-emerald-600">成功</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {drawerTab === 'errors' && (
                    <div className="rounded border border-gray-200 p-3">
                      {errorMessages.length === 0 ? (
                        <p className="text-sm text-gray-500">当前快照无异常信息。</p>
                      ) : (
                        <div className="space-y-2">
                          {errorMessages.map((error, index) => (
                            <div key={`${index}-${error}`} className="rounded border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                              {error}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default EngineeringStatistics;
