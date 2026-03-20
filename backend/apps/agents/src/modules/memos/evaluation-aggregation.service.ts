import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { AgentPart, AgentPartDocument } from '../../schemas/agent-part.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { OrchestrationTask, OrchestrationTaskDocument } from '../../../../../src/shared/schemas/orchestration-task.schema';
import { Skill, SkillDocument } from '../../schemas/agent-skill.schema';

interface EvaluationData {
  taskStats: TaskStatistics;
  skillStats: SkillStatistics;
  toolStats: ToolUsageStat[];
  slaMetrics: SlaMetrics;
}

interface TaskStatistics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  completionRate: number;
  avgCompletedDuration?: number;
  recentTasks: RecentTask[];
}

interface RecentTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  result?: {
    summary?: string;
  };
  completedAt?: Date;
}

interface SkillStatistics {
  skills: SkillInfo[];
  proficiencyCount: {
    expert: number;
    advanced: number;
    intermediate: number;
    beginner: number;
  };
}

interface SkillInfo {
  name: string;
  proficiencyLevel: string;
  category: string;
}

interface ToolUsageStat {
  toolId: string;
  usageCount: number;
  successCount: number;
  successRate: number;
}

interface SlaMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  completionRate: number;
  avgResponseTimeSeconds?: number;
}

@Injectable()
export class EvaluationAggregationService {
  private readonly logger = new Logger(EvaluationAggregationService.name);

  constructor(
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
    @InjectModel(AgentPart.name) private readonly partModel: Model<AgentPartDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(OrchestrationTask.name) private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
  ) {}

  async aggregateEvaluation(agentId: string, period?: { start: Date; end: Date }): Promise<void> {
    this.logger.log(`Starting evaluation aggregation for agent: ${agentId}`);

    try {
      const { start, end } = period || this.getCurrentMonth();

      const [taskStats, skillStats, toolStats, slaMetrics] = await Promise.all([
        this.getTaskStatistics(agentId, start, end),
        this.getSkillStatistics(agentId),
        this.getToolUsageStats(agentId, start, end),
        this.getSlaMetrics(agentId, start, end),
      ]);

      const content = this.buildEvaluationContent({ taskStats, skillStats, toolStats, slaMetrics }, start, end);

      await this.updateEvaluationMemo(agentId, content, {
        lastAggregatedAt: new Date().toISOString(),
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
      });

      this.logger.log(`Evaluation aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Evaluation aggregation failed for agent ${agentId}: ${message}`);
      throw error;
    }
  }

  private getCurrentMonth(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }

  private async getTaskStatistics(agentId: string, start: Date, end: Date): Promise<TaskStatistics> {
    const result = await this.taskModel.aggregate([
      {
        $match: {
          'assignment.executorId': agentId,
          'assignment.executorType': 'agent',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgDuration: { $avg: { $subtract: ['$completedAt', '$startedAt'] } },
        },
      },
    ]);

    const statsMap = new Map(result.map((r) => [r._id, r]));

    const completed = statsMap.get('completed')?.count || 0;
    const failed = statsMap.get('failed')?.count || 0;
    const pending = (statsMap.get('pending')?.count || 0) + (statsMap.get('assigned')?.count || 0);
    const inProgress =
      (statsMap.get('in_progress')?.count || 0) +
      (statsMap.get('blocked')?.count || 0) +
      (statsMap.get('waiting_human')?.count || 0);
    const total = completed + failed + pending + inProgress;

    const completedDurations = result.filter((r) => r._id === 'completed' && r.avgDuration);
    const avgCompletedDuration =
      completedDurations.length > 0
        ? Math.round((completedDurations[0].avgDuration || 0) / 1000 / 60)
        : undefined;

    const recentTasksData = await this.taskModel
      .find({
        'assignment.executorId': agentId,
        'assignment.executorType': 'agent',
        status: 'completed',
        createdAt: { $gte: start },
      })
      .sort({ completedAt: -1 })
      .limit(10)
      .exec();

    const recentTasks: RecentTask[] = recentTasksData.map((task) => ({
      id: task.id || '',
      title: task.title,
      priority: task.priority,
      status: task.status,
      result: task.result,
      completedAt: task.completedAt,
    }));

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      avgCompletedDuration,
      recentTasks,
    };
  }

  private async getSkillStatistics(agentId: string): Promise<SkillStatistics> {
    const agent = await this.getAgentDocument(agentId);
    const skillIds = Array.from(new Set((agent?.skills || []).map((item) => String(item || '').trim()).filter(Boolean)));
    if (!skillIds.length) {
      return {
        skills: [],
        proficiencyCount: { expert: 0, advanced: 0, intermediate: 0, beginner: 0 },
      };
    }

    const skills = await this.skillModel.find({ id: { $in: skillIds } }).exec();
    const skillMap = new Map(skills.map((item) => [item.id, item]));

    const skillsWithCategory: SkillInfo[] = skillIds.map((skillId) => {
      const skill = skillMap.get(skillId);
      return {
        name: skill?.name || skillId,
        proficiencyLevel: 'beginner',
        category: skill?.category || 'general',
      };
    });

    const proficiencyCount = {
      expert: skillsWithCategory.filter((s) => s.proficiencyLevel === 'expert').length,
      advanced: skillsWithCategory.filter((s) => s.proficiencyLevel === 'advanced').length,
      intermediate: skillsWithCategory.filter((s) => s.proficiencyLevel === 'intermediate').length,
      beginner: skillsWithCategory.filter((s) => s.proficiencyLevel === 'beginner').length,
    };

    return { skills: skillsWithCategory, proficiencyCount };
  }

  private async getToolUsageStats(
    agentId: string,
    start: Date,
    end: Date,
  ): Promise<ToolUsageStat[]> {
    const runs = await this.runModel
      .find({
        agentId,
        createdAt: { $gte: start, $lte: end },
        status: { $in: ['completed', 'failed'] },
      })
      .exec();

    const runIds = runs.map((r) => r.id);

    if (runIds.length === 0) {
      return [];
    }

    const toolResults = await this.partModel
      .find({
        runId: { $in: runIds },
        type: 'tool_result',
      })
      .exec();

    const toolMap = new Map<string, { total: number; success: number }>();

    for (const part of toolResults) {
      const toolId = part.toolId || 'unknown';
      const existing = toolMap.get(toolId) || { total: 0, success: 0 };
      existing.total += 1;

      if (part.status === 'completed' && !part.error) {
        existing.success += 1;
      }

      toolMap.set(toolId, existing);
    }

    return Array.from(toolMap.entries())
      .map(([toolId, stats]) => ({
        toolId,
        usageCount: stats.total,
        successCount: stats.success,
        successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0,
      }))
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  private async getSlaMetrics(agentId: string, start: Date, end: Date): Promise<SlaMetrics> {
    const runs = await this.runModel
      .find({
        agentId,
        createdAt: { $gte: start, $lte: end },
      })
      .exec();

    const totalTasks = runs.length;
    const completedTasks = runs.filter((r) => r.status === 'completed').length;
    const failedTasks = runs.filter((r) => r.status === 'failed').length;

    const runsWithDuration = runs.filter((r) => r.startedAt && r.finishedAt);
    const totalDuration = runsWithDuration.reduce((sum, r) => {
      const duration = new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime();
      return sum + duration;
    }, 0);
    const avgResponseTimeSeconds =
      runsWithDuration.length > 0 ? Math.round(totalDuration / runsWithDuration.length / 1000) : undefined;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      avgResponseTimeSeconds,
    };
  }

  private buildEvaluationContent(data: EvaluationData, start: Date, end: Date): string {
    const { taskStats, skillStats, toolStats, slaMetrics } = data;

    const lines: string[] = [];

    lines.push('# 工作评估', '');

    const periodStr = `${start.toLocaleDateString('zh-CN')} ~ ${end.toLocaleDateString('zh-CN')}`;
    lines.push(`**评估周期**：${periodStr}`, '');

    lines.push('## 任务统计', '');

    lines.push('### 任务完成情况', '');
    lines.push(`- **总任务数**：${taskStats.total}`);
    lines.push(`- **完成数**：${taskStats.completed}`);
    lines.push(`- **失败数**：${taskStats.failed}`);
    lines.push(`- **进行中**：${taskStats.inProgress}`);
    lines.push(`- **待处理**：${taskStats.pending}`);
    lines.push(`- **完成率**：${taskStats.completionRate}%`);
    if (taskStats.avgCompletedDuration) {
      lines.push(`- **平均完成时间**：${taskStats.avgCompletedDuration} 分钟`);
    }
    lines.push('');

    if (taskStats.recentTasks.length > 0) {
      lines.push('### 最近完成任务', '');
      lines.push('| 任务 | 优先级 | 完成时间 | 状态 | 结果摘要 |');
      lines.push('|-----|--------|---------|------|---------|');

      for (const task of taskStats.recentTasks) {
        const priorityMap: Record<string, string> = {
          low: '低',
          medium: '中',
          high: '高',
          urgent: '紧急',
        };
        const priority = priorityMap[task.priority] || task.priority;
        const date = task.completedAt ? new Date(task.completedAt).toLocaleDateString('zh-CN') : 'N/A';
        const summary = task.result?.summary ? this.compact(task.result.summary, 40) : '-';
        lines.push(`| ${this.compact(task.title, 30)} | ${priority} | ${date} | ${task.status} | ${summary} |`);
      }
      lines.push('');
    }

    lines.push('## 技能统计', '');

    if (skillStats.skills.length > 0) {
      lines.push('### 技能分布', '');
      lines.push('| 技能名称 | 熟练度 | 类别 |');
      lines.push('|---------|--------|------|');

      for (const skill of skillStats.skills) {
        const levelMap: Record<string, string> = {
          beginner: '初级',
          intermediate: '中级',
          advanced: '高级',
          expert: '专家',
        };
        const level = levelMap[skill.proficiencyLevel] || skill.proficiencyLevel;
        lines.push(`| ${skill.name} | ${level} | ${skill.category} |`);
      }
      lines.push('');

      lines.push('### 技能统计', '');
      lines.push(`- **总技能数**：${skillStats.skills.length}`);
      lines.push(`- 专家级：${skillStats.proficiencyCount.expert}`);
      lines.push(`- 高级：${skillStats.proficiencyCount.advanced}`);
      lines.push(`- 中级：${skillStats.proficiencyCount.intermediate}`);
      lines.push(`- 初级：${skillStats.proficiencyCount.beginner}`, '');
    } else {
      lines.push('暂无绑定技能', '');
    }

    lines.push('## 工具使用统计', '');

    if (toolStats.length > 0) {
      lines.push('| 工具 | 使用次数 | 成功次数 | 成功率 |');
      lines.push('|-----|---------|---------|--------|');

      for (const stat of toolStats) {
        lines.push(`| ${stat.toolId} | ${stat.usageCount} | ${stat.successCount} | ${stat.successRate}% |`);
      }
      lines.push('');
    } else {
      lines.push('暂无工具使用记录', '');
    }

    lines.push('## SLA 响应指标', '');
    lines.push(`- **总任务数**：${slaMetrics.totalTasks}`);
    lines.push(`- **完成数**：${slaMetrics.completedTasks}`);
    lines.push(`- **失败数**：${slaMetrics.failedTasks}`);
    lines.push(`- **完成率**：${slaMetrics.completionRate}%`);
    if (slaMetrics.avgResponseTimeSeconds !== undefined) {
      lines.push(`- **平均响应时间**：${slaMetrics.avgResponseTimeSeconds} 秒`);
    }
    lines.push('');

    lines.push('## 元信息', '');
    lines.push(`- version: ${Date.now()}`);
    lines.push(`- lastAggregatedAt: ${new Date().toISOString()}`);
    lines.push(`- period: ${periodStr}`);
    lines.push(`- sources: [orchestration_tasks, agent.skills, agent_runs, agent_parts]`);

    return lines.join('\n');
  }

  private compact(text: string, maxLength: number): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, Math.max(0, maxLength - 3)) + '...';
  }

  private async getAgentDocument(agentId: string): Promise<AgentDocument | null> {
    let agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      agent = await this.agentModel.findOne({ id: agentId }).exec();
    }
    return agent;
  }

  private async updateEvaluationMemo(
    agentId: string,
    content: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const period = metadata.period;
    const periodKey = period ? `${period.start.slice(0, 7)}` : new Date().toISOString().slice(0, 7);
    const slug = `evaluation-${periodKey}`;

    const existing = await this.memoModel.findOne({ agentId, slug }).exec();
    const now = new Date();

    if (existing) {
      const nextVersion = Math.max(1, Number(existing.version || 1)) + 1;
      await this.memoModel
        .findOneAndUpdate(
          { id: existing.id },
          {
            $set: {
              content,
              version: nextVersion,
              payload: {
                topic: 'evaluation',
                ...metadata,
              },
              tags: ['evaluation', 'metrics'],
              contextKeywords: ['evaluation', 'tool', 'sla', 'metric', 'task', 'skill'],
              source: 'evaluation-aggregator',
              updatedAt: now,
            },
          },
          { new: true },
        )
        .exec();
    } else {
      await this.memoModel
        .create({
          id: uuidv4(),
          agentId,
          title: `工作评估 ${periodKey}`,
          slug,
          content,
          version: 1,
          memoKind: 'evaluation',
          memoType: 'standard',
          payload: {
            topic: 'evaluation',
            ...metadata,
          },
          tags: ['evaluation', 'metrics'],
          contextKeywords: ['evaluation', 'tool', 'sla', 'metric', 'task', 'skill'],
          source: 'evaluation-aggregator',
          createdAt: now,
          updatedAt: now,
        })
        .catch((err) => {
          if (err.code === 11000) {
            this.logger.warn(`Evaluation memo already exists for agent ${agentId} period ${periodKey}, skipping`);
          } else {
            throw err;
          }
        });
    }
  }
}
