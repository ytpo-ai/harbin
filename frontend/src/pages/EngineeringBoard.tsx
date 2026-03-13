import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { engineeringIntelligenceService, RequirementStatus } from '../services/engineeringIntelligenceService';

const COLUMNS: Array<{ key: RequirementStatus; title: string }> = [
  { key: 'todo', title: 'Todo' },
  { key: 'assigned', title: 'Assigned' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'review', title: 'Review' },
  { key: 'done', title: 'Done' },
  { key: 'blocked', title: 'Blocked' },
];

const EngineeringBoard: React.FC = () => {
  const { data, isLoading, refetch } = useQuery(
    'ei-requirement-board',
    () => engineeringIntelligenceService.getRequirementBoard(),
    {
      retry: false,
      refetchInterval: 5000,
    },
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">智能研发看板</h1>
            <p className="mt-1 text-sm text-gray-600">按需求状态展示研发执行流转，默认 5 秒自动刷新。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/engineering-intelligence/requirements" className="px-3 py-2 border border-gray-300 rounded text-sm">需求管理</Link>
            <button onClick={() => refetch()} className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm"><ArrowPathIcon className="h-4 w-4" />刷新</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        {COLUMNS.map((column) => {
          const items = data?.columns?.[column.key] || [];
          return (
            <section key={column.key} className="bg-white border border-gray-200 rounded-lg min-h-[420px]">
              <div className="px-3 py-2 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-800">{column.title}</p>
                <p className="text-xs text-gray-500">{items.length} 项</p>
              </div>
              <div className="p-2 space-y-2 max-h-[520px] overflow-y-auto">
                {isLoading ? (
                  <p className="text-xs text-gray-500">加载中...</p>
                ) : items.length === 0 ? (
                  <p className="text-xs text-gray-400">暂无需求</p>
                ) : (
                  items.map((item) => (
                    <Link
                      key={item.requirementId}
                      to={`/engineering-intelligence/requirements/${item.requirementId}`}
                      className="block border border-gray-200 rounded p-2 bg-gray-50 hover:bg-gray-100"
                    >
                      <p className="text-xs font-medium text-gray-800 line-clamp-2">{item.title}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{item.currentAssigneeAgentName || item.currentAssigneeAgentId || '-'}</p>
                      <p className="mt-1 text-[11px] text-gray-400">{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}</p>
                    </Link>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default EngineeringBoard;
