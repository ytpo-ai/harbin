import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { AgentSkill, AgentSkillDocument } from '../../schemas/agent-skill.schema';
import { Skill, SkillDocument } from '../../schemas/skill.schema';
import { AgentMemo, AgentMemoDocument } from '../../schemas/agent-memo.schema';

interface IdentityData {
  agent: AgentBasicInfo;
  skills: SkillInfo[];
  tools: ToolDescriptor[];
}

interface AgentBasicInfo {
  name: string;
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

interface ToolDescriptor {
  id: string;
  description: string;
}

@Injectable()
export class IdentityAggregationService {
  private readonly logger = new Logger(IdentityAggregationService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Tool.name) private readonly toolModel: Model<ToolDocument>,
    @InjectModel(AgentSkill.name) private readonly agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(AgentMemo.name) private readonly memoModel: Model<AgentMemoDocument>,
  ) {}

  async aggregateIdentity(agentId: string): Promise<void> {
    this.logger.log(`Starting identity aggregation for agent: ${agentId}`);

    try {
      const [agentBasic, skills, tools] = await Promise.all([
        this.getAgentBasicInfo(agentId),
        this.getAgentSkills(agentId),
        this.getTools(agentId),
      ]);

      const content = this.buildIdentityContent({
        agent: agentBasic,
        skills,
        tools,
      });

      await this.updateIdentityMemo(agentId, content, {
        lastAggregatedAt: new Date().toISOString(),
        sources: ['agent', 'agent_skills', 'tool_registry'],
      });

      this.logger.log(`Identity aggregation completed for agent: ${agentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Identity aggregation failed for agent ${agentId}: ${message}`);
      throw error;
    }
  }

  private async getAgentBasicInfo(agentId: string): Promise<AgentBasicInfo> {
    const agent = await this.getAgentDocument(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return {
      name: agent.name,
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

  private async getAgentDocument(agentId: string): Promise<AgentDocument | null> {
    let agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      agent = await this.agentModel.findOne({ id: agentId }).exec();
    }
    return agent;
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

  private normalizeToolId(toolId: string): string {
    return String(toolId || '').trim();
  }

  private uniqueToolIds(...groups: string[][]): string[] {
    const merged = groups
      .flat()
      .map((item) => this.normalizeToolId(item))
      .filter(Boolean);
    return Array.from(new Set(merged));
  }

  private async getTools(agentId: string): Promise<ToolDescriptor[]> {
    const agent = await this.getAgentDocument(agentId);
    if (!agent) {
      return [];
    }

    const toolIds = this.uniqueToolIds(agent.tools || []);
    if (!toolIds.length) {
      return [];
    }

    const tools = await this.toolModel
      .find({
        $or: [
          { id: { $in: toolIds } },
          { canonicalId: { $in: toolIds } },
          { aliases: { $in: toolIds } },
        ],
      })
      .exec();

    const toolMap = new Map<string, { description: string }>();
    for (const tool of tools) {
      const normalizedId = this.normalizeToolId((tool as any).id);
      const canonicalId = this.normalizeToolId((tool as any).canonicalId);
      const descriptor = {
        description: (tool as any).description || 'Tool metadata not found in registry',
      };
      if (normalizedId) {
        toolMap.set(normalizedId, descriptor);
      }
      if (canonicalId) {
        toolMap.set(canonicalId, descriptor);
      }
      const aliases = Array.isArray((tool as any).aliases) ? (tool as any).aliases : [];
      for (const alias of aliases) {
        const normalizedAlias = this.normalizeToolId(alias);
        if (normalizedAlias) {
          toolMap.set(normalizedAlias, descriptor);
        }
      }
    }

    return toolIds.map((toolId) => {
      const metadata = toolMap.get(toolId);
      return {
        id: toolId,
        description: metadata?.description || 'Tool metadata not found in registry',
      };
    });
  }

  private buildIdentityContent(data: IdentityData): string {
    const { agent, skills, tools } = data;

    const lines: string[] = [];

    lines.push('# 身份与职责', '');
    lines.push('## Agent Profile', '');
    lines.push(`- **Agent 名称**：${agent.name || '待补充'}`);
    lines.push(`- **角色ID**：${agent.roleId || '待补充'}`);
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
    lines.push(`- **工具集**：${tools.length > 0 ? tools.map((tool) => tool.id).join(', ') : '待补充'}`);
    lines.push(
      `- **模型能力**：${agent.capabilities.length > 0 ? agent.capabilities.join(', ') : '待补充'}`,
      '',
    );

    if (tools.length > 0) {
      lines.push('### 工具描述', '');
      lines.push('| 工具ID | 描述 |');
      lines.push('|--------|------|');
      for (const tool of tools) {
        lines.push(`| ${tool.id} | ${tool.description} |`);
      }
      lines.push('');
    }

    lines.push('## 工作风格', '');
    lines.push(`- 工作伦理：${agent.personality.workEthic}/100`);
    lines.push(`- 创造力：${agent.personality.creativity}/100`);
    lines.push(`- 领导力：${agent.personality.leadership}/100`);
    lines.push(`- 团队协作：${agent.personality.teamwork}/100`);
    lines.push(`- 学习能力：${agent.learningAbility}/100`, '');

    lines.push('## 元信息', '');
    lines.push(`- version: ${Date.now()}`);
    lines.push(`- lastAggregatedAt: ${new Date().toISOString()}`);
    lines.push(`- sources: [agent, agent_skills, tool_registry]`);

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
