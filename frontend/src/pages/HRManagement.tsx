import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { hrService } from '../services/hrService';
import { agentService } from '../services/agentService';
import { 
  UserGroupIcon, 
  ChartBarIcon, 
  ExclamationTriangleIcon,
  AcademicCapIcon
} from '@heroicons/react/24/outline';

const HRManagement: React.FC = () => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const { data: agents } = useQuery('agents', agentService.getAgents);
  const { data: teamHealth } = useQuery('team-health', hrService.calculateTeamHealth);
  const { data: lowPerformers } = useQuery('low-performers', hrService.identifyLowPerformers);
  const { data: hiringRecommendations } = useQuery('hiring-recommendations', hrService.recommendHiring);

  const { data: performanceReport, isLoading: reportLoading } = useQuery(
    ['performance-report', selectedAgentId],
    () => hrService.generatePerformanceReport(selectedAgentId!),
    {
      enabled: !!selectedAgentId,
    }
  );

  const activeAgents = agents?.filter(agent => agent.isActive) || [];

  const HealthGradeBadge: React.FC<{ grade: string }> = ({ grade }) => {
    const colors = {
      excellent: 'bg-green-100 text-green-800',
      good: 'bg-blue-100 text-blue-800',
      fair: 'bg-yellow-100 text-yellow-800',
      poor: 'bg-red-100 text-red-800'
    };

    const labels = {
      excellent: '优秀',
      good: '良好',
      fair: '一般',
      poor: '较差'
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[grade as keyof typeof colors]}`}>
        {labels[grade as keyof typeof labels]}
      </span>
    );
  };

  const PerformanceCard: React.FC<{ agent: any; report?: any }> = ({ agent, report }) => {
    if (!report) return null;

    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{agent.name}</h3>
            <p className="text-sm text-gray-500">{report.employeeInfo.role}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{report.overallScore}</div>
            <div className="text-sm text-gray-500">综合评分</div>
          </div>
        </div>

        {/* KPI指标 */}
        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">任务完成率</span>
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div 
                  className="bg-primary-600 h-2 rounded-full" 
                  style={{ width: `${report.kpis.taskCompletionRate}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium">{report.kpis.taskCompletionRate}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">代码质量</span>
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ width: `${report.kpis.codeQuality}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium">{report.kpis.codeQuality}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">团队协作</span>
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ width: `${report.kpis.collaboration}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium">{report.kpis.collaboration}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">创新能力</span>
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full" 
                  style={{ width: `${report.kpis.innovation}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium">{report.kpis.innovation}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">工作效率</span>
            <div className="flex items-center">
              <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                <div 
                  className="bg-yellow-600 h-2 rounded-full" 
                  style={{ width: `${report.kpis.efficiency}%` }}
                ></div>
              </div>
              <span className="text-sm font-medium">{report.kpis.efficiency}%</span>
            </div>
          </div>
        </div>

        {/* 统计数据 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">{report.taskStats.completed}</div>
            <div className="text-xs text-gray-500">已完成任务</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">{report.tokenConsumption.total}</div>
            <div className="text-xs text-gray-500">Token消耗</div>
          </div>
        </div>

        {/* 建议 */}
        {report.recommendations.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">改进建议</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              {report.recommendations.slice(0, 3).map((rec: string, index: number) => (
                <li key={index} className="flex items-start">
                  <span className="text-primary-600 mr-1">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">人力资源管理</h1>
        <p className="mt-1 text-sm text-gray-500">AI Agent团队的绩效评估和人才管理</p>
      </div>

      {/* 团队健康度概览 */}
      {teamHealth && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <ChartBarIcon className="h-8 w-8 text-primary-600 mr-3" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">团队健康度</h2>
                <p className="text-gray-600">整体团队表现评估</p>
              </div>
            </div>
            <HealthGradeBadge grade={teamHealth.grade} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{teamHealth.metrics.overallScore}</div>
              <div className="text-sm text-gray-500">平均绩效分</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{teamHealth.highPerformers}</div>
              <div className="text-sm text-gray-500">高绩效员工</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{teamHealth.averagePerformers}</div>
              <div className="text-sm text-gray-500">中等绩效员工</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{teamHealth.lowPerformers}</div>
              <div className="text-sm text-gray-500">低绩效员工</div>
            </div>
          </div>

          {teamHealth.recommendations.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2">团队建议</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                {teamHealth.recommendations.map((rec: string, index: number) => (
                  <li key={index} className="flex items-start">
                    <span className="text-primary-600 mr-1">•</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 低绩效员工警告 */}
      {lowPerformers && lowPerformers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <ExclamationTriangleIcon className="h-6 w-6 text-red-600 mr-2" />
            <h2 className="text-lg font-semibold text-red-900">低绩效员工警告</h2>
          </div>
          <div className="space-y-3">
            {lowPerformers.map((performer: any, index: number) => (
              <div key={index} className="bg-white rounded p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">Agent {performer.agentId}</span>
                  <span className="text-sm text-red-600">评分: {performer.report.overallScore}</span>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  风险原因: {performer.terminationRisks.join(', ')}
                </div>
                <div className="text-sm">
                  <span className="font-medium">建议操作:</span>
                  <ul className="mt-1 space-y-1">
                    {performer.recommendedActions.map((action: string, actionIndex: number) => (
                      <li key={actionIndex} className="flex items-start">
                        <span className="text-red-600 mr-1">•</span>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 招聘建议 */}
      {hiringRecommendations && hiringRecommendations.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <UserGroupIcon className="h-6 w-6 text-green-600 mr-2" />
            <h2 className="text-lg font-semibold text-green-900">招聘建议</h2>
          </div>
          <div className="space-y-3">
            {hiringRecommendations.map((rec: any, index: number) => (
              <div key={index} className="bg-white rounded p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">
                    {rec.type === 'expansion' ? `${rec.department} 扩张` : '工作负荷调整'}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    rec.priority === 'high' ? 'bg-red-100 text-red-800' :
                    rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {rec.priority === 'high' ? '高优先级' : rec.priority === 'medium' ? '中优先级' : '低优先级'}
                  </span>
                </div>
                
                {rec.type === 'expansion' ? (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      当前员工: {rec.currentEmployees} / {rec.maxCapacity} ({rec.utilization}%)
                    </p>
                    <div className="text-sm">
                      <span className="font-medium">建议职位:</span>
                      <ul className="mt-1 space-y-1">
                        {rec.suggestedRoles.map((role: any, roleIndex: number) => (
                          <li key={roleIndex} className="flex items-center justify-between">
                            <span>{role.title}</span>
                            <span className="text-gray-500">
                              ¥{role.salaryRange.min.toLocaleString()} - ¥{role.salaryRange.max.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-2">
                      当前积压任务: {rec.currentBacklog}
                    </p>
                    <p className="text-sm text-gray-600">
                      建议招聘: {rec.recommendedNewHires} 人
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 员工绩效评估 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">员工绩效评估</h2>
          <select
            value={selectedAgentId || ''}
            onChange={(e) => setSelectedAgentId(e.target.value || null)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">选择Agent查看详细报告</option>
            {activeAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} - {agent.type}
              </option>
            ))}
          </select>
        </div>

        {selectedAgentId && reportLoading && (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        )}

        {selectedAgentId && performanceReport && (
          <PerformanceCard 
            agent={activeAgents.find(a => a.id === selectedAgentId)!} 
            report={performanceReport} 
          />
        )}

        {!selectedAgentId && (
          <div className="text-center py-12 bg-white rounded-lg">
            <AcademicCapIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">选择Agent查看绩效</h3>
            <p className="mt-1 text-sm text-gray-500">从下拉菜单中选择一个Agent查看详细的绩效报告</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default HRManagement;
