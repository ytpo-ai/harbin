import React from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { TIER_FILTER_OPTIONS } from './constants';
import type { TierFilter } from './types';

interface AgentListHeaderProps {
  tierFilter: TierFilter;
  onTierFilterChange: (value: TierFilter) => void;
  onOpenCreate: () => void;
}

export const AgentListHeader: React.FC<AgentListHeaderProps> = ({
  tierFilter,
  onTierFilterChange,
  onOpenCreate,
}) => {
  return (
    <div className="flex justify-between items-center">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Agent管理</h1>
        <p className="mt-1 text-sm text-gray-500">管理和配置AI Agent</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="agent-tier-filter" className="text-sm text-gray-600">筛选</label>
          <select
            id="agent-tier-filter"
            value={tierFilter}
            onChange={(e) => onTierFilterChange(e.target.value as TierFilter)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {TIER_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={onOpenCreate}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建Agent
        </button>
      </div>
    </div>
  );
};
