import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { organizationService } from '../services/organizationService';
import { useOrganizationStore } from '../stores/organizationStore';
import { 
  BuildingOffice2Icon, 
  UserGroupIcon, 
  CurrencyDollarIcon,
  ChartBarIcon,
  PlusIcon,
  UsersIcon
} from '@heroicons/react/24/outline';

const Organization: React.FC = () => {
  const [isInitializing, setIsInitializing] = useState(false);
  const { setOrganization } = useOrganizationStore();

  const { data: organization, isLoading, refetch } = useQuery(
    'organization',
    organizationService.getOrganization,
    {
      onSuccess: (data) => setOrganization(data),
    }
  );

  const { data: stats } = useQuery(
    'organization-stats',
    organizationService.getOrganizationStats,
    {
      enabled: !!organization,
    }
  );

  const handleInitialize = async () => {
    setIsInitializing(true);
    try {
      const org = await organizationService.initializeOrganization();
      setOrganization(org);
      await refetch();
    } catch (error) {
      console.error('Failed to initialize organization:', error);
    } finally {
      setIsInitializing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">组织管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理AI Agent公司的组织架构和股权</p>
        </div>

        <div className="bg-white shadow rounded-lg p-8 text-center">
          <BuildingOffice2Icon className="mx-auto h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">尚未初始化组织</h3>
          <p className="text-gray-500 mb-6">点击下方按钮初始化您的AI公司</p>
          <button
            onClick={handleInitialize}
            disabled={isInitializing}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
          >
            {isInitializing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                初始化中...
              </>
            ) : (
              <>
                <PlusIcon className="h-5 w-5 mr-2" />
                初始化组织
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const StatCard: React.FC<{ 
    title: string; 
    value: string | number; 
    icon: React.ComponentType<any>; 
    color: string;
    change?: string;
  }> = ({ title, value, icon: Icon, color, change }) => (
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
              {change && (
                <dd className={`text-sm ${change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                  {change}
                </dd>
              )}
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
        <h1 className="text-2xl font-semibold text-gray-900">组织管理</h1>
        <p className="mt-1 text-sm text-gray-500">管理AI Agent Team Ltd.的组织架构</p>
      </div>

      {/* 公司基本信息 */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <BuildingOffice2Icon className="h-8 w-8 text-primary-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{organization.name}</h2>
              <p className="text-gray-600">{organization.description}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">成立时间</p>
            <p className="font-medium">{new Date(organization.foundedDate).toLocaleDateString()}</p>
          </div>
        </div>

        {/* 股权分布 */}
        <div className="mt-6 border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">股权分布</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                创始人 (你)
              </span>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">
                  {organization.shareDistribution.founder.shares.toLocaleString()} 股
                </span>
                <span className="text-sm font-medium text-primary-600">
                  {organization.shareDistribution.founder.percentage}%
                </span>
              </div>
            </div>

            {organization.shareDistribution.cofounders.map((cofounder, index) => (
              <div key={cofounder.agentId} className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  联合创始人 {index + 1}
                </span>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-600">
                    {cofounder.shares.toLocaleString()} 股
                  </span>
                  <span className="text-sm font-medium text-primary-600">
                    {cofounder.percentage}%
                  </span>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-sm font-medium text-gray-700">
                员工期权池
              </span>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">
                  {organization.shareDistribution.employeePool.allocatedShares.toLocaleString()} / {organization.shareDistribution.employeePool.totalShares.toLocaleString()} 股
                </span>
                <span className="text-sm font-medium text-primary-600">
                  {organization.shareDistribution.employeePool.percentage}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 统计数据 */}
      {stats && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="员工总数"
            value={stats.totalEmployees}
            icon={UserGroupIcon}
            color="text-blue-600"
          />
          <StatCard
            title="活跃员工"
            value={stats.activeEmployees}
            icon={UsersIcon}
            color="text-green-600"
          />
          <StatCard
            title="月度薪资"
            value={`¥${stats.monthlyPayroll.toLocaleString()}`}
            icon={CurrencyDollarIcon}
            color="text-yellow-600"
          />
          <StatCard
            title="公司估值"
            value={`¥${stats.companyValuation.toLocaleString()}`}
            icon={ChartBarIcon}
            color="text-purple-600"
          />
        </div>
      )}

      {/* 部门概览 */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">部门概览</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {organization.departments.map((dept) => (
              <div key={dept.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{dept.name}</h4>
                  <span className="text-sm text-gray-500">{dept.employees.length} 人</span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{dept.description}</p>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-500">预算: ¥{dept.budget.toLocaleString()}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-400">生产力:</span>
                    <span className={`font-medium ${
                      dept.kpis.productivity >= 80 ? 'text-green-600' :
                      dept.kpis.productivity >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {dept.kpis.productivity}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 角色和职位 */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">职位设置</h3>
            <button className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-primary-600 hover:bg-primary-700">
              <PlusIcon className="h-3 w-3 mr-1" />
              添加职位
            </button>
          </div>
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    职位
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    部门
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    级别
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    薪资范围
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    当前人数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    期权
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {organization.roles.map((role) => {
                  const currentEmployees = organization.employees.filter(e => e.roleId === role.id).length;
                  return (
                    <tr key={role.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {role.title}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {role.department}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          role.level === 'executive' ? 'bg-purple-100 text-purple-800' :
                          role.level === 'manager' ? 'bg-blue-100 text-blue-800' :
                          role.level === 'senior' ? 'bg-green-100 text-green-800' :
                          role.level === 'lead' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {role.level}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ¥{role.salaryRange.min.toLocaleString()} - ¥{role.salaryRange.max.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {currentEmployees} / {role.maxEmployees || '∞'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {role.stockOptions ? role.stockOptions.toLocaleString() : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Organization;
