import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { engineeringIntelligenceService } from '../services/engineeringIntelligenceService';
import { authService } from '../services/authService';

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

const EngineeringStatistics: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const snapshotId = (searchParams.get('snapshotId') || '').trim();

  const { data: latest, isLoading: latestLoading, refetch: refetchLatest } = useQuery(
    'ei-statistics-latest',
    () => engineeringIntelligenceService.getLatestStatisticsSnapshot(),
    { retry: false },
  );

  const { data: history = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery(
    'ei-statistics-history',
    () => engineeringIntelligenceService.listStatisticsSnapshots(20),
    { retry: false },
  );

  const { data: selectedSnapshot, isLoading: selectedLoading } = useQuery(
    ['ei-statistics-selected', snapshotId],
    () => engineeringIntelligenceService.getStatisticsSnapshotById(snapshotId),
    {
      enabled: Boolean(snapshotId),
      retry: false,
    },
  );

  const runMutation = useMutation(
    async () => {
      const currentUser = await authService.getCurrentUser();
      return engineeringIntelligenceService.createStatisticsSnapshot({
        scope: 'all',
        tokenMode: 'estimate',
        triggeredBy: 'frontend',
        receiverId: currentUser?.id,
      });
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('ei-statistics-latest');
        queryClient.invalidateQueries('ei-statistics-history');
      },
    },
  );

  const displaySnapshot = selectedSnapshot || latest;
  const summary = displaySnapshot?.summary;

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
              onClick={() => {
                refetchLatest();
                refetchHistory();
              }}
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
          <p className="text-xs text-gray-500">Docs Bytes</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(summary?.totalDocsBytes)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Docs Tokens</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{summary?.totalDocsTokens || 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Frontend Bytes</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(summary?.totalFrontendBytes)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Backend Bytes</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(summary?.totalBackendBytes)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Total Bytes</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatBytes(summary?.grandTotalBytes)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-semibold">项目统计明细</p>
          <p className="text-xs text-gray-500">
            {displaySnapshot?.completedAt ? `最近完成: ${new Date(displaySnapshot.completedAt).toLocaleString()}` : '暂无统计'}
          </p>
        </div>
        <div className="overflow-x-auto">
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
              {latestLoading || selectedLoading ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-500" colSpan={8}>加载中...</td>
                </tr>
              ) : (displaySnapshot?.projects || []).length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-gray-400" colSpan={8}>暂无数据</td>
                </tr>
              ) : (
                (displaySnapshot?.projects || []).map((item) => (
                  <tr key={`${item.projectId}-${item.metricType}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs text-gray-800">{item.projectName}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{item.metricType}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{item.rootPath}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{item.fileCount}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{formatBytes(item.bytes)}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{item.lines}</td>
                    <td className="px-3 py-2 text-xs text-right text-gray-800">{item.tokens || 0}</td>
                    <td className="px-3 py-2 text-xs">
                      {item.error ? (
                        <span className="inline-flex items-center gap-1 text-red-600"><ExclamationTriangleIcon className="h-3.5 w-3.5" />失败</span>
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
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-semibold">统计历史</p>
          <ClockIcon className="h-4 w-4 text-gray-500" />
        </div>
        <div className="p-3 space-y-2 max-h-[320px] overflow-y-auto">
          {historyLoading ? (
            <p className="text-xs text-gray-500">加载中...</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-400">暂无历史记录</p>
          ) : (
            history.map((item) => (
              <div key={item.snapshotId} className="border border-gray-200 rounded p-2 bg-gray-50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-800">{item.snapshotId}</p>
                  <span className={`text-xs ${item.status === 'success' ? 'text-emerald-600' : item.status === 'running' ? 'text-amber-600' : 'text-red-600'}`}>
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{item.completedAt ? new Date(item.completedAt).toLocaleString() : '-'}</p>
                <p className="mt-1 text-xs text-gray-600">总字节: {formatBytes(item.summary?.grandTotalBytes)}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default EngineeringStatistics;
