import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { CheckIcon, EnvelopeOpenIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { messageCenterService, MessageCenterItem, MessageType } from '../services/messageCenterService';

function formatTypeLabel(type: MessageType): string {
  if (type === 'engineering_statistics') return '工程统计';
  if (type === 'orchestration') return '计划编排';
  return '系统告警';
}

function readFilterToQuery(readFilter: 'all' | 'read' | 'unread'): boolean | undefined {
  if (readFilter === 'read') return true;
  if (readFilter === 'unread') return false;
  return undefined;
}

const MessageCenter: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState<'all' | MessageType>('all');
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>('all');

  const queryParams = useMemo(
    () => ({
      page,
      pageSize,
      type: typeFilter === 'all' ? undefined : typeFilter,
      isRead: readFilterToQuery(readFilter),
    }),
    [page, pageSize, typeFilter, readFilter],
  );

  const { data, isLoading, isFetching } = useQuery(['message-center-page', queryParams], () =>
    messageCenterService.listMessages(queryParams),
  );

  const markOneMutation = useMutation((messageId: string) => messageCenterService.markAsRead(messageId), {
    onSuccess: () => {
      queryClient.invalidateQueries('message-center-page');
      queryClient.invalidateQueries('message-center-unread-count');
    },
  });

  const markAllMutation = useMutation(() => messageCenterService.markAllAsRead(), {
    onSuccess: () => {
      queryClient.invalidateQueries('message-center-page');
      queryClient.invalidateQueries('message-center-unread-count');
    },
  });

  const items: MessageCenterItem[] = data?.items || [];

  const openMessageDetail = async (item: MessageCenterItem) => {
    if (!item.isRead) {
      await markOneMutation.mutateAsync(item.messageId);
    }

    const redirectPath = String(item.payload?.redirectPath || '').trim();
    if (redirectPath) {
      navigate(redirectPath);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">消息中心</h1>
            <p className="text-sm text-gray-600 mt-1">统一查看系统通知，支持筛选、分页与已读管理。</p>
          </div>
          <button
            type="button"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isLoading}
            className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <CheckIcon className="h-4 w-4" />
            全部已读
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as 'all' | MessageType);
              setPage(1);
            }}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">全部类型</option>
            <option value="engineering_statistics">工程统计</option>
            <option value="orchestration">计划编排</option>
            <option value="system_alert">系统告警</option>
          </select>

          <select
            value={readFilter}
            onChange={(e) => {
              setReadFilter(e.target.value as 'all' | 'read' | 'unread');
              setPage(1);
            }}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="unread">仅未读</option>
            <option value="read">仅已读</option>
          </select>

          <div className="flex items-center text-sm text-gray-500 px-1">
            共 {data?.total || 0} 条，未读 {data?.unreadCount || 0} 条
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">暂无消息</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div key={item.messageId} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{formatTypeLabel(item.type)}</span>
                    {!item.isRead && <span className="text-xs text-rose-600">未读</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => openMessageDetail(item)}
                    className="mt-2 text-sm font-medium text-left text-gray-900 hover:text-primary-700"
                  >
                    {item.title}
                  </button>
                  <p className="mt-1 text-sm text-gray-600">{item.content}</p>
                  <p className="mt-2 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
                {!item.isRead && (
                  <button
                    type="button"
                    onClick={() => markOneMutation.mutate(item.messageId)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <EnvelopeOpenIcon className="h-3.5 w-3.5" />
                    标记已读
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          disabled={page <= 1 || isFetching}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 disabled:opacity-50"
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() => setPage((prev) => prev + 1)}
          disabled={Boolean(data && page >= data.totalPages) || isFetching}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default MessageCenter;
