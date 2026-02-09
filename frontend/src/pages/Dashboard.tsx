import React from 'react';
import { useQuery } from 'react-query';
import { agentService } from '../services/agentService';
import { taskService } from '../services/taskService';
import { 
  UserGroupIcon, 
  ClipboardDocumentListIcon, 
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

const Dashboard: React.FC = () => {
  const { data: agents, isLoading: agentsLoading } = useQuery('agents', agentService.getAgents);
  const { data: tasks, isLoading: tasksLoading } = useQuery('tasks', taskService.getTasks);

  const getTaskStats = () => {
    if (!tasks) return { total: 0, pending: 0, inProgress: 0, completed: 0, failed: 0 };
    
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  };

  const getActiveAgents = () => {
    if (!agents) return 0;
    return agents.filter(a => a.isActive).length;
  };

  const stats = getTaskStats();
  const activeAgents = getActiveAgents();

  const StatCard: React.FC<{ title: string; value: number; icon: React.ComponentType<any>; color: string }> = ({ 
    title, value, icon: Icon, color 
  }) => (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className={`h-6 w-6 ${color}`} aria-hidden="true" />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd className="text-lg font-medium text-gray-900">{value}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">仪表盘</h1>
        <p className="mt-1 text-sm text-gray-500">AI Agent Team 平台概览</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="活跃Agent"
          value={activeAgents}
          icon={UserGroupIcon}
          color="text-blue-600"
        />
        <StatCard
          title="总任务数"
          value={stats.total}
          icon={ClipboardDocumentListIcon}
          color="text-gray-600"
        />
        <StatCard
          title="已完成"
          value={stats.completed}
          icon={CheckCircleIcon}
          color="text-green-600"
        />
        <StatCard
          title="进行中"
          value={stats.inProgress}
          icon={ClockIcon}
          color="text-yellow-600"
        />
      </div>

      {/* 任务状态分布 */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">任务状态分布</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-yellow-400 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">待处理</span>
              </div>
              <span className="text-sm font-medium text-gray-900">{stats.pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-blue-400 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">进行中</span>
              </div>
              <span className="text-sm font-medium text-gray-900">{stats.inProgress}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-400 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">已完成</span>
              </div>
              <span className="text-sm font-medium text-gray-900">{stats.completed}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-red-400 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">失败</span>
              </div>
              <span className="text-sm font-medium text-gray-900">{stats.failed}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 最近任务 */}
      {tasks && tasks.length > 0 && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">最近任务</h3>
            <div className="overflow-hidden">
              <ul className="divide-y divide-gray-200">
                {tasks.slice(0, 5).map((task) => (
                  <li key={task.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {task.title}
                        </p>
                        <p className="text-sm text-gray-500">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          task.status === 'completed' ? 'bg-green-100 text-green-800' :
                          task.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                          task.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {task.status === 'pending' ? '待处理' :
                           task.status === 'in_progress' ? '进行中' :
                           task.status === 'completed' ? '已完成' : '失败'}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;