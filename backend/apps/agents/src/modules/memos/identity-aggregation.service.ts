import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentSkill, AgentSkillDocument } from '../../schemas/agent-skill.schema';
import { Skill, SkillDocument } from '../../schemas/skill.schema';
import { OrchestrationTask, OrchestrationTaskDocument } from '../../../../../src/shared/schemas/orchestration-task.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';

interface IdentityData {
  agent: AgentBasicInfo;
  skills: SkillInfo[];
  taskStats: TaskStatistics;
  recentTasks: RecentTask[];
}

interface AgentBasicInfo {
  name: string;
  type: string;
  role?: string;
  description: string;
  systemPromptSummary: string;
  tools: string[];
  capabilities: string[];
  personality: {
    workEthic: number;
    creativity: number;
    leadership: number;
    teamwork: number;
  };
  learningAbility: number;
  isActive: boolean;
  createdAt: Date;
}

interface SkillInfo {
  name: string;
  proficiencyLevel: string;
  assignedBy: string;
  assignedAt: Date;
  category: string;
}

interface TaskStatistics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  completionRate: number;
  avgCompletedDuration?: number;
}

interface RecentTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  result?: {
    summary?: string;
    output?: string;
    error?: string;
  };
  startedAt?: Date;
  completedAt?: Date;
}

@Injectable()
export class IdentityAggregationService {
  private readonly logger = new Logger(IdentityAggregationService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentSkill.name) private readonly agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(OrchestrationTask.name) private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
  ) {}

  async aggregateIdentity(agentId: string): Promise<void> {
    this.logger.log(`Starting identity aggregation for agent: ${agentId}`);

    try {
      const [agentBasic, skills, taskStats, recentTasks] = await Promise.all([
        this.getAgentBasicInfo(agentId),
        this.getAgentSkills(agentId),
        this.getTaskStatistics(agentId),
        this.getRecentTasks(agentId, 30),
      ]);

      const content = this.buildIdentityContent({
        agent: agentBasic,
        skills,
        taskStats,
        recentTasks,
      });

      await this.updateIdentityMemo(agentId, content, {
        lastAggregatedAt: new Date().toISOString(),
        sources: ['agent', 'agent_skills', 'orchestration_tasks'],
      });

      this.logger.log(`Identity aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Identity aggregation failed for agent ${agentId}: ${message}`);
      throw error;
    }
  }

  private async getAgentBasicInfo(agentId: string): Promise<AgentBasicInfo> {
    const agent = await this.agentModel.findOne({ id: agentId }).exec();
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return {
      name: agent.name,
      type: agent.type,
      role: agent.role,
      description: agent.description,
      systemPromptSummary: agent.systemPrompt?.slice(0, 200) || '',
      tools: agent.tools || [],
      capabilities: agent.capabilities || [],
      personality: agent.personality || {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80,
      },
      learningAbility: agent.learningAbility || 80,
      isActive: agent.isActive !== false,
      createdAt: agent.createdAt || new Date(),
    };
  }

  private async getAgentSkills(agentId: string): Promise<SkillInfo[]> {
    const assignments = await this.agentSkillModel.find({ agentId, enabled: true }).exec();
    if (assignments.length === 0) {
      return [];
    }

    const skillIds = assignments.map((a) => a.skillId);
    const skills = await this.skillModel.find({ id: { $in: skillIds } }).exec();
    const skillMap = new Map(skills.map((s) => [s.id, s]));

    return assignments.map((assignment) => {
      const skill = skillMap.get(assignment.skillId);
      return {
        name: skill?.name || assignment.skillId,
        proficiencyLevel: assignment.proficiencyLevel || 'beginner',
        assignedBy: assignment.assignedBy || 'system',
        assignedAt: (assignment as any).createdAt || new Date(),
        category: skill?.category || 'general',
      };
    });
  }

  private async getTaskStatistics(agentId: string): Promise<TaskStatistics> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.orchestrationTaskModel.aggregate([
      {
        $match: {
          'assignment.executorId': agentId,
          'assignment.executorType': 'agent',
          createdAt: { $gte: thirtyDaysAgo },
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

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      avgCompletedDuration,
    };
  }

  private async getRecentTasks(agentId: string, days: number): Promise<RecentTask[]> {
    const thirtyDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const tasks = await this.orchestrationTaskModel
      .find({
        'assignment.executorId': agentId,
        'assignment.executorType': 'agent',
        status: { $in: ['completed', 'failed'] },
        createdAt: { $gte: thirtyDaysAgo },
      })
      .sort({ completedAt: -1, createdAt: -1 })
      .limit(20)
      .exec();

    return tasks.map((task) => ({
      id: task.id || '',
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      result: task.result,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    }));
  }

  private buildIdentityContent(data: IdentityData): string {
    const { agent, skills, taskStats, recentTasks } = data;

    const lines: string[] = [];

    lines.push('# 身份与职责', '');
    lines.push('## Agent Profile', '');
    lines.push(`- **角色**：${agent.role || '待补充'}`);
    lines.push(`- **类型**：${agent.type}`);
    lines.push(`- **描述**：${agent.description || '待补充'}`);
    lines.push(`- **系统提示词摘要**：${agent.systemPromptSummary || '待补充'}`);
    lines.push(
      `- **创建时间**：${agent.createdAt ? new Date(agent.createdAt).toLocaleDateString('zh-CN') : '待补充'}`,
    );
    lines.push(`- **激活状态**：${agent.isActive ? '是' : '否'}`, '');
    lines.push('', '## 技能矩阵', '');

    if (skills.length > 0) {
      lines.push('### 已绑定技能', '');
      lines.push('| 技能名称 | 熟练度 | 绑定时间 | 来源 | 领域 |');
      lines.push('|---------|--------|---------|------|------|');

      for (const skill of skills) {
        const levelMap: Record<string, string> = {
          beginner: '初级',
          intermediate: '中级',
          advanced: '高级',
          expert: '专家',
        };
        const level = levelMap[skill.proficiencyLevel] || skill.proficiencyLevel;
        const date = skill.assignedAt ? new Date(skill.assignedAt).toLocaleDateString('zh-CN') : 'N/A';
        lines.push(`| ${skill.name} | ${level} | ${date} | ${skill.assignedBy} | ${skill.category} |`);
      }
      lines.push('');

      const levelCount = {
        expert: skills.filter((s) => s.proficiencyLevel === 'expert').length,
        advanced: skills.filter((s) => s.proficiencyLevel === 'advanced').length,
        intermediate: skills.filter((s) => s.proficiencyLevel === 'intermediate').length,
        beginner: skills.filter((s) => s.proficiencyLevel === 'beginner').length,
      };
      lines.push('### 技能统计', '');
      lines.push(`- **总技能数**：${skills.length}`);
      lines.push(`- 专家级：${levelCount.expert}`);
      lines.push(`- 高级：${levelCount.advanced}`);
      lines.push(`- 中级：${levelCount.intermediate}`);
      lines.push(`- 初级：${levelCount.beginner}`, '');
    } else {
      lines.push('暂无绑定技能', '');
    }

    lines.push('## 能力域', '');
    lines.push(`- **主要领域**：${this.extractDomains(skills)}`);
    lines.push(`- **工具集**：${agent.tools.length > 0 ? agent.tools.join(', ') : '待补充'}`);
    lines.push(
      `- **模型能力**：${agent.capabilities.length > 0 ? agent.capabilities.join(', ') : '待补充'}`,
      '',
    );

    lines.push('## 工作风格', '');
    lines.push(`- 工作伦理：${agent.personality.workEthic}/100`);
    lines.push(`- 创造力：${agent.personality.creativity}/100`);
    lines.push(`- 领导力：${agent.personality.leadership}/100`);
    lines.push(`- 团队协作：${agent.personality.teamwork}/100`);
    lines.push(`- 学习能力：${agent.learningAbility}/100`, '');

    lines.push('## 任务履历', '');
    lines.push('### 任务统计（近30天）', '');
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

    if (recentTasks.length > 0) {
      lines.push('### 最近完成任务', '');
      lines.push('| 任务 | 优先级 | 完成时间 | 状态 | 结果摘要 |');
      lines.push('|-----|--------|---------|------|---------|');

      for (const task of recentTasks.slice(0, 10)) {
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

    lines.push('## 元信息', '');
    lines.push(`- version: ${Date.now()}`);
    lines.push(`- lastAggregatedAt: ${new Date().toISOString()}`);
    lines.push(`- sources: [agent, agent_skills, orchestration_tasks]`);

    return lines.join('\n');
  }

  private extractDomains(skills: SkillInfo[]): string {
    const categories = [...new Set(skills.map((s) => s.category).filter(Boolean))];
    return categories.length > 0 ? categories.join(', ') : '待补充';
  }

  private compact(text: string, maxLength: number): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, Math.max(0, maxLength - 3)) + '...';
  }

  private async updateIdentityMemo(
    agentId: string,
    content: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    const existing = await this.memoModel.findOne({ agentId, memoKind: 'identity' }).exec();
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
                topic: 'identity',
                ...metadata,
              },
              tags: ['identity', 'responsibility', 'profile'],
              contextKeywords: ['identity', 'role', 'responsibility', 'skill', 'task'],
              source: 'identity-aggregator',
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
          title: '身份与职责',
          slug: 'identity-and-responsibilities',
          content,
          version: 1,
          memoKind: 'identity',
          memoType: 'knowledge',
          payload: {
            topic: 'identity',
            ...metadata,
          },
          tags: ['identity', 'responsibility', 'profile'],
          contextKeywords: ['identity', 'role', 'responsibility', 'skill', 'task'],
          source: 'identity-aggregator',
          createdAt: now,
          updatedAt: now,
        })
        .catch((err) => {
          if (err.code === 11000) {
            this.logger.warn(`Identity memo already exists for agent ${agentId}, skipping create`);
          } else {
            throw err;
          }
        });
    }
  }
}
