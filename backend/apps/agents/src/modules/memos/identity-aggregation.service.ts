import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentSkill, AgentSkillDocument } from '../../schemas/agent-skill.schema';
import { Skill, SkillDocument } from '../../schemas/skill.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';

interface IdentityData {
  agent: AgentBasicInfo;
  skills: SkillInfo[];
}

interface AgentBasicInfo {
  name: string;
  type: string;
  roleId?: string;
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

@Injectable()
export class IdentityAggregationService {
  private readonly logger = new Logger(IdentityAggregationService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentSkill.name) private readonly agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
  ) {}

  async aggregateIdentity(agentId: string): Promise<void> {
    this.logger.log(`Starting identity aggregation for agent: ${agentId}`);

    try {
      const [agentBasic, skills] = await Promise.all([
        this.getAgentBasicInfo(agentId),
        this.getAgentSkills(agentId),
      ]);

      const content = this.buildIdentityContent({
        agent: agentBasic,
        skills,
      });

      await this.updateIdentityMemo(agentId, content, {
        lastAggregatedAt: new Date().toISOString(),
        sources: ['agent', 'agent_skills'],
      });

      this.logger.log(`Identity aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Identity aggregation failed for agent ${agentId}: ${message}`);
      throw error;
    }
  }

  private async getAgentBasicInfo(agentId: string): Promise<AgentBasicInfo> {
    let agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      agent = await this.agentModel.findOne({ id: agentId }).exec();
    }
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return {
      name: agent.name,
      type: agent.type,
      roleId: agent.roleId,
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

  private buildIdentityContent(data: IdentityData): string {
    const { agent, skills } = data;

    const lines: string[] = [];

    lines.push('# 身份与职责', '');
    lines.push('## Agent Profile', '');
    lines.push(`- **角色ID**：${agent.roleId || '待补充'}`);
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

    lines.push('## 元信息', '');
    lines.push(`- version: ${Date.now()}`);
    lines.push(`- lastAggregatedAt: ${new Date().toISOString()}`);
    lines.push(`- sources: [agent, agent_skills]`);

    return lines.join('\n');
  }

  private extractDomains(skills: SkillInfo[]): string {
    const categories = [...new Set(skills.map((s) => s.category).filter(Boolean))];
    return categories.length > 0 ? categories.join(', ') : '待补充';
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
              memoType: 'standard',
              version: nextVersion,
              payload: {
                topic: 'identity',
                ...metadata,
              },
              tags: ['identity', 'responsibility', 'profile'],
              contextKeywords: ['identity', 'role', 'responsibility', 'skill'],
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
          memoType: 'standard',
          payload: {
            topic: 'identity',
            ...metadata,
          },
          tags: ['identity', 'responsibility', 'profile'],
          contextKeywords: ['identity', 'role', 'responsibility', 'skill'],
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
