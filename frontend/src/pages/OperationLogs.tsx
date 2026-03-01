import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  operationLogService,
  OperationLogItem,
  OperationLogQuery,
} from '../services/operationLogService';

const DEFAULT_PAGE_SIZE = 20;

const OperationLogs: React.FC = () => {
  const [filters, setFilters] = useState<OperationLogQuery>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    success: '',
  });

  const { data, isLoading, isFetching, refetch, error } = useQuery(
    ['operation-logs', filters],
    () => operationLogService.getOperationLogs(filters),
    { keepPreviousData: true },
  );

  const logs = data?.logs || [];

  const updateFilter = (patch: Partial<OperationLogQuery>) => {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const onPageChange = (nextPage: number) => {
    setFilters((prev) => ({ ...prev, page: nextPage }));
  };

  const renderStatus = (item: OperationLogItem) => {
    if (item.success) {
      return <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">成功</span>;
    }
    return <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">失败</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">系统操作日志</h1>
          <p className="text-sm text-gray-500">全量检索人类用户在系统中的操作记录（已脱敏）</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowPathIcon className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            type="datetime-local"
            value={filters.from || ''}
            onChange={(e) => updateFilter({ from: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="开始时间"
          />
          <input
            type="datetime-local"
            value={filters.to || ''}
            onChange={(e) => updateFilter({ to: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="结束时间"
          />
          <input
            type="text"
            value={filters.action || ''}
            onChange={(e) => updateFilter({ action: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="动作关键词，例如 POST /api/meetings"
          />
          <input
            type="text"
            value={filters.resourceKeyword || ''}
            onChange={(e) => updateFilter({ resourceKeyword: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="资源关键词，例如 /api/auth"
          />
          <input
            type="text"
            value={filters.humanEmployeeId || ''}
            onChange={(e) => updateFilter({ humanEmployeeId: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="人类员工ID"
          />
          <input
            type="text"
            value={filters.assistantAgentId || ''}
            onChange={(e) => updateFilter({ assistantAgentId: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="专属助理Agent ID"
          />
          <input
            type="number"
            value={filters.statusCode || ''}
            onChange={(e) => updateFilter({ statusCode: e.target.value || undefined })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="状态码"
          />
          <select
            value={filters.success || ''}
            onChange={(e) => updateFilter({ success: e.target.value as OperationLogQuery['success'] })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部结果</option>
            <option value="true">仅成功</option>
            <option value="false">仅失败</option>
          </select>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-500">
            当前共 {data?.total || 0} 条，页码 {data?.page || 1}/{Math.max(1, data?.totalPages || 1)}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">日志查询失败，请检查权限或筛选条件。</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">暂无日志数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">时间</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">人类用户</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">动作</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">资源</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">来源</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">耗时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {logs.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div>{item.humanName || '-'}</div>
                      <div className="text-xs text-gray-500">{item.humanEmail || item.humanEmployeeId}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.action}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.resource}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="mb-1">{item.statusCode}</div>
                      {renderStatus(item)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.sourceService || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, (filters.page || 1) - 1))}
          disabled={(filters.page || 1) <= 1}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
        >
          上一页
        </button>
        <button
          onClick={() => onPageChange((filters.page || 1) + 1)}
          disabled={!!data && (filters.page || 1) >= (data.totalPages || 1)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default OperationLogs;
