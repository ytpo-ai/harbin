import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { CheckIcon, EnvelopeOpenIcon } from '@heroicons/react/24/outline';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  messageCenterService,
  InnerMessageCenterItem,
  InnerMessageEventDefinitionItem,
  InnerMessageStatus,
  InnerMessageSubscriptionItem,
  MessageCenterItem,
  MessageType,
  MESSAGE_CENTER_UPDATED_EVENT,
} from '../services/messageCenterService';
import { agentService } from '../services/agentService';

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
  const [activeTab, setActiveTab] = useState<'system' | 'inner' | 'listener'>('system');
  const [innerStatusFilter, setInnerStatusFilter] = useState<'all' | InnerMessageStatus>('all');
  const [innerEventTypeFilter, setInnerEventTypeFilter] = useState<'all' | string>('all');
  const [localUnreadCount, setLocalUnreadCount] = useState<number | null>(null);
  const [agentKeyword, setAgentKeyword] = useState('');
  const [eventKeyword, setEventKeyword] = useState('');
  const [selectedSubscriberAgentId, setSelectedSubscriberAgentId] = useState('');
  const [subscriptionEventType, setSubscriptionEventType] = useState('');
  const [subscriptionFiltersText, setSubscriptionFiltersText] = useState('{}');
  const [subscriptionIsActive, setSubscriptionIsActive] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');

  const { data: agents = [] } = useQuery('message-center-agents', () => agentService.getAgents(), {
    staleTime: 30 * 1000,
  });

  const { data: eventDefinitions = [] } = useQuery<InnerMessageEventDefinitionItem[]>(
    ['message-center-event-definitions', eventKeyword],
    () =>
      messageCenterService.listInnerMessageEventDefinitions({
        keyword: eventKeyword.trim() || undefined,
        limit: 500,
      }),
    {
      enabled: activeTab === 'inner' || activeTab === 'listener',
      staleTime: 30 * 1000,
    },
  );

  const eventDefinitionOptions = useMemo(
    () =>
      eventDefinitions
        .map((item) => ({
          eventType: String(item.eventType || '').trim(),
          domain: String(item.domain || '').trim(),
        }))
        .filter((item) => Boolean(item.eventType)),
    [eventDefinitions],
  );

  const eventDefinitionLabelMap = useMemo(() => {
    const labels = new Map<string, string>();
    eventDefinitionOptions.forEach((item) => {
      const domainLabel = item.domain ? `${item.domain}` : '事件';
      labels.set(item.eventType, `${domainLabel} · ${item.eventType}`);
    });
    return labels;
  }, [eventDefinitionOptions]);

  const formatEventTypeLabel = React.useCallback(
    (eventType: string): string => eventDefinitionLabelMap.get(eventType) || eventType,
    [eventDefinitionLabelMap],
  );

  const availableSubscriberAgents = useMemo(() => {
    return (agents || [])
      .map((agent) => ({
        id: String(agent.id || ''),
        name: String(agent.name || '').trim() || String(agent.id || ''),
      }))
      .filter((agent) => Boolean(agent.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [agents]);

  const filteredSubscriberAgents = useMemo(() => {
    const keyword = agentKeyword.trim().toLowerCase();
    if (!keyword) {
      return availableSubscriberAgents;
    }

    return availableSubscriberAgents.filter((agent) => {
      const id = agent.id.toLowerCase();
      const name = agent.name.toLowerCase();
      return id.includes(keyword) || name.includes(keyword);
    });
  }, [agentKeyword, availableSubscriberAgents]);

  React.useEffect(() => {
    if (!filteredSubscriberAgents.length) {
      setSelectedSubscriberAgentId('');
      return;
    }

    setSelectedSubscriberAgentId((prev) => {
      if (prev && filteredSubscriberAgents.some((item) => item.id === prev)) {
        return prev;
      }
      return filteredSubscriberAgents[0].id;
    });
  }, [filteredSubscriberAgents]);

  React.useEffect(() => {
    if (!eventDefinitionOptions.length) {
      setSubscriptionEventType('');
      return;
    }

    setSubscriptionEventType((prev) => {
      if (prev && eventDefinitionOptions.some((item) => item.eventType === prev)) {
        return prev;
      }
      return eventDefinitionOptions[0].eventType;
    });
  }, [eventDefinitionOptions]);

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
      eventType: innerEventTypeFilter === 'all' ? undefined : innerEventTypeFilter,
    }),
    [page, pageSize, innerStatusFilter, innerEventTypeFilter],
  );

  const { data: innerData, isLoading: isInnerLoading, isFetching: isInnerFetching } = useQuery(
    ['message-center-page-inner', innerQueryParams],
    () => messageCenterService.listInnerMessages(innerQueryParams),
    { enabled: activeTab === 'inner' },
  );

  const {
    data: innerSubscriptions = [],
    isLoading: isSubscriptionLoading,
    isFetching: isSubscriptionFetching,
  } = useQuery(
    ['message-center-inner-subscriptions', selectedSubscriberAgentId],
    () => messageCenterService.listInnerMessageSubscriptions({ subscriberAgentId: selectedSubscriberAgentId }),
    {
      enabled: activeTab === 'listener' && Boolean(selectedSubscriberAgentId),
      staleTime: 10 * 1000,
    },
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

  const upsertSubscriptionMutation = useMutation(
    (payload: {
      subscriberAgentId: string;
      eventType: string;
      filters?: Record<string, any>;
      isActive?: boolean;
      source?: string;
    }) => messageCenterService.upsertInnerMessageSubscription(payload),
    {
      onSuccess: () => {
        setSubscriptionError('');
        queryClient.invalidateQueries(['message-center-inner-subscriptions', selectedSubscriberAgentId]);
      },
      onError: (error: any) => {
        const backendMessage = error?.response?.data?.message;
        if (typeof backendMessage === 'string' && backendMessage.trim()) {
          setSubscriptionError(backendMessage);
          return;
        }
        setSubscriptionError('保存监听配置失败，请稍后重试。');
      },
    },
  );

  const systemItems: MessageCenterItem[] = systemData?.items || [];
  const innerItems: InnerMessageCenterItem[] = innerData?.items || [];
  const isLoading = activeTab === 'system' ? isSystemLoading : activeTab === 'inner' ? isInnerLoading : false;
  const isFetching = activeTab === 'system' ? isSystemFetching : activeTab === 'inner' ? isInnerFetching : false;
  const currentTotalPages =
    activeTab === 'system' ? systemData?.totalPages || 0 : activeTab === 'inner' ? innerData?.totalPages || 0 : 0;
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

  const saveSubscription = async () => {
    if (!selectedSubscriberAgentId) {
      setSubscriptionError('请先选择一个需要监听的 Agent。');
      return;
    }

    const normalizedEventType = String(subscriptionEventType || '').trim();
    if (!normalizedEventType) {
      setSubscriptionError('请输入事件类型。');
      return;
    }

    let parsedFilters: Record<string, any> = {};
    try {
      const parsed = subscriptionFiltersText.trim() ? JSON.parse(subscriptionFiltersText) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedFilters = parsed as Record<string, any>;
      } else {
        setSubscriptionError('过滤条件必须是 JSON 对象，例如 {"planId":"xxx"}。');
        return;
      }
    } catch {
      setSubscriptionError('过滤条件不是合法 JSON，请检查格式。');
      return;
    }

    await upsertSubscriptionMutation.mutateAsync({
      subscriberAgentId: selectedSubscriberAgentId,
      eventType: normalizedEventType,
      filters: parsedFilters,
      isActive: subscriptionIsActive,
      source: 'message-center-ui',
    });
  };

  const toggleSubscription = async (item: InnerMessageSubscriptionItem) => {
    await upsertSubscriptionMutation.mutateAsync({
      subscriberAgentId: item.subscriberAgentId,
      eventType: item.eventType,
      filters: item.filters,
      isActive: !item.isActive,
      source: item.source || 'message-center-ui',
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">消息中心</h1>
            <p className="text-sm text-gray-600 mt-1">统一查看系统消息、内部消息与消息监听配置，支持筛选和分页。</p>
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
          <button
            type="button"
            onClick={() => {
              setActiveTab('listener');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded text-sm border ${
              activeTab === 'listener'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            消息监听
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
          ) : activeTab === 'inner' ? (
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

              <select
                value={innerEventTypeFilter}
                onChange={(e) => {
                  setInnerEventTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">全部事件</option>
                {eventDefinitionOptions.map((item) => (
                  <option key={item.eventType} value={item.eventType}>
                    {formatEventTypeLabel(item.eventType)}
                  </option>
                ))}
                <option value="orchestration.*">计划编排（域通配）</option>
                <option value="task.*">任务（域通配）</option>
                <option value="meeting.*">会议（域通配）</option>
                <option value="*">全部域通配</option>
              </select>

              <div className="flex items-center text-sm text-gray-500 px-1">
                共 {innerData?.total || 0} 条，仅展示当前账号绑定 Agent 的接收消息
              </div>
            </>
          ) : (
            <>
              <input
                value={agentKeyword}
                onChange={(e) => {
                  setAgentKeyword(e.target.value);
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="按 Agent 名称/ID 搜索"
              />

              <select
                value={selectedSubscriberAgentId}
                onChange={(e) => setSelectedSubscriberAgentId(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {!filteredSubscriberAgents.length && <option value="">无匹配 Agent</option>}
                {filteredSubscriberAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.id})
                  </option>
                ))}
              </select>

              <div className="flex items-center text-sm text-gray-500 px-1">
                已检索 {filteredSubscriberAgents.length} / {availableSubscriberAgents.length} 个 Agent
              </div>
            </>
          )}
        </div>

        {activeTab === 'listener' && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">监听注册管理</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  覆盖计划编排 / 任务 / 会议状态变化事件，支持快速模板与自定义事件类型。
                </p>
              </div>
              <div className="text-xs text-gray-500">支持精确匹配（task.completed）、域通配（task.*）、全局通配（*）</div>
            </div>

            <p className="text-xs text-gray-500">
              当前监听对象：
              {selectedSubscriberAgentId
                ? filteredSubscriberAgents.find((agent) => agent.id === selectedSubscriberAgentId)?.name || selectedSubscriberAgentId
                : '未选择'}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                value={eventKeyword}
                onChange={(e) => {
                  setEventKeyword(e.target.value);
                }}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="按事件类型搜索，如 meeting"
              />

              <select
                value={subscriptionEventType}
                onChange={(e) => setSubscriptionEventType(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {eventDefinitionOptions.map((item) => (
                  <option key={item.eventType} value={item.eventType}>
                    {formatEventTypeLabel(item.eventType)}
                  </option>
                ))}
                <option value="orchestration.*">计划编排（域通配）</option>
                <option value="task.*">任务（域通配）</option>
                <option value="meeting.*">会议（域通配）</option>
                <option value="*">全部域通配</option>
              </select>

              <select
                value={subscriptionIsActive ? 'true' : 'false'}
                onChange={(e) => setSubscriptionIsActive(e.target.value === 'true')}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>

              <button
                type="button"
                onClick={saveSubscription}
                disabled={!selectedSubscriberAgentId || upsertSubscriptionMutation.isLoading}
                className="inline-flex items-center justify-center rounded border border-primary-300 bg-primary-50 px-3 py-2 text-sm text-primary-700 hover:bg-primary-100 disabled:opacity-60"
              >
                保存监听
              </button>
            </div>

            <textarea
              value={subscriptionFiltersText}
              onChange={(e) => setSubscriptionFiltersText(e.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
              placeholder='过滤条件 JSON，可留空，例如 {"planId":"plan-001"}'
            />

            <p className="text-xs text-gray-500">事件目录来自 `event-definitions` 接口，已移除前端硬编码枚举。</p>

            {subscriptionError && <p className="text-xs text-rose-600">{subscriptionError}</p>}

            <div className="rounded border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500">当前监听项（按创建时间倒序）</div>
              {isSubscriptionLoading ? (
                <div className="px-3 py-4 text-sm text-gray-500">加载监听配置中...</div>
              ) : !selectedSubscriberAgentId ? (
                <div className="px-3 py-4 text-sm text-gray-500">请先从 Agent 列表中选择需要监听的对象。</div>
              ) : innerSubscriptions.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-500">暂无监听配置，可先点击上方模板快速创建。</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {innerSubscriptions.map((item) => (
                    <div key={item.subscriptionId} className="px-3 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">{formatEventTypeLabel(item.eventType)}</span>
                          <span className={`rounded px-2 py-0.5 ${item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {item.isActive ? '启用中' : '已停用'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 font-mono break-all">filters: {JSON.stringify(item.filters || {})}</p>
                        <p className="mt-1 text-xs text-gray-400">更新时间: {new Date(item.updatedAt).toLocaleString()}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('inner');
                            setInnerEventTypeFilter(item.eventType);
                            setPage(1);
                          }}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          查看消息
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSubscriptionEventType(item.eventType);
                            setSubscriptionFiltersText(JSON.stringify(item.filters || {}, null, 2));
                            setSubscriptionIsActive(item.isActive);
                            setSubscriptionError('');
                          }}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          载入编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSubscription(item)}
                          disabled={upsertSubscriptionMutation.isLoading || isSubscriptionFetching}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {item.isActive ? '停用' : '启用'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">加载中...</div>
        ) : activeTab === 'listener' ? (
          <div className="p-6 text-sm text-gray-500">请在上方「消息监听」区域管理监听配置并联动查看消息。</div>
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
                    <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600">{formatInnerModeLabel(item.mode)}</span>
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{formatInnerStatusLabel(item.status)}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700">{formatEventTypeLabel(item.eventType)}</span>
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

      {activeTab !== 'listener' && (
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
      )}
    </div>
  );
};

export default MessageCenter;
