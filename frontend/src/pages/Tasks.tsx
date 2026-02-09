import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { taskService } from '../services/taskService';
import { agentService } from '../services/agentService';
import { Task, Agent, TeamSettings } from '../types';
import { PlusIcon, PlayIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

const Tasks: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState(false);

  const { data: tasks, isLoading: tasksLoading } = useQuery('tasks', taskService.getTasks);
  const { data: agents, isLoading: agentsLoading } = useQuery('agents', agentService.getAgents);

  const createTaskMutation = useMutation(taskService.createTask, {
    onSuccess: () => {
      queryClient.invalidateQueries('tasks');
      setIsCreateModalOpen(false);
    },
  });

  const executeTaskMutation = useMutation(taskService.executeWithCollaboration, {
    onSuccess: () => {
      queryClient.invalidateQueries('tasks');
      setIsExecutionModalOpen(false);
      setSelectedTask(null);
    },
  });

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
      case 'in_progress':
        return <PlayIcon className="h-5 w-5 text-blue-500" />;
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      default:
        return <ClockIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusText = (status: Task['status']) => {
    switch (status) {
      case 'pending': return '待处理';
      case 'in_progress': return '进行中';
      case 'completed': return '已完成';
      case 'failed': return '失败';
      default: return '未知';
    }
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityText = (priority: Task['priority']) => {
    switch (priority) {
      case 'urgent': return '紧急';
      case 'high': return '高';
      case 'medium': return '中';
      case 'low': return '低';
      default: return '未知';
    }
  };

  if (tasksLoading || agentsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">任务管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理和执行AI协作任务</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建任务
        </button>
      </div>

      {/* 任务列表 */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {tasks?.map((task) => (
            <li key={task.id}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(task.status)}
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {task.title}
                      </p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                        {getPriorityText(task.priority)}
                      </span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        task.status === 'completed' ? 'bg-green-100 text-green-800' :
                        task.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                        task.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {getStatusText(task.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-gray-500">
                      <p className="truncate">{task.description}</p>
                    </div>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span>类型: {task.type}</span>
                      <span>创建时间: {new Date(task.createdAt).toLocaleString()}</span>
                      {task.completedAt && (
                        <span>完成时间: {new Date(task.completedAt).toLocaleString()}</span>
                      )}
                    </div>
                    {task.result && (
                      <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                        <p className="font-medium text-gray-700">结果预览:</p>
                        <p className="text-gray-600 truncate">{task.result}</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                    <div className="flex space-x-2">
                      {task.status === 'pending' && (
                        <button
                          onClick={() => {
                            setSelectedTask(task);
                            setIsExecutionModalOpen(true);
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                        >
                          <PlayIcon className="h-3 w-3 mr-1" />
                          执行
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        
        {tasks?.length === 0 && (
          <div className="text-center py-12">
            <ClipboardDocumentListIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有任务</h3>
            <p className="mt-1 text-sm text-gray-500">创建你的第一个AI协作任务</p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                创建任务
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 创建任务模态框 */}
      {isCreateModalOpen && (
        <CreateTaskModal 
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => setIsCreateModalOpen(false)}
        />
      )}

      {/* 任务执行模态框 */}
      {isExecutionModalOpen && selectedTask && (
        <TaskExecutionModal
          task={selectedTask}
          agents={agents || []}
          onClose={() => {
            setIsExecutionModalOpen(false);
            setSelectedTask(null);
          }}
          onSuccess={() => {
            setIsExecutionModalOpen(false);
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
};

// 创建任务模态框组件
const CreateTaskModal: React.FC<{
  onClose: () => void;
  onSuccess: () => void;
}> = ({ onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: '',
    priority: 'medium' as Task['priority'],
    assignedAgents: [] as string[],
  });

  const createTaskMutation = useMutation(taskService.createTask, {
    onSuccess: () => {
      queryClient.invalidateQueries('tasks');
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const taskData = {
      title: formData.title,
      description: formData.description,
      type: formData.type,
      priority: formData.priority,
      status: 'pending' as const,
      assignedAgents: formData.assignedAgents,
      teamId: 'default-team', // 临时硬编码
      messages: [],
    };

    createTaskMutation.mutate(taskData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">创建新任务</h3>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">任务标题</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">任务描述</label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">任务类型</label>
              <input
                type="text"
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">优先级</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as Task['priority'] })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
            
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createTaskMutation.isLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {createTaskMutation.isLoading ? '创建中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// 任务执行模态框组件
const TaskExecutionModal: React.FC<{
  task: Task;
  agents: Agent[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ task, agents, onClose, onSuccess }) => {
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [collaborationMode, setCollaborationMode] = useState<TeamSettings['collaborationMode']>('discussion');

  const executeTaskMutation = useMutation(taskService.executeWithCollaboration, {
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleExecute = () => {
    const selectedAgentObjects = agents.filter(agent => selectedAgents.includes(agent.id));
    
    const teamSettings: TeamSettings = {
      collaborationMode,
      maxConcurrentAgents: selectedAgents.length,
      votingEnabled: false,
      consensusThreshold: 0.7,
    };

    executeTaskMutation.mutate({
      taskId: task.id,
      agents: selectedAgentObjects,
      teamSettings,
    });
  };

  const activeAgents = agents.filter(agent => agent.isActive);

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-[600px] shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">执行任务: {task.title}</h3>
          
          <div className="mt-4 space-y-4">
            {/* 任务信息 */}
            <div className="p-3 bg-gray-50 rounded">
              <h4 className="font-medium text-gray-900">任务信息</h4>
              <p className="text-sm text-gray-600 mt-1">{task.description}</p>
              <p className="text-sm text-gray-500 mt-1">类型: {task.type} | 优先级: {task.priority}</p>
            </div>

            {/* 协作模式选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">协作模式</label>
              <select
                value={collaborationMode}
                onChange={(e) => setCollaborationMode(e.target.value as TeamSettings['collaborationMode'])}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="discussion">自由讨论模式</option>
                <option value="pipeline">流水线模式</option>
                <option value="parallel">并行协作模式</option>
                <option value="hierarchical">分级监督模式</option>
              </select>
            </div>

            {/* Agent选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">选择参与Agent</label>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-2">
                {activeAgents.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">没有可用的活跃Agent</p>
                ) : (
                  activeAgents.map((agent) => (
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

            {/* 执行状态 */}
            {executeTaskMutation.isLoading && (
              <div className="text-center py-4">
                <div className="inline-flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600 mr-2"></div>
                  <span className="text-sm text-gray-600">正在执行任务...</span>
                </div>
              </div>
            )}

            {executeTaskMutation.data && (
              <div className="p-3 bg-green-50 border border-green-200 rounded">
                <h4 className="font-medium text-green-800">执行成功!</h4>
                <p className="text-sm text-green-700 mt-1">任务已成功完成</p>
              </div>
            )}

            {executeTaskMutation.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <h4 className="font-medium text-red-800">执行失败</h4>
                <p className="text-sm text-red-700 mt-1">{executeTaskMutation.error.message}</p>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              关闭
            </button>
            <button
              onClick={handleExecute}
              disabled={selectedAgents.length === 0 || executeTaskMutation.isLoading}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {executeTaskMutation.isLoading ? '执行中...' : '开始执行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tasks;