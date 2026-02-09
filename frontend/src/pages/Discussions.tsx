import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { agentService } from '../services/agentService';
import { Agent } from '../types';
import { ChatBubbleLeftRightIcon, UserGroupIcon, PlusIcon, PauseIcon, PlayIcon } from '@heroicons/react/24/outline';

const Discussions: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateDiscussionOpen, setIsCreateDiscussionOpen] = useState(false);

  const { data: agents, isLoading } = useQuery('agents', agentService.getAgents);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const activeAgents = agents?.filter(agent => agent.isActive) || [];

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">讨论室</h1>
          <p className="mt-1 text-sm text-gray-500">AI Agent自由讨论协作空间</p>
        </div>
        <button
          onClick={() => setIsCreateDiscussionOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建讨论
        </button>
      </div>

      {/* 讨论列表 */}
      {activeAgents.length === 0 ? (
        <div className="text-center py-12">
          <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">没有可用的Agent</h3>
          <p className="mt-1 text-sm text-gray-500">需要先创建并激活至少一个Agent才能开始讨论</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 讨论室卡片 */}
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center mb-4">
              <ChatBubbleLeftRightIcon className="h-8 w-8 text-primary-600 mr-3" />
              <div>
                <h3 className="text-lg font-medium text-gray-900">讨论室 1</h3>
                <p className="text-sm text-gray-500">活跃讨论中</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">参与者:</span>
                <div className="flex -space-x-2">
                  {activeAgents.slice(0, 3).map((agent) => (
                    <div
                      key={agent.id}
                      className="w-6 h-6 bg-primary-500 text-white text-xs rounded-full flex items-center justify-center border-2 border-white"
                      title={agent.name}
                    >
                      {agent.name.charAt(0)}
                    </div>
                  ))}
                  {activeAgents.length > 3 && (
                    <div className="w-6 h-6 bg-gray-500 text-white text-xs rounded-full flex items-center justify-center border-2 border-white">
                      +{activeAgents.length - 3}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">状态:</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  进行中
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">消息数:</span>
                <span className="font-medium">12</span>
              </div>
            </div>
            <div className="mt-4 flex space-x-2">
              <button className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded hover:bg-primary-700">
                加入讨论
              </button>
              <button className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50">
                <PauseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 模拟空讨论室 */}
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center mb-4">
              <ChatBubbleLeftRightIcon className="h-8 w-8 text-gray-400 mr-3" />
              <div>
                <h3 className="text-lg font-medium text-gray-900">讨论室 2</h3>
                <p className="text-sm text-gray-500">等待开始</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">参与者:</span>
                <span className="text-gray-400">未设置</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">状态:</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  未开始
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">消息数:</span>
                <span className="font-medium">0</span>
              </div>
            </div>
            <div className="mt-4 flex space-x-2">
              <button className="flex-1 px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700">
                开始讨论
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent列表 */}
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
                  <span className="text-gray-500">类型: {agent.type}</span>
                  <span className="text-gray-500">{agent.model.name}</span>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-gray-500">能力:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {agent.capabilities.slice(0, 2).map((capability, index) => (
                      <span key={index} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        {capability}
                      </span>
                    ))}
                    {agent.capabilities.length > 2 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        +{agent.capabilities.length - 2}
                      </span>
                    )}
                  </div>
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

      {/* 创建讨论模态框 */}
      {isCreateDiscussionOpen && (
        <CreateDiscussionModal 
          agents={activeAgents}
          onClose={() => setIsCreateDiscussionOpen(false)}
          onSuccess={() => setIsCreateDiscussionOpen(false)}
        />
      )}
    </div>
  );
};

// 创建讨论模态框组件
const CreateDiscussionModal: React.FC<{
  agents: Agent[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ agents, onClose, onSuccess }) => {
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');

  const handleCreateDiscussion = () => {
    // 这里应该调用创建讨论的API
    console.log('Creating discussion:', { selectedAgents, topic, description });
    
    // 模拟创建成功
    setTimeout(() => {
      onSuccess();
    }, 1000);
  };

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
                            setSelectedAgents(selectedAgents.filter(id => id !== agent.id));
                          }
                        }}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.type} - {agent.model.name}</p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleCreateDiscussion}
              disabled={selectedAgents.length === 0 || !topic.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              创建讨论
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Discussions;