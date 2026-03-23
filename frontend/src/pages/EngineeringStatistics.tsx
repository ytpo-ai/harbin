import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  FireIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { engineeringIntelligenceService } from '../services/engineeringIntelligenceService';
import type {
  DocsHeatConfig,
  DocsHeatWindow,
} from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';
import { schedulerService } from '../services/schedulerService';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

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
type StatisticsTab = 'projectStats' | 'docsHeat';

const LARGE_FILE_LINE_THRESHOLD = 1500;
const LARGE_FILE_WARNING_EXCLUDED_EXTENSIONS = ['.json', '.yml', '.yaml', '.md'];

type LargeFileWarningRow = {
  metricType: 'docs' | 'frontend' | 'backend';
  projectId: string;
  projectName: string;
  rootPath: string;
  filePath: string;
  lines: number;
  bytes: number;
};

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

function moduleLabelByProject(project: {
  metricType: 'docs' | 'frontend' | 'backend';
  projectId: string;
  rootPath: string;
  projectName: string;
  filePath: string;
}): string {
  const normalizedFilePath = (project.filePath || '').replace(/^\/+/, '');
  if (normalizedFilePath.startsWith('docs/')) return 'Docs';
  if (normalizedFilePath.startsWith('frontend/')) return 'Frontend';
  if (normalizedFilePath.startsWith('backend/src/')) return 'Backend (src)';
  if (normalizedFilePath.startsWith('backend/apps/')) {
    const appName = normalizedFilePath.replace('backend/apps/', '').split('/')[0] || 'app';
    return `Backend (${appName})`;
  }

  if (project.metricType === 'docs') return 'Docs';
  if (project.metricType === 'frontend') return 'Frontend';
  if (project.projectId === 'workspace-backend') return 'Backend (src)';
  if (project.rootPath.startsWith('backend/apps/')) {
    return `Backend (${project.rootPath.replace('backend/apps/', '')})`;
  }
  return project.projectName || 'Backend';
}

const EngineeringStatistics: React.FC = () => {
  const queryClient = useQueryClient();
  const { toast, showToast, clearToast } = useToast(4000);
  const [searchParams, setSearchParams] = useSearchParams();
  const snapshotId = (searchParams.get('snapshotId') || '').trim();
  const [activeTab, setActiveTab] = React.useState<StatisticsTab>('projectStats');

  const [statusFilter, setStatusFilter] = React.useState<SnapshotStatusFilter>('all');
  const [limit, setLimit] = React.useState(50);
  const [page, setPage] = React.useState(1);
  const [drawerTab, setDrawerTab] = React.useState<SnapshotDrawerTab>('summary');

  const [expandedProjectKey, setExpandedProjectKey] = React.useState<string | null>(null);
  const [docsWindow, setDocsWindow] = React.useState<DocsHeatWindow>('1d');
  const [docsTopN, setDocsTopN] = React.useState(20);
  const [showConfigModal, setShowConfigModal] = React.useState(false);
  const [draftConfig, setDraftConfig] = React.useState<DocsHeatConfig | null>(null);
  const [showLargeFileModal, setShowLargeFileModal] = React.useState(false);

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

  const { data: docsHeatLatest, refetch: refetchDocsHeatLatest } = useQuery(
    'ei-docs-heat-latest',
    () => engineeringIntelligenceService.getDocsHeatLatest(),
    { retry: false, refetchInterval: 5000 },
  );

  const { data: docsHeatConfigResponse, refetch: refetchDocsHeatConfig } = useQuery(
    'ei-docs-heat-config',
    () => engineeringIntelligenceService.getEiConfig('docsHeat'),
    { retry: false },
  );

  const { data: docsHeatRanking, isLoading: docsHeatLoading, refetch: refetchDocsHeatRanking } = useQuery(
    ['ei-docs-heat-ranking', docsWindow, docsTopN],
    () => engineeringIntelligenceService.getDocsHeatRanking(docsWindow, docsTopN),
    {
      retry: false,
      keepPreviousData: true,
    },
  );

  React.useEffect(() => {
    if (docsHeatConfigResponse?.docsHeat?.topN && Number.isFinite(Number(docsHeatConfigResponse.docsHeat.topN))) {
      setDocsTopN(Math.max(1, Math.floor(Number(docsHeatConfigResponse.docsHeat.topN))));
    }
  }, [docsHeatConfigResponse?.docsHeat?.topN]);

  React.useEffect(() => {
    if (docsHeatConfigResponse?.docsHeat && !showConfigModal) {
      setDraftConfig(docsHeatConfigResponse.docsHeat);
    }
  }, [docsHeatConfigResponse?.docsHeat, showConfigModal]);

  const runMutation = useMutation(
    async () => {
      const currentUser = await authService.getCurrentUser();
      return schedulerService.triggerSystemEngineeringStatistics({
        receiverId: currentUser?.id,
      });
    },
    {
      onSuccess: () => {
        showToast('success', '工程统计任务已触发，请稍候查看结果');
        setTimeout(() => {
          queryClient.invalidateQueries('ei-statistics-latest');
          queryClient.invalidateQueries('ei-statistics-history');
        }, 1200);
      },
      onError: (error: any) => {
        const candidates = [
          error?.response?.data?.message,
          error?.response?.data?.error,
          error?.message,
        ];
        const message = candidates.find((item) => typeof item === 'string' && item.trim()) || '统计触发失败，请稍后重试';
        showToast('error', String(message));
      },
    },
  );

  const runDocsHeatMutation = useMutation(
    async () => {
      return schedulerService.triggerSystemDocsHeat({
        topN: docsTopN,
        triggeredBy: 'frontend-button',
      });
    },
    {
      onSuccess: () => {
        showToast('success', '文档热度统计任务已触发');
        setTimeout(() => {
          queryClient.invalidateQueries('ei-docs-heat-latest');
          queryClient.invalidateQueries('ei-docs-heat-ranking');
        }, 1200);
      },
      onError: (error: any) => {
        const candidates = [
          error?.response?.data?.message,
          error?.response?.data?.error,
          error?.message,
        ];
        const message = candidates.find((item) => typeof item === 'string' && item.trim()) || '触发文档热度统计失败，请稍后重试';
        showToast('error', String(message));
      },
    },
  );

  const saveDocsHeatConfigMutation = useMutation(
    async (payload: DocsHeatConfig) => {
      const currentUser = await authService.getCurrentUser();
      return engineeringIntelligenceService.updateDocsHeatConfig({
        weights: payload.weights,
        excludes: payload.excludes,
        defaultWeight: payload.defaultWeight,
        topN: payload.topN,
        updatedBy: currentUser?.name || currentUser?.id || 'frontend-user',
      });
    },
    {
      onSuccess: () => {
        showToast('success', '文档热度权重配置已保存');
        setShowConfigModal(false);
        queryClient.invalidateQueries('ei-docs-heat-config');
        queryClient.invalidateQueries('ei-docs-heat-ranking');
      },
      onError: (error: any) => {
        const candidates = [
          error?.response?.data?.message,
          error?.response?.data?.error,
          error?.message,
        ];
        const message = candidates.find((item) => typeof item === 'string' && item.trim()) || '保存文档热度配置失败，请稍后重试';
        showToast('error', String(message));
      },
    },
  );

  const filteredHistory = React.useMemo(() => {
    if (statusFilter === 'all') return history;
    return history.filter((item) => item.status === statusFilter);
  }, [history, statusFilter]);

  const latestLargeFiles = React.useMemo<LargeFileWarningRow[]>(() => {
    const rows: LargeFileWarningRow[] = [];
    (latest?.projects || []).forEach((project) => {
      (project.topLineFiles || []).forEach((file) => {
        const normalizedPath = file.filePath.toLowerCase();
        const shouldExclude = LARGE_FILE_WARNING_EXCLUDED_EXTENSIONS.some((ext) => normalizedPath.endsWith(ext));
        if (file.lines >= LARGE_FILE_LINE_THRESHOLD && !shouldExclude) {
          rows.push({
            metricType: project.metricType,
            projectId: project.projectId,
            projectName: project.projectName,
            rootPath: project.rootPath,
            filePath: file.filePath,
            lines: file.lines,
            bytes: file.bytes,
          });
        }
      });
    });
    return rows.sort((a, b) => {
      if (b.lines !== a.lines) return b.lines - a.lines;
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.filePath.localeCompare(b.filePath);
    });
  }, [latest?.projects]);

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

  const refreshDocsHeat = () => {
    refetchDocsHeatLatest();
    refetchDocsHeatRanking();
    refetchDocsHeatConfig();
  };

  const docsHeatStatusMeta = statusMeta(docsHeatLatest?.status);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">工程统计</h1>
            <p className="mt-1 text-sm text-gray-600">
              {activeTab === 'projectStats'
                ? '统计 docs、frontend、backend 项目数据，并生成汇总快照。'
                : '统计 docs 文档写入频率与热度排名，识别近期研发热点。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'docsHeat' && (
              <button
                type="button"
                onClick={() => setShowConfigModal(true)}
                className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
              >
                <Cog6ToothIcon className="h-4 w-4" />
                权重配置
              </button>
            )}
            <button
              onClick={activeTab === 'projectStats' ? refreshAll : refreshDocsHeat}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              刷新
            </button>
            {activeTab === 'projectStats' ? (
              <button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isLoading}
                className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:bg-gray-300"
              >
                <ChartBarIcon className="h-4 w-4" />
                {runMutation.isLoading ? '统计中...' : '统计'}
              </button>
            ) : (
              <button
                onClick={() => runDocsHeatMutation.mutate()}
                disabled={runDocsHeatMutation.isLoading}
                className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:bg-gray-300"
              >
                <FireIcon className="h-4 w-4" />
                {runDocsHeatMutation.isLoading ? '触发中...' : '触发统计'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 inline-flex rounded border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('projectStats')}
            className={`rounded px-3 py-1.5 text-xs ${activeTab === 'projectStats' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            工程规模统计
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('docsHeat')}
            className={`rounded px-3 py-1.5 text-xs ${activeTab === 'docsHeat' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            文档热度
          </button>
        </div>
      </div>

      {activeTab === 'projectStats' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden h-full flex flex-col">
              <div className="p-3 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">最近统计</p>
                  <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${latest ? statusMeta(latest.status).className : 'text-gray-500 bg-gray-50 border-gray-200'}`}>
                    {latest ? statusMeta(latest.status).label : '暂无'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{latest ? formatDateTime(latest.completedAt || latest.startedAt) : '-'}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[11px] text-gray-400">项目数</p>
                    <p className="text-sm font-semibold text-gray-900">{latestSummary?.projectCount || 0}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400">Docs Token</p>
                    <p className="text-sm font-semibold text-gray-900">{(latestSummary?.totalDocsTokens || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400">总字节数</p>
                    <p className="text-sm font-semibold text-gray-900">{formatBytes(latestSummary?.grandTotalBytes)}</p>
                  </div>
                </div>
              </div>
              {latestLargeFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLargeFileModal(true)}
                  className="w-full border-t border-rose-200 bg-rose-50 px-3 py-2 text-left hover:bg-rose-100/80"
                >
                  <span className="inline-flex items-center gap-1 text-xs text-rose-700">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    有 {latestLargeFiles.length} 个代码文件超过 {LARGE_FILE_LINE_THRESHOLD} 行，建议优化
                  </span>
                </button>
              )}
            </div>

            {(() => {
              const backendApps = (latest?.projects || []).filter(
                (p) => p.metricType === 'backend' && p.projectId !== 'workspace-backend',
              );
              const boards: Array<{
                label: string;
                fileCount: number;
                lines: number;
                bytes: number;
              }> = [
                {
                  label: 'Docs',
                  fileCount: latestSummary?.totalDocsFileCount || 0,
                  lines: latestSummary?.totalDocsLines || 0,
                  bytes: latestSummary?.totalDocsBytes || 0,
                },
                {
                  label: 'Frontend',
                  fileCount: latestSummary?.totalFrontendFileCount || 0,
                  lines: latestSummary?.totalFrontendLines || 0,
                  bytes: latestSummary?.totalFrontendBytes || 0,
                },
                {
                  label: 'Backend (src)',
                  fileCount: (latest?.projects || []).find((p) => p.projectId === 'workspace-backend')?.fileCount || 0,
                  lines: (latest?.projects || []).find((p) => p.projectId === 'workspace-backend')?.lines || 0,
                  bytes: (latest?.projects || []).find((p) => p.projectId === 'workspace-backend')?.bytes || 0,
                },
                ...backendApps.map((app) => ({
                  label: `Backend (${app.rootPath.replace('backend/apps/', '')})`,
                  fileCount: app.fileCount,
                  lines: app.lines,
                  bytes: app.bytes,
                })),
              ];

              return (
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">工程规模 Board</p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="pb-1.5 text-left font-semibold text-gray-500">模块</th>
                          <th className="pb-1.5 text-right font-semibold text-gray-500">文件数</th>
                          <th className="pb-1.5 text-right font-semibold text-gray-500">代码行数</th>
                          <th className="pb-1.5 text-right font-semibold text-gray-500">字节数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boards.map((board) => (
                          <tr key={board.label} className="border-b border-gray-50">
                            <td className="py-1.5 text-gray-800 font-medium">{board.label}</td>
                            <td className="py-1.5 text-right text-gray-700">{board.fileCount.toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-700">{board.lines.toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-700">{formatBytes(board.bytes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
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
        </>
      )}

      {activeTab === 'docsHeat' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">最近统计状态</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{docsHeatLatest ? docsHeatStatusMeta.label : '暂无'}</p>
              <p className="mt-1 text-xs text-gray-500">{formatDateTime(docsHeatLatest?.completedAt || docsHeatLatest?.startedAt)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">当前窗口</p>
              <div className="mt-1 inline-flex gap-2">
                {(['8h', '1d', '7d'] as DocsHeatWindow[]).map((window) => (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setDocsWindow(window)}
                    className={`rounded px-2.5 py-1 text-xs border ${docsWindow === window ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {window.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500">默认 TopN</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{docsTopN}</p>
              <p className="mt-1 text-xs text-gray-500">来源：{docsHeatRanking?.source || '-'}</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold">文档热度排行</p>
              <div className="text-xs text-gray-500">窗口 {docsWindow.toUpperCase()} / Top {docsTopN}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">排名</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">文档路径</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">写入次数</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">写入频率</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">最近更新时间</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">权重</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">热度分</th>
                  </tr>
                </thead>
                <tbody>
                  {docsHeatLoading ? (
                    <tr>
                      <td className="px-3 py-3 text-xs text-gray-500" colSpan={7}>加载中...</td>
                    </tr>
                  ) : (docsHeatRanking?.ranking || []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-xs text-gray-400" colSpan={7}>暂无热度数据</td>
                    </tr>
                  ) : (
                    (docsHeatRanking?.ranking || []).map((item) => (
                      <tr
                        key={`${item.path}-${item.rank}`}
                        className={`border-t border-gray-100 ${item.rank <= 3 ? 'bg-amber-50/40' : ''}`}
                      >
                        <td className="px-3 py-2 text-xs text-gray-900 font-semibold">#{item.rank}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{item.path}</td>
                        <td className="px-3 py-2 text-xs text-right text-gray-800">{item.writeCount}</td>
                        <td className="px-3 py-2 text-xs text-right text-gray-800">{item.writeFreq.toFixed(4)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{formatDateTime(item.lastWrittenAt)}</td>
                        <td className="px-3 py-2 text-xs text-right text-gray-800">{item.weight.toFixed(2)}</td>
                        <td className="px-3 py-2 text-xs text-right text-gray-900 font-semibold">{item.heatScore.toFixed(4)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {snapshotId && activeTab === 'projectStats' && (
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
                          <p className="text-xs text-gray-500">Docs Token</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">{(detailSnapshot.summary?.totalDocsTokens || 0).toLocaleString()}</p>
                        </div>
                        <div className="rounded border border-gray-200 p-3">
                          <p className="text-xs text-gray-500">总字节数</p>
                          <p className="mt-1 text-base font-semibold text-gray-900">{formatBytes(detailSnapshot.summary?.grandTotalBytes)}</p>
                        </div>
                      </div>

                      <div className="rounded border border-gray-200 overflow-hidden">
                        <p className="px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">分模块汇总</p>
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="px-3 py-1.5 text-left font-semibold text-gray-500">模块</th>
                              <th className="px-3 py-1.5 text-right font-semibold text-gray-500">文件数</th>
                              <th className="px-3 py-1.5 text-right font-semibold text-gray-500">代码行数</th>
                              <th className="px-3 py-1.5 text-right font-semibold text-gray-500">字节数</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-gray-50">
                              <td className="px-3 py-1.5 text-gray-800 font-medium">Docs</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalDocsFileCount || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalDocsLines || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{formatBytes(detailSnapshot.summary?.totalDocsBytes)}</td>
                            </tr>
                            <tr className="border-t border-gray-50">
                              <td className="px-3 py-1.5 text-gray-800 font-medium">Frontend</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalFrontendFileCount || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalFrontendLines || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{formatBytes(detailSnapshot.summary?.totalFrontendBytes)}</td>
                            </tr>
                            <tr className="border-t border-gray-50">
                              <td className="px-3 py-1.5 text-gray-800 font-medium">Backend</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalBackendFileCount || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{(detailSnapshot.summary?.totalBackendLines || 0).toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{formatBytes(detailSnapshot.summary?.totalBackendBytes)}</td>
                            </tr>
                          </tbody>
                        </table>
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
                            (detailSnapshot.projects || []).map((project) => {
                              const projectKey = `${project.projectId}-${project.metricType}-${project.rootPath}`;
                              const hasTopFiles = (project.topLineFiles || []).length > 0;
                              const isExpanded = expandedProjectKey === projectKey;
                              return (
                                <React.Fragment key={projectKey}>
                                  <tr
                                    className={`border-t border-gray-100 ${hasTopFiles ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                                    onClick={() => {
                                      if (hasTopFiles) {
                                        setExpandedProjectKey(isExpanded ? null : projectKey);
                                      }
                                    }}
                                  >
                                    <td className="px-3 py-2 text-xs text-gray-800">
                                      {hasTopFiles && (
                                        <span className="inline-block w-4 text-gray-400 mr-1">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                                      )}
                                      {project.projectName}
                                    </td>
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
                                  {isExpanded && (
                                    <tr>
                                      <td colSpan={8} className="px-3 py-0">
                                        <div className="ml-5 my-2 rounded border border-gray-100 bg-gray-50/60">
                                          <p className="px-3 py-1.5 text-[11px] font-semibold text-gray-500 border-b border-gray-100">
                                            大文件行数 Top {project.topLineFiles?.length || 0}
                                          </p>
                                          <table className="min-w-full text-xs">
                                            <thead>
                                              <tr className="border-b border-gray-100">
                                                <th className="px-3 py-1 text-left text-[11px] font-semibold text-gray-400">#</th>
                                                <th className="px-3 py-1 text-left text-[11px] font-semibold text-gray-400">文件路径</th>
                                                <th className="px-3 py-1 text-right text-[11px] font-semibold text-gray-400">行数</th>
                                                <th className="px-3 py-1 text-right text-[11px] font-semibold text-gray-400">字节</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {(project.topLineFiles || []).map((file, fileIndex) => (
                                                <tr key={file.filePath} className="border-t border-gray-50">
                                                  <td className="px-3 py-1 text-[11px] text-gray-500">{fileIndex + 1}</td>
                                                  <td className="px-3 py-1 text-[11px] text-gray-700 font-mono">{file.filePath}</td>
                                                  <td className="px-3 py-1 text-[11px] text-right text-gray-800 font-semibold">{file.lines.toLocaleString()}</td>
                                                  <td className="px-3 py-1 text-[11px] text-right text-gray-600">{formatBytes(file.bytes)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })
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

      {showConfigModal && draftConfig && (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/30" onClick={() => setShowConfigModal(false)} aria-label="关闭配置弹窗" />
          <div className="absolute right-0 top-0 h-full w-full overflow-y-auto border-l border-gray-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[52vw]">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">文档热度权重配置</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  上次修改：{formatDateTime(draftConfig.updatedAt)} / {draftConfig.updatedBy || '-'}
                </p>
              </div>
              <button onClick={() => setShowConfigModal(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="关闭抽屉">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-700">权重规则</p>
                <div className="mt-3 space-y-2">
                  {draftConfig.weights.map((item, index) => (
                    <div key={`${index}-${item.pattern}`} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        value={item.pattern}
                        onChange={(event) => {
                          const next = [...draftConfig.weights];
                          next[index] = { ...next[index], pattern: event.target.value };
                          setDraftConfig({ ...draftConfig, weights: next });
                        }}
                        className="col-span-5 rounded border border-gray-300 px-2 py-1 text-xs"
                        placeholder="docs/**"
                      />
                      <input
                        value={item.label || ''}
                        onChange={(event) => {
                          const next = [...draftConfig.weights];
                          next[index] = { ...next[index], label: event.target.value };
                          setDraftConfig({ ...draftConfig, weights: next });
                        }}
                        className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs"
                        placeholder="标签"
                      />
                      <input
                        type="number"
                        min={0.1}
                        max={3}
                        step={0.1}
                        value={item.weight}
                        onChange={(event) => {
                          const next = [...draftConfig.weights];
                          next[index] = { ...next[index], weight: Number(event.target.value || 1) };
                          setDraftConfig({ ...draftConfig, weights: next });
                        }}
                        className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draftConfig.weights.filter((_, rowIndex) => rowIndex !== index);
                          setDraftConfig({ ...draftConfig, weights: next });
                        }}
                        className="col-span-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        删
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setDraftConfig({
                        ...draftConfig,
                        weights: [...draftConfig.weights, { pattern: 'docs/**', weight: 1.0, label: '新规则' }],
                      });
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    新增规则
                  </button>
                </div>
              </div>

              <div className="rounded border border-gray-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-700">排除路径</p>
                <textarea
                  value={draftConfig.excludes.join('\n')}
                  onChange={(event) => {
                    setDraftConfig({
                      ...draftConfig,
                      excludes: event.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    });
                  }}
                  className="w-full rounded border border-gray-300 px-2 py-2 text-xs"
                  rows={4}
                  placeholder={'docs/archive/**\ndocs/tmp/**'}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-600">默认权重</p>
                  <input
                    type="number"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={draftConfig.defaultWeight}
                    onChange={(event) => setDraftConfig({ ...draftConfig, defaultWeight: Number(event.target.value || 1) })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-600">默认 TopN</p>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={draftConfig.topN}
                    onChange={(event) => setDraftConfig({ ...draftConfig, topN: Math.max(1, Number(event.target.value || 20)) })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => saveDocsHeatConfigMutation.mutate(draftConfig)}
                disabled={saveDocsHeatConfigMutation.isLoading}
                className="rounded bg-primary-600 px-3 py-1.5 text-xs text-white disabled:bg-gray-300"
              >
                {saveDocsHeatConfigMutation.isLoading ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLargeFileModal && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowLargeFileModal(false)}
            aria-label="关闭大文件警告弹窗"
          />
          <div className="absolute left-1/2 top-1/2 w-[96vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">大文件警告 - 超过 {LARGE_FILE_LINE_THRESHOLD} 行</p>
                <p className="mt-0.5 text-xs text-gray-500">共 {latestLargeFiles.length} 个文件</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLargeFileModal(false)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="关闭弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">所属模块</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">文件路径</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">行数</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">字节数</th>
                  </tr>
                </thead>
                <tbody>
                  {latestLargeFiles.map((file, index) => (
                    <tr key={`${file.projectId}-${file.filePath}`} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                      <td className="px-3 py-2 text-gray-700">{moduleLabelByProject(file)}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{file.filePath}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">{file.lines.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatBytes(file.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end border-t border-gray-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowLargeFileModal(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {toast ? <Toast toast={toast} onClose={clearToast} /> : null}
    </div>
  );
};

export default EngineeringStatistics;
