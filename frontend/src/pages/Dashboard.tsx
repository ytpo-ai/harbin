import React from 'react';
import { useQuery } from 'react-query';
import { agentService } from '../services/agentService';
import { 
  UserGroupIcon, 
  CheckCircleIcon
} from '@heroicons/react/24/outline';

const Dashboard: React.FC = () => {
  const { data: agents } = useQuery('agents', agentService.getAgents);
  const totalAgents = agents?.length ?? 0;
  const activeAgents = agents?.filter(a => a.isActive).length ?? 0;

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
        <p className="mt-1 text-sm text-gray-500">ytpo.ai 平台概览</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Agent总数"
          value={totalAgents}
          icon={UserGroupIcon}
          color="text-gray-600"
        />
        <StatCard
          title="活跃Agent"
          value={activeAgents}
          icon={CheckCircleIcon}
          color="text-green-600"
        />
      </div>
    </div>
  );
};

export default Dashboard;
