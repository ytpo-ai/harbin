import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { CheckIcon, EnvelopeOpenIcon } from '@heroicons/react/24/outline';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  messageCenterService,
  InnerMessageCenterItem,
  InnerMessageStatus,
  MessageCenterItem,
  MessageType,
  MESSAGE_CENTER_UPDATED_EVENT,
} from '../services/messageCenterService';

function formatTypeLabel(type: MessageType): string {
  if (type === 'engineering_statistics') return '工程统计';
  if (type === 'orchestration') return '计划编排';
  return '系统告警';
}

function formatInnerStatusLabel(status: InnerMessageStatus): string {
  if (status === 'sent') return '已发送';
  if (status === 'delivered') return '已送达';
  if (status === 'processing') return '处理中';
  if (status === 'processed') return '已处理';
  return '失败';
}

function formatInnerModeLabel(mode: 'direct' | 'subscription'): string {
  return mode === 'direct' ? '直发' : '订阅';
}

function readFilterToQuery(readFilter: 'all' | 'read' | 'unread'): boolean | undefined {
  if (readFilter === 'read') return true;
  if (readFilter === 'unread') return false;
  return undefined;
}

const MessageCenter: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState<'all' | MessageType>('all');
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [activeTab, setActiveTab] = useState<'system' | 'inner'>('system');
  const [innerStatusFilter, setInnerStatusFilter] = useState<'all' | InnerMessageStatus>('all');
  const [localUnreadCount, setLocalUnreadCount] = useState<number | null>(null);

  const queryParams = useMemo(
    () => ({
      page,
      pageSize,
      type: typeFilter === 'all' ? undefined : typeFilter,
      isRead: readFilterToQuery(readFilter),
    }),
    [page, pageSize, typeFilter, readFilter],
  );

  const { data: systemData, isLoading: isSystemLoading, isFetching: isSystemFetching } = useQuery(
    ['message-center-page-system', queryParams],
    () => messageCenterService.listMessages(queryParams),
    { enabled: activeTab === 'system' },
  );

  const innerQueryParams = useMemo(
    () => ({
      page,
      pageSize,
      status: innerStatusFilter === 'all' ? undefined : innerStatusFilter,
    }),
    [page, pageSize, innerStatusFilter],
  );

  const { data: innerData, isLoading: isInnerLoading, isFetching: isInnerFetching } = useQuery(
    ['message-center-page-inner', innerQueryParams],
    () => messageCenterService.listInnerMessages(innerQueryParams),
    { enabled: activeTab === 'inner' },
  );

  React.useEffect(() => {
    setLocalUnreadCount(systemData?.unreadCount ?? null);
  }, [systemData?.unreadCount]);

  const markOneMutation = useMutation((messageId: string) => messageCenterService.markAsRead(messageId), {
    onSuccess: () => {
      setLocalUnreadCount((prev) => (prev === null ? 0 : Math.max(0, prev - 1)));
      window.dispatchEvent(new CustomEvent(MESSAGE_CENTER_UPDATED_EVENT));
      queryClient.invalidateQueries('message-center-page');
      queryClient.invalidateQueries('message-center-unread-count');
    },
  });

  const markAllMutation = useMutation(() => messageCenterService.markAllAsRead(), {
    onSuccess: () => {
      setLocalUnreadCount(0);
      window.dispatchEvent(new CustomEvent(MESSAGE_CENTER_UPDATED_EVENT, { detail: { unreadCount: 0 } }));
      queryClient.invalidateQueries('message-center-page');
      queryClient.invalidateQueries('message-center-unread-count');
    },
  });

  const systemItems: MessageCenterItem[] = systemData?.items || [];
  const innerItems: InnerMessageCenterItem[] = innerData?.items || [];
  const isLoading = activeTab === 'system' ? isSystemLoading : isInnerLoading;
  const isFetching = activeTab === 'system' ? isSystemFetching : isInnerFetching;
  const currentTotalPages = activeTab === 'system' ? systemData?.totalPages || 0 : innerData?.totalPages || 0;
  const selectedMessageId = new URLSearchParams(location.search).get('messageId') || '';

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
            <p className="text-sm text-gray-600 mt-1">统一查看系统通知与内部消息，支持筛选和分页。</p>
          </div>
          {activeTab === 'system' && (
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isLoading}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <CheckIcon className="h-4 w-4" />
              全部已读
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('system');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded text-sm border ${
              activeTab === 'system'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            系统消息
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('inner');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded text-sm border ${
              activeTab === 'inner'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            内部消息
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          {activeTab === 'system' ? (
            <>
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
                共 {systemData?.total || 0} 条，未读 {(localUnreadCount ?? systemData?.unreadCount) || 0} 条
              </div>
            </>
          ) : (
            <>
              <select
                value={innerStatusFilter}
                onChange={(e) => {
                  setInnerStatusFilter(e.target.value as 'all' | InnerMessageStatus);
                  setPage(1);
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部状态</option>
                <option value="sent">已发送</option>
                <option value="delivered">已送达</option>
                <option value="processing">处理中</option>
                <option value="processed">已处理</option>
                <option value="failed">失败</option>
              </select>

              <div className="md:col-span-2 flex items-center text-sm text-gray-500 px-1">
                共 {innerData?.total || 0} 条，仅展示当前账号绑定 Agent 的接收消息
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : activeTab === 'system' && systemItems.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">暂无消息</div>
        ) : activeTab === 'inner' && innerItems.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">暂无内部消息</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeTab === 'system'
              ? systemItems.map((item) => (
                  <div
                    key={item.messageId}
                    className={`p-4 flex items-start justify-between gap-3 ${
                      selectedMessageId === item.messageId ? 'bg-primary-50' : ''
                    }`}
                  >
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
                ))
              : innerItems.map((item) => (
                  <div key={item.messageId} className="p-4">
                    <div className="flex items-center gap-2 text-xs mb-2">
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600">{formatInnerModeLabel(item.mode)}</span>
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{formatInnerStatusLabel(item.status)}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700">{item.eventType}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{item.content}</p>
                    <p className="mt-2 text-xs text-gray-500">发送方: {item.senderAgentId} · 接收方: {item.receiverAgentId}</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
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
          disabled={Boolean(currentTotalPages > 0 && page >= currentTotalPages) || isFetching}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default MessageCenter;
