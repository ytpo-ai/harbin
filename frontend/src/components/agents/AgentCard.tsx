import React from 'react';
import {
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  EyeIcon,
  PencilIcon,
  PowerIcon,
  TrashIcon,
  UserCircleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { getAgentAvatarUrl } from './utils';
import type { AgentCardProps } from './types';

const getFounderRole = (agentName: string) => {
  if (agentName === 'Alex Chen') return 'CEO';
  if (agentName === 'Sarah Kim') return 'CTO';
  return null;
};

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  roleName,
  tierLabel,
  tierBadgeClassName,
  isStartingChat,
  hasAvatarLoadError,
  onAvatarError,
  onStartChat,
  onViewDetail,
  onToggleActive,
  onEdit,
  onDelete,
}) => {
  const avatarUrl = getAgentAvatarUrl(agent);
  const showAvatarImage = !!avatarUrl && !hasAvatarLoadError;
  const founderRole = getFounderRole(agent.name);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-100">
            {showAvatarImage ? (
              <img
                src={avatarUrl}
                alt={`${agent.name} 头像`}
                className="h-full w-full object-cover"
                onError={onAvatarError}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-500">
                <UserCircleIcon className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-gray-900">{agent.name}</p>
            <p className="mt-0.5 text-xs text-gray-500">{roleName}</p>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
          agent.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}>
          {agent.isActive ? '活跃' : '非活跃'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {founderRole && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            founderRole === 'CEO' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
          }`}>
            {founderRole}
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <CpuChipIcon className="mr-1 h-3 w-3" />
          {agent.model?.name || '-'}
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          <WrenchScrewdriverIcon className="mr-1 h-3 w-3" />
          工具 {agent.tools?.length || 0}
        </span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tierBadgeClassName}`}>
          {tierLabel}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-gray-600">{agent.description || '暂无描述'}</p>

      <p className="mt-2 text-xs text-gray-500">
        能力: {agent.capabilities?.length ? `${agent.capabilities.slice(0, 3).join('、')}${agent.capabilities.length > 3 ? '...' : ''}` : '未配置'}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={onStartChat}
          disabled={isStartingChat}
          className="inline-flex items-center justify-center rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-50"
          title="开始聊天"
        >
          <ChatBubbleLeftRightIcon className="mr-1 h-3.5 w-3.5" />
          {isStartingChat ? '进入中...' : '开始聊天'}
        </button>
        <button
          onClick={onViewDetail}
          className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
          title="查看详情"
        >
          <EyeIcon className="mr-1 h-3.5 w-3.5" />
          详情
        </button>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 border-t border-gray-100 pt-2">
        <button
          onClick={onToggleActive}
          className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title={agent.isActive ? '停用' : '启用'}
        >
          <PowerIcon className="h-4 w-4" />
        </button>
        <button
          onClick={onEdit}
          className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="编辑"
        >
          <PencilIcon className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          className="rounded-md p-2 text-red-400 hover:bg-red-50 hover:text-red-600"
          title="删除"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
