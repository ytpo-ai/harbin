import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowPathIcon, ChartBarIcon, ClockIcon } from '@heroicons/react/24/outline';
import {
  dataCollectionService,
  DataAggregateBucket,
  DataRecordItem,
  DataSourceItem,
} from '../services/dataCollectionService';
import { incubationProjectService } from '../services/incubationProjectService';

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DataDashboard: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const projectQuery = useQuery(['incubation-project-detail', id], () => incubationProjectService.getById(id || ''), {
    enabled: Boolean(id),
    retry: false,
  });

  const dataSourcesQuery = useQuery<DataSourceItem[]>(
    ['ei-data-sources', id],
    () => dataCollectionService.getDataSources(id || ''),
    { enabled: Boolean(id), retry: false },
  );

  const recordsQuery = useQuery<DataRecordItem[]>(
    ['ei-data-records', id],
    () => dataCollectionService.getDataRecords(id || ''),
    { enabled: Boolean(id), retry: false },
  );

  const aggregateQuery = useQuery<DataAggregateBucket[]>(
    ['ei-data-records-aggregate', id],
    () => dataCollectionService.getAggregate(id || '', 'dataCategory'),
    { enabled: Boolean(id), retry: false },
  );

  const collectMutation = useMutation((sourceId: string) => dataCollectionService.triggerCollect(sourceId), {
    onSuccess: () => {
      queryClient.invalidateQueries(['ei-data-sources', id]);
      queryClient.invalidateQueries(['ei-data-records', id]);
      queryClient.invalidateQueries(['ei-data-records-aggregate', id]);
    },
  });

  const dataSources = dataSourcesQuery.data || [];
  const records = recordsQuery.data || [];
  const buckets = aggregateQuery.data || [];

  if (projectQuery.isLoading) {
    return <div className="p-6 text-sm text-gray-500">加载项目中...</div>;
  }

  if (!projectQuery.data) {
    return <div className="p-6 text-sm text-red-600">项目不存在或加载失败。</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">数据看板</p>
            <h1 className="text-lg font-semibold text-gray-900 mt-1">{projectQuery.data.name}</h1>
          </div>
          <Link to={`/ei/incubation/${encodeURIComponent(projectQuery.data._id)}`} className="text-xs text-primary-600 hover:underline">
            返回项目详情
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-900">数据源管理</p>
            <button
              type="button"
              onClick={() => dataSourcesQuery.refetch()}
              className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />刷新
            </button>
          </div>
          {dataSourcesQuery.isLoading ? (
            <p className="text-sm text-gray-500">加载中...</p>
          ) : dataSources.length === 0 ? (
            <p className="text-sm text-gray-400">暂无数据源，请先通过 API 创建数据源。</p>
          ) : (
            <div className="space-y-2">
              {dataSources.map((source) => {
                const total = Number(source.statistics?.totalCollections || 0);
                const success = Number(source.statistics?.successCount || 0);
                const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
                return (
                  <div key={source._id} className="border border-gray-200 rounded-md p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{source.name}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          类型: {source.sourceType} · 频率: {source.collectFrequency} · 状态: {source.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => collectMutation.mutate(source._id)}
                        disabled={collectMutation.isLoading}
                        className="text-xs px-2.5 py-1.5 rounded border border-gray-300 hover:border-primary-400 hover:text-primary-700 disabled:opacity-60"
                      >
                        手动采集
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                      <span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" />最近采集: {formatDateTime(source.lastCollectedAt)}</span>
                      <span>成功率: {successRate}%</span>
                      {source.lastError ? <span className="text-red-600">最近错误: {source.lastError}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <ChartBarIcon className="h-4 w-4 text-gray-500" />
            <p className="text-sm font-medium text-gray-900">分类统计</p>
          </div>
          {aggregateQuery.isLoading ? (
            <p className="text-sm text-gray-500">加载中...</p>
          ) : buckets.length === 0 ? (
            <p className="text-sm text-gray-400">暂无统计数据</p>
          ) : (
            <div className="space-y-2">
              {buckets.map((bucket) => (
                <div key={bucket.key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{bucket.key}</span>
                  <span className="font-medium text-gray-900">{bucket.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-900">最近采集记录</p>
          <button
            type="button"
            onClick={() => recordsQuery.refetch()}
            className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />刷新
          </button>
        </div>
        {recordsQuery.isLoading ? (
          <p className="text-sm text-gray-500">加载中...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-400">暂无采集记录</p>
        ) : (
          <div className="space-y-2">
            {records.slice(0, 20).map((record) => (
              <div key={record._id} className="border border-gray-200 rounded-md p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{record.dataCategory}</p>
                  <span className="text-[11px] text-gray-500">{record.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">采集时间: {formatDateTime(record.collectedAt)}</p>
                <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto text-gray-700">
                  {JSON.stringify(record.data || {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default DataDashboard;
