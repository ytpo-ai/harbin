import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { agentService } from '../services/agentService';
import { discussionService } from '../services/discussionService';
import { wsService } from '../services/wsService';
import { Agent, Discussion } from '../types';
import { ChatBubbleLeftRightIcon, UserGroupIcon, PlusIcon, PauseIcon, PlayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface DiscussionRealtimeEvent {
  type: 'message' | 'agent_joined' | 'agent_left' | 'conclusion' | 'pause';
  data: any;
  timestamp: string;
}

const Discussions: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateDiscussionOpen, setIsCreateDiscussionOpen] = useState(false);
  const [selectedDiscussionId, setSelectedDiscussionId] = useState<string | null>(null);
  const [latestEvent, setLatestEvent] = useState<string>('');

  const { data: agents, isLoading: agentsLoading } = useQuery('agents', agentService.getAgents);
  const { data: discussions = [], isLoading: discussionsLoading } = useQuery('discussions', discussionService.getAllDiscussions);

  const pauseMutation = useMutation((id: string) => discussionService.pauseDiscussion(id), {
    onSuccess: () => queryClient.invalidateQueries('discussions'),
  });
  const resumeMutation = useMutation((id: string) => discussionService.resumeDiscussion(id), {
    onSuccess: () => queryClient.invalidateQueries('discussions'),
  });
  const concludeMutation = useMutation(({ id, summary }: { id: string; summary?: string }) => discussionService.concludeDiscussion(id, summary), {
    onSuccess: () => queryClient.invalidateQueries('discussions'),
  });

  useEffect(() => {
    if (selectedDiscussionId) return;
    if (discussions.length === 0) return;
    setSelectedDiscussionId(discussions[0].id);
  }, [discussions, selectedDiscussionId]);

  useEffect(() => {
    if (!selectedDiscussionId) return;

    const unsubscribe = wsService.subscribe(`discussion:${selectedDiscussionId}`, (raw) => {
      let event: DiscussionRealtimeEvent;
      try {
        event = JSON.parse(raw) as DiscussionRealtimeEvent;
      } catch {
        return;
      }

      if (!event?.type) return;

      const labels: Record<DiscussionRealtimeEvent['type'], string> = {
        message: '收到新消息',
        agent_joined: '有新Agent加入',
        agent_left: '有Agent离开',
        pause: '讨论已暂停',
        conclusion: '讨论已结束',
      };

      setLatestEvent(`${labels[event.type]} · ${new Date(event.timestamp || Date.now()).toLocaleTimeString()}`);
      queryClient.invalidateQueries('discussions');
    });

    return () => unsubscribe();
  }, [selectedDiscussionId]);

  const activeAgents = useMemo(() => (agents || []).filter((agent) => agent.isActive), [agents]);
  const selectedDiscussion = useMemo(
    () => discussions.find((discussion) => discussion.id === selectedDiscussionId) || null,
    [discussions, selectedDiscussionId],
  );
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (agents || []).forEach((agent) => {
      map.set(agent.id, agent.name);
    });
    return map;
  }, [agents]);

  const discussionMessages = selectedDiscussion?.messages || [];

  if (agentsLoading || discussionsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">讨论室</h1>
          <p className="mt-1 text-sm text-gray-500">已迁移到 Agents 服务，支持 WS 实时事件</p>
        </div>
        <button
          onClick={() => setIsCreateDiscussionOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建讨论
        </button>
      </div>

      {discussions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">暂无讨论</h3>
          <p className="mt-1 text-sm text-gray-500">点击右上角“创建讨论”开始</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 grid grid-cols-1 gap-4">
            {discussions.map((discussion) => {
              const participants = discussion.participants || [];
              const isSelected = discussion.id === selectedDiscussionId;
              const statusClass = discussion.status === 'active'
                ? 'bg-green-100 text-green-800'
                : discussion.status === 'paused'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-800';

              return (
                <button
                  key={discussion.id}
                  type="button"
                  onClick={() => setSelectedDiscussionId(discussion.id)}
                  className={`text-left bg-white shadow rounded-lg p-5 border ${isSelected ? 'border-primary-500' : 'border-transparent'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <ChatBubbleLeftRightIcon className="h-7 w-7 text-primary-600 mr-2" />
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">讨论 {discussion.id.slice(-6)}</h3>
                        <p className="text-xs text-gray-500">任务: {discussion.taskId}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                      {discussion.status === 'active' ? '进行中' : discussion.status === 'paused' ? '已暂停' : '已结束'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span className="inline-flex items-center">
                      <UserGroupIcon className="h-4 w-4 mr-1" />
                      {participants.length} 位参与者
                    </span>
                    <span>{(discussion.messages || []).length} 条消息</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="bg-white shadow rounded-lg p-5 h-fit">
            {selectedDiscussion ? (
              <>
                <h3 className="text-lg font-medium text-gray-900">当前讨论</h3>
                <p className="mt-1 text-sm text-gray-500 break-all">ID: {selectedDiscussion.id}</p>
                <p className="text-sm text-gray-500 break-all">Task: {selectedDiscussion.taskId}</p>

                <div className="mt-4 space-y-2 text-sm text-gray-700">
                  <div>状态: {selectedDiscussion.status}</div>
                  <div>参与者: {(selectedDiscussion.participants || []).length}</div>
                  <div>消息: {(selectedDiscussion.messages || []).length}</div>
                </div>

                {latestEvent && (
                  <div className="mt-4 rounded-md bg-blue-50 text-blue-800 text-xs px-3 py-2">
                    实时事件：{latestEvent}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  {selectedDiscussion.status === 'active' ? (
                    <button
                      onClick={() => pauseMutation.mutate(selectedDiscussion.id)}
                      disabled={pauseMutation.isLoading}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      <PauseIcon className="h-4 w-4 mr-1" />
                      暂停
                    </button>
                  ) : selectedDiscussion.status === 'paused' ? (
                    <button
                      onClick={() => resumeMutation.mutate(selectedDiscussion.id)}
                      disabled={resumeMutation.isLoading}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      <PlayIcon className="h-4 w-4 mr-1" />
                      恢复
                    </button>
                  ) : null}

                  {selectedDiscussion.status !== 'concluded' && (
                    <button
                      onClick={() => concludeMutation.mutate({ id: selectedDiscussion.id })}
                      disabled={concludeMutation.isLoading}
                      className="inline-flex items-center px-3 py-2 bg-primary-600 text-white text-sm rounded hover:bg-primary-700 disabled:opacity-50"
                    >
                      <CheckCircleIcon className="h-4 w-4 mr-1" />
                      结束
                    </button>
                  )}
                </div>

                <div className="mt-5 border-t pt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">消息流</h4>
                  {discussionMessages.length === 0 ? (
                    <p className="text-sm text-gray-500">暂无消息</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {discussionMessages.slice(-30).map((message) => {
                        const senderName = message.agentId === 'system'
                          ? 'System'
                          : (agentNameMap.get(message.agentId) || message.agentId);

                        return (
                          <div key={message.id} className="rounded-md border border-gray-200 p-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-gray-700">{senderName}</span>
                              <span className="text-[11px] text-gray-400">
                                {new Date(message.timestamp as unknown as string).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{message.content}</p>
                            <p className="text-[11px] text-gray-500 mt-1">类型: {message.type}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">请选择一个讨论查看详情</p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">可用Agent</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeAgents.map((agent) => (
              <div key={agent.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{agent.name}</h4>
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    活跃
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-2">{agent.description}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">角色: {agent.roleId}</span>
                  <span className="text-gray-500">{agent.model.name}</span>
                </div>
              </div>
            ))}
          </div>

          {activeAgents.length === 0 && (
            <div className="text-center py-8">
              <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">没有活跃的Agent</h3>
              <p className="mt-1 text-sm text-gray-500">激活一些Agent来开始讨论</p>
            </div>
          )}
        </div>
      </div>

      {isCreateDiscussionOpen && (
        <CreateDiscussionModal
          agents={activeAgents}
          onClose={() => setIsCreateDiscussionOpen(false)}
          onCreated={(discussion) => {
            setIsCreateDiscussionOpen(false);
            setSelectedDiscussionId(discussion.id);
            queryClient.invalidateQueries('discussions');
          }}
        />
      )}
    </div>
  );
};

const CreateDiscussionModal: React.FC<{
  agents: Agent[];
  onClose: () => void;
  onCreated: (discussion: Discussion) => void;
}> = ({ agents, onClose, onCreated }) => {
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation(
    () => discussionService.createDiscussion({
      taskId: `manual-${Date.now()}`,
      participantIds: selectedAgents,
      initialPrompt: description ? `${topic}\n\n${description}` : topic,
    }),
    {
      onSuccess: (discussion) => {
        onCreated(discussion);
      },
    },
  );

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-[500px] shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">创建新讨论</h3>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">讨论主题</label>
              <input
                type="text"
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="输入讨论主题..."
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="详细描述讨论内容..."
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">选择参与Agent</label>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-2">
                {agents.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">没有可用的活跃Agent</p>
                ) : (
                  agents.map((agent) => (
                    <label key={agent.id} className="flex items-center p-2 hover:bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={selectedAgents.includes(agent.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAgents([...selectedAgents, agent.id]);
                          } else {
                            setSelectedAgents(selectedAgents.filter((id) => id !== agent.id));
                          }
                        }}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.roleId} - {agent.model.name}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isLoading || selectedAgents.length === 0 || !topic.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {createMutation.isLoading ? '创建中...' : '创建讨论'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Discussions;
