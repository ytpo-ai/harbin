import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument, EmployeeStatus } from '../../shared/schemas/employee.schema';
import { ToolClientService } from '../tools-client/tool-client.service';
import { TaskService } from '../tasks/task.service';

@Injectable()
export class HRService {
  private readonly logger = new Logger(HRService.name);

  constructor(
    @InjectModel(Employee.name) private readonly employeeModel: Model<EmployeeDocument>,
    private readonly toolClientService: ToolClientService,
    private readonly taskService: TaskService,
  ) {}

  async generatePerformanceReport(agentId: string): Promise<any> {
    const employee = await this.employeeModel.findOne({ agentId }).exec();
    if (!employee) {
      throw new Error(`Agent ${agentId} is not an employee`);
    }

    const tasks = await this.taskService.getAllTasks();
    const agentTasks = tasks.filter((task) => task.assignedAgents.includes(agentId));
    const completedTasks = agentTasks.filter((task) => task.status === 'completed');
    const taskCompletionRate = agentTasks.length > 0 ? (completedTasks.length / agentTasks.length) * 100 : 0;

    const toolExecutions = await this.toolClientService.getToolExecutions(agentId);
    const totalTokenConsumption = toolExecutions.reduce((sum, exec) => sum + exec.tokenCost, 0);
    const totalExecutionCost = toolExecutions.length * 50;

    const latestPerformance = employee.performance;
    const performanceKpis = {
      taskCompletionRate: Math.round(taskCompletionRate * 100) / 100,
      codeQuality: latestPerformance?.codeQuality ?? 75,
      collaboration: latestPerformance?.collaboration ?? 80,
      innovation: latestPerformance?.innovation ?? 70,
      efficiency: this.calculateEfficiency(completedTasks.length, totalTokenConsumption),
    };

    const overallScore =
      performanceKpis.taskCompletionRate * 0.3 +
      performanceKpis.codeQuality * 0.25 +
      performanceKpis.collaboration * 0.2 +
      performanceKpis.innovation * 0.15 +
      performanceKpis.efficiency * 0.1;

    return {
      agentId,
      evaluationDate: new Date(),
      employeeInfo: {
        role: employee.role,
        department: employee.departmentId,
        joinDate: employee.joinDate,
        status: employee.status,
        salary: employee.salary,
        stockOptions: employee.stockOptions,
      },
      kpis: performanceKpis,
      overallScore: Math.round(overallScore * 100) / 100,
      taskStats: {
        totalAssigned: agentTasks.length,
        completed: completedTasks.length,
        inProgress: agentTasks.filter((task) => task.status === 'in_progress').length,
        failed: agentTasks.filter((task) => task.status === 'failed').length,
        completionRate: Math.round(taskCompletionRate * 100) / 100,
      },
      toolUsage: {
        totalExecutions: toolExecutions.length,
        totalTokenConsumption,
        totalCost: totalExecutionCost,
        avgCostPerExecution: toolExecutions.length > 0 ? totalExecutionCost / toolExecutions.length : 0,
        mostUsedTool: this.getMostUsedTool(toolExecutions),
      },
      tokenConsumption: {
        total: totalTokenConsumption,
        cost: totalExecutionCost,
      },
      completedTasks: completedTasks.length,
      earnings: (employee.salary || 0) * 12,
      recommendations: this.generateRecommendations(overallScore, performanceKpis, employee),
    };
  }

  async identifyLowPerformers(): Promise<any[]> {
    const activeEmployees = await this.employeeModel.find({ status: EmployeeStatus.ACTIVE }).exec();
    const lowPerformers: any[] = [];
    const settings = {
      minPerformanceScore: 60,
      maxTokenConsumption: 10000,
    };

    for (const employee of activeEmployees) {
      if (!employee.agentId) {
        continue;
      }

      const report = await this.generatePerformanceReport(employee.agentId);
      const reasons: string[] = [];

      if (report.overallScore < settings.minPerformanceScore) {
        reasons.push(`整体绩效分数低于阈值 (${report.overallScore} < ${settings.minPerformanceScore})`);
      }
      if (report.tokenConsumption.total > settings.maxTokenConsumption) {
        reasons.push(`Token消耗过高 (${report.tokenConsumption.total} > ${settings.maxTokenConsumption})`);
      }
      if (report.taskStats.completionRate < 50) {
        reasons.push(`任务完成率过低 (${report.taskStats.completionRate}% < 50%)`);
      }

      if (reasons.length > 0) {
        lowPerformers.push({
          agentId: employee.agentId,
          report,
          terminationRisks: reasons,
          recommendedActions: this.generateTerminationActions(report),
        });
      }
    }

    return lowPerformers;
  }

  async recommendHiring(): Promise<any[]> {
    const recommendations: any[] = [];
    const tasks = await this.taskService.getAllTasks();
    const backlogTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress');

    if (backlogTasks.length > 20) {
      recommendations.push({
        type: 'workload',
        currentBacklog: backlogTasks.length,
        recommendedNewHires: Math.ceil(backlogTasks.length / 10),
        suggestedRoles: ['junior', 'senior'],
        priority: 'high',
      });
    }

    const departmentStats = await this.employeeModel.aggregate([
      { $match: { status: EmployeeStatus.ACTIVE, departmentId: { $exists: true, $ne: null } } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    for (const item of departmentStats.slice(0, 3)) {
      if (item.count >= 5) {
        recommendations.push({
          type: 'department-balance',
          department: item._id,
          currentEmployees: item.count,
          suggestedRoles: ['junior'],
          priority: 'medium',
        });
      }
    }

    return recommendations;
  }

  async calculateTeamHealth(): Promise<any> {
    const activeEmployees = await this.employeeModel.find({ status: EmployeeStatus.ACTIVE }).exec();
    const agentEmployees = activeEmployees.filter((employee) => !!employee.agentId);

    if (agentEmployees.length === 0) {
      return null;
    }

    const reports = await Promise.all(agentEmployees.map((employee) => this.generatePerformanceReport(employee.agentId!)));

    const overallHealth = {
      overallScore: reports.reduce((sum, report) => sum + report.overallScore, 0) / reports.length,
      avgTaskCompletionRate: reports.reduce((sum, report) => sum + report.taskStats.completionRate, 0) / reports.length,
      avgTokenConsumption: reports.reduce((sum, report) => sum + report.tokenConsumption.total, 0) / reports.length,
      avgEfficiency: reports.reduce((sum, report) => sum + report.kpis.efficiency, 0) / reports.length,
      totalCost: reports.reduce((sum, report) => sum + report.tokenConsumption.cost, 0),
      totalEarnings: reports.reduce((sum, report) => sum + report.earnings, 0),
      roi: 0,
    };

    overallHealth.roi =
      overallHealth.totalCost > 0
        ? ((overallHealth.totalEarnings - overallHealth.totalCost) / overallHealth.totalCost) * 100
        : 0;

    const healthGrade =
      overallHealth.overallScore >= 85
        ? 'excellent'
        : overallHealth.overallScore >= 75
          ? 'good'
          : overallHealth.overallScore >= 65
            ? 'fair'
            : 'poor';

    return {
      grade: healthGrade,
      metrics: overallHealth,
      employeeCount: agentEmployees.length,
      highPerformers: reports.filter((report) => report.overallScore >= 85).length,
      averagePerformers: reports.filter((report) => report.overallScore >= 65 && report.overallScore < 85).length,
      lowPerformers: reports.filter((report) => report.overallScore < 65).length,
      recommendations: this.generateTeamHealthRecommendations(overallHealth, healthGrade),
    };
  }

  private calculateEfficiency(completedTasks: number, totalTokenConsumption: number): number {
    const efficiency = completedTasks / Math.max(totalTokenConsumption / 1000, 1);
    return Math.min(Math.round(efficiency * 100 * 10) / 10, 100);
  }

  private getMostUsedTool(toolExecutions: any[]): string {
    if (toolExecutions.length === 0) {
      return 'N/A';
    }

    const toolCounts = toolExecutions.reduce<Record<string, number>>((acc, execution) => {
      acc[execution.toolId] = (acc[execution.toolId] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private generateRecommendations(score: number, kpis: any, employee: Employee): string[] {
    const recommendations: string[] = [];

    if (score < 60) recommendations.push('整体绩效偏低，建议制定详细改进计划');
    else if (score < 75) recommendations.push('绩效中等，有改进空间');
    else if (score >= 90) recommendations.push('优秀表现，考虑晋升或增加责任');

    if (kpis.taskCompletionRate < 70) recommendations.push('任务完成率偏低，建议时间管理和优先级排序培训');
    if (kpis.codeQuality < 75) recommendations.push('代码质量需要提升，建议代码审查和最佳实践培训');
    if (kpis.collaboration < 80) recommendations.push('团队协作能力有待加强，建议参与更多团队活动');
    if (kpis.innovation < 70) recommendations.push('创新能力需要培养，鼓励提出新想法和解决方案');
    if (kpis.efficiency < 60) recommendations.push('工作效率偏低，建议优化工具使用和 workflows');

    if (employee.status === EmployeeStatus.PROBATION && score < 75) {
      recommendations.push('试用期内表现未达标，需要重点关注和指导');
    }

    return recommendations;
  }

  private generateTerminationActions(report: any): string[] {
    const actions: string[] = [];

    if (report.overallScore < 40) {
      actions.push('建议立即终止雇佣关系');
    } else if (report.overallScore < 60) {
      actions.push('给予最后一次改进机会，设定明确目标');
      actions.push('考虑降薪或调整岗位职责');
    } else {
      actions.push('提供培训和发展支持');
      actions.push('安排绩效改进计划');
    }

    if (report.tokenConsumption.total > 10000) {
      actions.push('限制工具使用权限');
    }
    if (report.taskStats.completionRate < 60) {
      actions.push('重新分配任务或调整工作负荷');
    }

    return actions;
  }

  private generateTeamHealthRecommendations(health: any, grade: string): string[] {
    const recommendations: string[] = [];

    if (health.totalCost > health.totalEarnings) recommendations.push('运营成本过高，需要优化资源使用');
    if (health.avgTaskCompletionRate < 75) recommendations.push('团队整体任务完成率偏低，需要项目管理改进');
    if (health.avgEfficiency < 70) recommendations.push('团队工作效率有待提升，考虑流程优化');

    if (grade === 'poor') {
      recommendations.push('团队健康状况不佳，建议重组或重大变革');
      recommendations.push('考虑淘汰表现最差的员工');
    } else if (grade === 'fair') {
      recommendations.push('团队表现中等，需要针对性改进');
    } else if (grade === 'good') {
      recommendations.push('团队表现良好，继续保持现有策略');
    } else {
      recommendations.push('团队表现优秀，考虑扩张规模');
    }

    return recommendations;
  }
}
