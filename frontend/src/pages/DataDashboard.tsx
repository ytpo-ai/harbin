import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowPathIcon, ChartBarIcon, ClockIcon } from '@heroicons/react/24/outline';
import {
  CreateDataSourcePayload,
  dataCollectionService,
  DataAggregateBucket,
  DataRecordItem,
  DataSourceItem,
} from '../services/dataCollectionService';
import { incubationProjectService } from '../services/incubationProjectService';

type PendingPrefillSource = {
  id: string;
  name: string;
  sourceType: 'api' | 'rss' | 'web_scrape' | 'manual';
  config: Record<string, unknown>;
  collectFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  notifyDiscussion?: boolean;
  notifyThreshold?: number;
  templateName?: string;
  templateId?: string;
  discussionSpaceId?: string;
};

const DEFAULT_EXECUTOR_AGENT_ID = 'data-collection-agent';
const DEFAULT_EXECUTOR_AGENT_NAME = 'Data Collection Agent';

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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sourceName, setSourceName] = useState('');
  const [sourceDescription, setSourceDescription] = useState('');
  const [sourceType, setSourceType] = useState<'api' | 'rss' | 'web_scrape' | 'manual'>('api');
  const [sourceFrequency, setSourceFrequency] = useState<'hourly' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [sourceNotifyDiscussion, setSourceNotifyDiscussion] = useState(true);
  const [sourceNotifyThreshold, setSourceNotifyThreshold] = useState(1);
  const [sourceConfigText, setSourceConfigText] = useState('{\n  "url": ""\n}');
  const [prefillSources, setPrefillSources] = useState<PendingPrefillSource[]>([]);
  const [createError, setCreateError] = useState('');
  const [createNotice, setCreateNotice] = useState('');

  const prefillStorageKey = useMemo(() => `ei-data-source-prefill:${id || ''}`, [id]);

  useEffect(() => {
    if (!id) {
      return;
    }
    const query = new URLSearchParams(location.search);
    const openPrefill = query.get('prefill') === '1';
    if (!openPrefill) {
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(prefillStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = Array.isArray(parsed)
        ? parsed
            .map((item) => ({
              id: String(item?.id || Math.random().toString(36).slice(2)),
              name: String(item?.name || '').trim(),
              sourceType: ['api', 'rss', 'web_scrape', 'manual'].includes(String(item?.sourceType))
                ? (item.sourceType as PendingPrefillSource['sourceType'])
                : 'manual',
              config: (item?.config || {}) as Record<string, unknown>,
              collectFrequency: ['hourly', 'daily', 'weekly', 'monthly'].includes(String(item?.collectFrequency))
                ? (item.collectFrequency as PendingPrefillSource['collectFrequency'])
                : 'daily',
              notifyDiscussion: item?.notifyDiscussion !== undefined ? Boolean(item.notifyDiscussion) : true,
              notifyThreshold: Math.max(1, Number(item?.notifyThreshold || 1)),
              templateName: item?.templateName ? String(item.templateName) : undefined,
              templateId: item?.templateId ? String(item.templateId) : undefined,
              discussionSpaceId: item?.discussionSpaceId ? String(item.discussionSpaceId) : undefined,
            }))
            .filter((item) => item.name)
        : [];

      setPrefillSources(normalized);
    } catch {
      setPrefillSources([]);
    }
  }, [id, location.search, prefillStorageKey]);

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

  const createDataSourceMutation = useMutation(
    async (payload: CreateDataSourcePayload) => {
      return dataCollectionService.createDataSource(payload);
    },
    {
      onSuccess: () => {
        setCreateError('');
        setCreateNotice('数据源已创建');
        queryClient.invalidateQueries(['ei-data-sources', id]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '创建数据源失败')
            : '创建数据源失败';
        setCreateError(message);
      },
    },
  );

  const handleCreateSource = async () => {
    if (!id) {
      return;
    }

    const trimmedName = sourceName.trim();
    if (!trimmedName) {
      setCreateError('请输入数据源名称');
      return;
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(sourceConfigText || '{}') as Record<string, unknown>;
    } catch {
      setCreateError('配置 JSON 格式不正确');
      return;
    }

    await createDataSourceMutation.mutateAsync({
      name: trimmedName,
      description: sourceDescription.trim() || undefined,
      projectId: id,
      sourceType,
      config,
      collectFrequency: sourceFrequency,
      status: 'active',
      notifyDiscussion: sourceNotifyDiscussion,
      notifyThreshold: sourceNotifyDiscussion ? Math.max(1, Number(sourceNotifyThreshold || 1)) : 1,
      executorAgentId: DEFAULT_EXECUTOR_AGENT_ID,
      executorAgentName: DEFAULT_EXECUTOR_AGENT_NAME,
    });

    setSourceName('');
    setSourceDescription('');
    setSourceNotifyDiscussion(true);
    setSourceNotifyThreshold(1);
    setSourceConfigText('{\n  "url": ""\n}');
  };

  const handleCreatePrefillSource = async (source: PendingPrefillSource) => {
    if (!id) {
      return;
    }

    await createDataSourceMutation.mutateAsync({
      name: source.name,
      projectId: id,
      sourceType: source.sourceType,
      config: source.config || {},
      collectFrequency: source.collectFrequency,
      status: 'active',
      notifyDiscussion: source.notifyDiscussion !== undefined ? Boolean(source.notifyDiscussion) : true,
      notifyThreshold: source.notifyDiscussion === false ? 1 : Math.max(1, Number(source.notifyThreshold || 1)),
      discussionSpaceId: source.discussionSpaceId,
      executorAgentId: DEFAULT_EXECUTOR_AGENT_ID,
      executorAgentName: DEFAULT_EXECUTOR_AGENT_NAME,
    });

    setPrefillSources((prev) => {
      const next = prev.filter((item) => item.id !== source.id);
      window.sessionStorage.setItem(prefillStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const clearPrefillSources = () => {
    setPrefillSources([]);
    window.sessionStorage.removeItem(prefillStorageKey);
  };

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

          {prefillSources.length > 0 ? (
            <div className="mb-3 rounded-md border border-[#78a9ff] bg-[#edf5ff] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-[#0f62fe]">模板建议数据源 ({prefillSources.length})</p>
                <button type="button" onClick={clearPrefillSources} className="text-xs text-[#0f62fe] hover:underline">
                  清空
                </button>
              </div>
              <div className="space-y-2">
                {prefillSources.map((item) => (
                  <div key={item.id} className="rounded border border-[#a6c8ff] bg-white px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-[#161616]">{item.name}</div>
                        <div className="text-[11px] text-[#6f6f6f]">
                          {item.templateName ? `${item.templateName} · ` : ''}
                          {item.sourceType} · {item.collectFrequency}
                        </div>
                        <div className="text-[11px] text-[#8d8d8d] mt-1">
                          讨论通知：{item.notifyDiscussion === false ? '关闭' : `开启（每 ${Math.max(1, Number(item.notifyThreshold || 1))} 次采集）`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCreatePrefillSource(item)}
                        disabled={createDataSourceMutation.isLoading}
                        className="rounded border border-[#0f62fe] px-2 py-1 text-[11px] text-[#0f62fe] hover:bg-[#edf5ff] disabled:opacity-60"
                      >
                        创建
                      </button>
                    </div>
                    <pre className="mt-2 overflow-x-auto rounded border border-[#e0e0e0] bg-[#f4f4f4] p-2 text-[11px] text-[#525252]">
                      {JSON.stringify(item.config || {}, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs text-gray-600">手动创建数据源</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="数据源名称"
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-primary-500"
              />
              <select
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as 'api' | 'rss' | 'web_scrape' | 'manual')}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-primary-500"
              >
                <option value="api">api</option>
                <option value="rss">rss</option>
                <option value="web_scrape">web_scrape</option>
                <option value="manual">manual</option>
              </select>
              <input
                value={sourceDescription}
                onChange={(event) => setSourceDescription(event.target.value)}
                placeholder="描述（可选）"
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-primary-500"
              />
              <select
                value={sourceFrequency}
                onChange={(event) => setSourceFrequency(event.target.value as 'hourly' | 'daily' | 'weekly' | 'monthly')}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-primary-500"
              >
                <option value="hourly">hourly</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700">
                <span>回灌讨论通知</span>
                <input
                  type="checkbox"
                  checked={sourceNotifyDiscussion}
                  onChange={(event) => setSourceNotifyDiscussion(event.target.checked)}
                  className="h-4 w-4"
                />
              </label>
              <label className="flex items-center justify-between rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700">
                <span>通知阈值（次）</span>
                <input
                  type="number"
                  min={1}
                  value={sourceNotifyThreshold}
                  onChange={(event) => setSourceNotifyThreshold(Math.max(1, Number(event.target.value || 1)))}
                  disabled={!sourceNotifyDiscussion}
                  className="w-20 rounded border border-gray-300 px-1 py-1 text-right text-xs text-gray-800 outline-none focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </label>
            </div>
            <textarea
              value={sourceConfigText}
              onChange={(event) => setSourceConfigText(event.target.value)}
              rows={5}
              className="mt-2 w-full rounded border border-gray-300 bg-white px-2 py-2 text-[11px] text-gray-800 outline-none focus:border-primary-500"
            />
            <div className="mt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void handleCreateSource()}
                disabled={createDataSourceMutation.isLoading}
                className="rounded border border-primary-500 px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50 disabled:opacity-60"
              >
                {createDataSourceMutation.isLoading ? '创建中...' : '创建数据源'}
              </button>
            </div>
          </div>

          {createError ? <p className="mb-2 text-xs text-red-600">{createError}</p> : null}
          {!createError && createNotice ? <p className="mb-2 text-xs text-green-700">{createNotice}</p> : null}

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
                        <p className="text-[11px] text-gray-500 mt-1">
                          回灌通知: {source.notifyDiscussion === false ? '关闭' : `开启（每 ${Math.max(1, Number(source.notifyThreshold || 1))} 次采集）`}
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
