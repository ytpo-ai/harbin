import React from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { usageService } from '../services/usageService';

type Period = 'week' | 'month';

function formatCurrency(value: number): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function formatDelta(current: number, previous: number): string {
  if (!previous) {
    return current > 0 ? '+100%' : '0%';
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  const prefix = delta >= 0 ? '+' : '';
  return `${prefix}${delta.toFixed(1)}%`;
}

const Usage: React.FC = () => {
  const queryClient = useQueryClient();
  const [period, setPeriod] = React.useState<Period>('month');

  const { data: overview, isLoading: loadingOverview } = useQuery(
    ['usage-overview', period],
    () => usageService.getOverview(period),
    { retry: false },
  );

  const { data: trend = [], isLoading: loadingTrend } = useQuery(
    ['usage-daily-trend', overview?.from, overview?.to],
    () => usageService.getDailyTrend(overview?.from, overview?.to),
    { enabled: Boolean(overview?.from && overview?.to), retry: false },
  );

  const { data: byAgent = [], isLoading: loadingByAgent } = useQuery(
    ['usage-by-agent', overview?.from, overview?.to],
    () => usageService.getByAgent(overview?.from, overview?.to, 8),
    { enabled: Boolean(overview?.from && overview?.to), retry: false },
  );

  const { data: byModel = [], isLoading: loadingByModel } = useQuery(
    ['usage-by-model', overview?.from, overview?.to],
    () => usageService.getByModel(overview?.from, overview?.to, 8),
    { enabled: Boolean(overview?.from && overview?.to), retry: false },
  );

  const { data: pricingStatus } = useQuery('usage-pricing-status', usageService.getPricingStatus, {
    retry: false,
  });

  const refreshPricingMutation = useMutation(usageService.refreshPricing, {
    onSuccess: () => {
      queryClient.invalidateQueries('usage-pricing-status');
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">用量与计费</h1>
            <p className="mt-1 text-sm text-gray-600">查看 Agent 模型调用费用、Token 趋势与主要消耗来源。</p>
          </div>
          <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setPeriod('week')}
              className={`rounded px-3 py-1.5 text-xs ${period === 'week' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              近 7 天
            </button>
            <button
              type="button"
              onClick={() => setPeriod('month')}
              className={`rounded px-3 py-1.5 text-xs ${period === 'month' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              近 30 天
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">总费用</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{loadingOverview ? '--' : formatCurrency(overview?.totalCost || 0)}</p>
          <p className="mt-1 text-xs text-gray-500">环比 {formatDelta(overview?.totalCost || 0, overview?.previousPeriod.totalCost || 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">总 Tokens</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{loadingOverview ? '--' : formatNumber(overview?.totalTokens || 0)}</p>
          <p className="mt-1 text-xs text-gray-500">环比 {formatDelta(overview?.totalTokens || 0, overview?.previousPeriod.totalTokens || 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">请求次数</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{loadingOverview ? '--' : formatNumber(overview?.requestCount || 0)}</p>
          <p className="mt-1 text-xs text-gray-500">环比 {formatDelta(overview?.requestCount || 0, overview?.previousPeriod.requestCount || 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">活跃模型</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{loadingOverview ? '--' : formatNumber(overview?.activeModels || 0)}</p>
          <p className="mt-1 text-xs text-gray-500">环比 {formatDelta(overview?.activeModels || 0, overview?.previousPeriod.activeModels || 0)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">每日费用趋势</p>
        <div className="mt-3 h-72">
          {loadingTrend ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">加载中...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="usageCostFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${Number(v).toFixed(2)}`} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Area type="monotone" dataKey="cost" stroke="#0284c7" fill="url(#usageCostFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">Agent 用量排行</p>
          <div className="mt-3 h-72">
            {loadingByAgent ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">加载中...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byAgent} layout="vertical" margin={{ top: 8, right: 12, left: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="agentName" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                  <Bar dataKey="tokens" fill="#0369a1" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">模型用量排行</p>
          <div className="mt-3 h-72">
            {loadingByModel ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">加载中...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byModel} layout="vertical" margin={{ top: 8, right: 12, left: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="modelName" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => formatNumber(value)} />
                  <Bar dataKey="tokens" fill="#0891b2" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-600">
            定价源：{pricingStatus?.source || '-'} | 上次刷新：
            {pricingStatus?.lastRefresh ? new Date(pricingStatus.lastRefresh).toLocaleString() : '-'} | 模型数：
            {pricingStatus?.modelCount || 0} | 覆盖数：{pricingStatus?.overrideCount || 0}
          </div>
          <button
            type="button"
            onClick={() => refreshPricingMutation.mutate()}
            disabled={refreshPricingMutation.isLoading}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            {refreshPricingMutation.isLoading ? '刷新中...' : '手动刷新定价'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Usage;
