import { Injectable, Logger } from '@nestjs/common';
import { OrganizationService } from '../organization/organization.service';
import { ToolService } from '../tools/tool.service';
import { TaskService } from '../tasks/task.service';

@Injectable()
export class HRService {
  private readonly logger = new Logger(HRService.name);

  constructor(
    private readonly organizationService: OrganizationService,
    private readonly toolService: ToolService,
    private readonly taskService: TaskService
  ) {}

  async generatePerformanceReport(agentId: string): Promise<any> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    const employee = organization.employees.find(e => e.agentId === agentId);
    if (!employee) {
      throw new Error(`Agent ${agentId} is not an employee`);
    }

    // 获取任务完成统计
    const tasks = await this.taskService.getAllTasks();
    const agentTasks = tasks.filter(t => t.assignedAgents.includes(agentId));
    
    const completedTasks = agentTasks.filter(t => t.status === 'completed');
    const taskCompletionRate = agentTasks.length > 0 ? (completedTasks.length / agentTasks.length) * 100 : 0;

    // 获取工具使用统计
    const toolExecutions = await this.toolService.getToolExecutions(agentId);
    const totalTokenConsumption = toolExecutions.reduce((sum, exec) => sum + exec.tokenCost, 0);
    const totalExecutionCost = toolExecutions.length * 50; // 假设每个执行平均成本50

    // 计算绩效KPI
    const performanceKpis = {
      taskCompletionRate: Math.round(taskCompletionRate * 100) / 100,
      codeQuality: employee.performance.length > 0 ? 
        employee.performance[employee.performance.length - 1].kpis.codeQuality : 75,
      collaboration: employee.performance.length > 0 ? 
        employee.performance[employee.performance.length - 1].kpis.collaboration : 80,
      innovation: employee.performance.length > 0 ? 
        employee.performance[employee.performance.length - 1].kpis.innovation : 70,
      efficiency: this.calculateEfficiency(employee, completedTasks.length, totalTokenConsumption)
    };

    // 计算整体绩效分数
    const overallScore = (
      performanceKpis.taskCompletionRate * 0.3 +
      performanceKpis.codeQuality * 0.25 +
      performanceKpis.collaboration * 0.2 +
      performanceKpis.innovation * 0.15 +
      performanceKpis.efficiency * 0.1
    );

    return {
      agentId,
      evaluationDate: new Date(),
      employeeInfo: {
        role: organization.roles.find(r => r.id === employee.roleId)?.title,
        department: organization.roles.find(r => r.id === employee.roleId)?.department,
        joinDate: employee.joinDate,
        status: employee.status,
        salary: employee.salary,
        stockOptions: employee.stockOptions
      },
      kpis: performanceKpis,
      overallScore: Math.round(overallScore * 100) / 100,
      taskStats: {
        totalAssigned: agentTasks.length,
        completed: completedTasks.length,
        inProgress: agentTasks.filter(t => t.status === 'in_progress').length,
        failed: agentTasks.filter(t => t.status === 'failed').length,
        completionRate: Math.round(taskCompletionRate * 100) / 100
      },
      toolUsage: {
        totalExecutions: toolExecutions.length,
        totalTokenConsumption,
        totalCost: totalExecutionCost,
        avgCostPerExecution: toolExecutions.length > 0 ? totalExecutionCost / toolExecutions.length : 0,
        mostUsedTool: this.getMostUsedTool(toolExecutions)
      },
      tokenConsumption: {
        total: totalTokenConsumption,
        cost: totalExecutionCost
      },
      completedTasks: completedTasks.length,
      earnings: employee.salary * 12, // 年薪
      recommendations: this.generateRecommendations(overallScore, performanceKpis, employee)
    };
  }

  private calculateEfficiency(employee: any, completedTasks: number, totalTokenConsumption: number): number {
    // 效率 = 完成任务数量 / (token消耗 / 1000 + 1)
    const efficiency = completedTasks / Math.max(totalTokenConsumption / 1000, 1);
    return Math.min(Math.round(efficiency * 100 * 10) / 10, 100); // 最大值限制为100
  }

  private getMostUsedTool(toolExecutions: any[]): string {
    if (toolExecutions.length === 0) return 'N/A';
    
    const toolCounts = toolExecutions.reduce((acc, exec) => {
      acc[exec.toolId] = (acc[exec.toolId] || 0) + 1;
      return acc;
    }, {});

    const mostUsed = Object.entries(toolCounts).reduce((a, b) => 
      toolCounts[a[0] as string] > toolCounts[b[0] as string] ? a : b
    );

    return mostUsed[0] as string;
  }

  private generateRecommendations(score: number, kpis: any, employee: any): string[] {
    const recommendations: string[] = [];

    if (score < 60) {
      recommendations.push('整体绩效偏低，建议制定详细改进计划');
    } else if (score < 75) {
      recommendations.push('绩效中等，有改进空间');
    } else if (score >= 90) {
      recommendations.push('优秀表现，考虑晋升或增加责任');
    }

    if (kpis.taskCompletionRate < 70) {
      recommendations.push('任务完成率偏低，建议时间管理和优先级排序培训');
    }

    if (kpis.codeQuality < 75) {
      recommendations.push('代码质量需要提升，建议代码审查和最佳实践培训');
    }

    if (kpis.collaboration < 80) {
      recommendations.push('团队协作能力有待加强，建议参与更多团队活动');
    }

    if (kpis.innovation < 70) {
      recommendations.push('创新能力需要培养，鼓励提出新想法和解决方案');
    }

    if (kpis.efficiency < 60) {
      recommendations.push('工作效率偏低，建议优化工具使用和 workflows');
    }

    if (employee.status === 'probation' && score < 75) {
      recommendations.push('试用期内表现未达标，需要重点关注和指导');
    }

    return recommendations;
  }

  async identifyLowPerformers(): Promise<any[]> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      return [];
    }

    const activeEmployees = organization.employees.filter(e => e.status === 'active');
    const lowPerformers: any[] = [];

    for (const employee of activeEmployees) {
      const report = await this.generatePerformanceReport(employee.agentId);
      const settings = organization.settings.performanceThresholds;

      // 检查各项指标
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
          recommendedActions: this.generateTerminationActions(report, reasons)
        });
      }
    }

    return lowPerformers;
  }

  private generateTerminationActions(report: any, reasons: string[]): string[] {
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

  async recommendHiring(): Promise<any[]> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      return [];
    }

    const recommendations: any[] = [];

    // 分析各部门需求
    for (const department of organization.departments) {
      const currentEmployees = organization.employees.filter(e => {
        const role = organization.roles.find(r => r.id === e.roleId);
        return role?.department === department.id && e.status === 'active';
      });

      const departmentRoles = organization.roles.filter(r => r.department === department.id);
      const requiredCapacity = departmentRoles.reduce((sum, role) => sum + (role.maxEmployees || 0), 0);
      const utilization = (currentEmployees.length / requiredCapacity) * 100;

      if (utilization > 80) {
        recommendations.push({
          type: 'expansion',
          department: department.name,
          currentEmployees: currentEmployees.length,
          maxCapacity: requiredCapacity,
          utilization: Math.round(utilization * 100) / 100,
          suggestedRoles: departmentRoles.filter(r => {
            const currentInRole = organization.employees.filter(e => e.roleId === r.id && e.status === 'active').length;
            return currentInRole < (r.maxEmployees || Infinity);
          }).map(r => ({
            roleId: r.id,
            title: r.title,
            currentCount: organization.employees.filter(e => e.roleId === r.id && e.status === 'active').length,
            maxCount: r.maxEmployees,
            salaryRange: r.salaryRange
          })),
          priority: utilization > 95 ? 'high' : 'medium'
        });
      }
    }

    // 根据工作负荷推荐
    const tasks = await this.taskService.getAllTasks();
    const backlogTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    
    if (backlogTasks.length > 20) {
      recommendations.push({
        type: 'workload',
        currentBacklog: backlogTasks.length,
        recommendedNewHires: Math.ceil(backlogTasks.length / 10),
        suggestedRoles: ['junior-developer', 'data-analyst'],
        priority: 'high'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority as keyof typeof priorityOrder] || 0) - 
             (priorityOrder[a.priority as keyof typeof priorityOrder] || 0);
    });
  }

  async calculateTeamHealth(): Promise<any> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      return null;
    }

    const activeEmployees = organization.employees.filter(e => e.status === 'active');
    const reports = await Promise.all(
      activeEmployees.map(e => this.generatePerformanceReport(e.agentId))
    );

    const overallHealth = {
      overallScore: reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length,
      avgTaskCompletionRate: reports.reduce((sum, r) => sum + r.taskStats.completionRate, 0) / reports.length,
      avgTokenConsumption: reports.reduce((sum, r) => sum + r.tokenConsumption.total, 0) / reports.length,
      avgEfficiency: reports.reduce((sum, r) => sum + r.kpis.efficiency, 0) / reports.length,
      totalCost: reports.reduce((sum, r) => sum + r.tokenConsumption.cost, 0),
      totalEarnings: reports.reduce((sum, r) => sum + r.earnings, 0),
      roi: 0 // 将在下面计算
    };

    overallHealth.roi = ((overallHealth.totalEarnings - overallHealth.totalCost) / overallHealth.totalCost) * 100;

    // 计算健康等级
    let healthGrade: 'excellent' | 'good' | 'fair' | 'poor';
    if (overallHealth.overallScore >= 85) {
      healthGrade = 'excellent';
    } else if (overallHealth.overallScore >= 75) {
      healthGrade = 'good';
    } else if (overallHealth.overallScore >= 65) {
      healthGrade = 'fair';
    } else {
      healthGrade = 'poor';
    }

    return {
      grade: healthGrade,
      metrics: overallHealth,
      employeeCount: activeEmployees.length,
      highPerformers: reports.filter(r => r.overallScore >= 85).length,
      averagePerformers: reports.filter(r => r.overallScore >= 65 && r.overallScore < 85).length,
      lowPerformers: reports.filter(r => r.overallScore < 65).length,
      recommendations: this.generateTeamHealthRecommendations(overallHealth, healthGrade)
    };
  }

  private generateTeamHealthRecommendations(health: any, grade: string): string[] {
    const recommendations: string[] = [];

    if (health.totalCost > health.totalEarnings) {
      recommendations.push('运营成本过高，需要优化资源使用');
    }

    if (health.avgTaskCompletionRate < 75) {
      recommendations.push('团队整体任务完成率偏低，需要项目管理改进');
    }

    if (health.avgEfficiency < 70) {
      recommendations.push('团队工作效率有待提升，考虑流程优化');
    }

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