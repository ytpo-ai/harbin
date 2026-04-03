import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IncubationProject,
  IncubationProjectDocument,
} from '../schemas/incubation-project.schema';
import { EiRequirement, EiRequirementDocument } from '../schemas/ei-requirement.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../../src/shared/schemas/orchestration-plan.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../../src/shared/schemas/orchestration-run.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../../src/shared/schemas/orchestration-task.schema';
import { Schedule, ScheduleDocument } from '../../../../src/shared/schemas/schedule.schema';
import { Meeting, MeetingDocument } from '../../../../src/shared/schemas/meeting.schema';
import { AgentClientService } from '../../../../src/modules/agents-client/agent-client.service';

@Injectable()
export class IncubationProjectAggregationService {
  constructor(
    @InjectModel(IncubationProject.name)
    private readonly projectModel: Model<IncubationProjectDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly runModel: Model<OrchestrationRunDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(Schedule.name)
    private readonly scheduleModel: Model<ScheduleDocument>,
    @InjectModel(Meeting.name)
    private readonly meetingModel: Model<MeetingDocument>,
    @InjectModel(EiRequirement.name)
    private readonly requirementModel: Model<EiRequirementDocument>,
    private readonly agentClientService: AgentClientService,
  ) {}

  private async assertProjectExists(projectId: string): Promise<void> {
    const exists = await this.projectModel.exists({ _id: projectId });
    if (!exists) {
      throw new NotFoundException(`孵化项目 ${projectId} 不存在`);
    }
  }

  /**
   * 查询项目专属 Agent 列表（通过 AgentClientService HTTP 调用）
   */
  async getProjectAgents(projectId: string): Promise<any[]> {
    await this.assertProjectExists(projectId);
    return this.agentClientService.getAllAgents({ projectId });
  }

  /**
   * 查询项目关联的编排计划
   */
  async getProjectPlans(projectId: string): Promise<OrchestrationPlan[]> {
    await this.assertProjectExists(projectId);
    return this.planModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * 查询项目关联的需求
   */
  async getProjectRequirements(projectId: string): Promise<EiRequirement[]> {
    await this.assertProjectExists(projectId);
    return this.requirementModel.find({ projectId }).sort({ updatedAt: -1 }).exec();
  }

  /**
   * 查询项目关联的定时调度
   */
  async getProjectSchedules(projectId: string): Promise<Schedule[]> {
    await this.assertProjectExists(projectId);
    return this.scheduleModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * 查询项目关联的会议
   */
  async getProjectMeetings(projectId: string): Promise<Meeting[]> {
    await this.assertProjectExists(projectId);
    return this.meetingModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * 项目概览统计
   */
  async getProjectStats(projectId: string): Promise<{
    agents: number;
    plans: { total: number; byStatus: Record<string, number> };
    runs: { total: number; byStatus: Record<string, number> };
    tasks: { total: number; byStatus: Record<string, number> };
    requirements: { total: number; byStatus: Record<string, number> };
    schedules: { total: number; enabled: number };
    meetings: { total: number; byStatus: Record<string, number> };
  }> {
    await this.assertProjectExists(projectId);

    // Agent 数量通过 HTTP 查询
    const agents = await this.agentClientService.getAllAgents({ projectId });

    // Plan 统计
    const planAgg = await this.planModel.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const planByStatus: Record<string, number> = {};
    let planTotal = 0;
    for (const item of planAgg) {
      planByStatus[item._id] = item.count;
      planTotal += item.count;
    }

    // Run 统计
    const runAgg = await this.runModel.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const runByStatus: Record<string, number> = {};
    let runTotal = 0;
    for (const item of runAgg) {
      runByStatus[item._id] = item.count;
      runTotal += item.count;
    }

    // Task 统计
    const taskAgg = await this.taskModel.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const taskByStatus: Record<string, number> = {};
    let taskTotal = 0;
    for (const item of taskAgg) {
      taskByStatus[item._id] = item.count;
      taskTotal += item.count;
    }

    // Requirement 统计
    const reqAgg = await this.requirementModel.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const reqByStatus: Record<string, number> = {};
    let reqTotal = 0;
    for (const item of reqAgg) {
      reqByStatus[item._id] = item.count;
      reqTotal += item.count;
    }

    // Schedule 统计
    const scheduleTotal = await this.scheduleModel.countDocuments({ projectId }).exec();
    const scheduleEnabled = await this.scheduleModel.countDocuments({ projectId, enabled: true }).exec();

    // Meeting 统计
    const meetingAgg = await this.meetingModel.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const meetingByStatus: Record<string, number> = {};
    let meetingTotal = 0;
    for (const item of meetingAgg) {
      meetingByStatus[item._id] = item.count;
      meetingTotal += item.count;
    }

    return {
      agents: agents.length,
      plans: { total: planTotal, byStatus: planByStatus },
      runs: { total: runTotal, byStatus: runByStatus },
      tasks: { total: taskTotal, byStatus: taskByStatus },
      requirements: { total: reqTotal, byStatus: reqByStatus },
      schedules: { total: scheduleTotal, enabled: scheduleEnabled },
      meetings: { total: meetingTotal, byStatus: meetingByStatus },
    };
  }
}
