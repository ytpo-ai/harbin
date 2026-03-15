import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../../shared/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
import {
  Employee,
  EmployeeDocument,
  EmployeeStatus,
  EmployeeType,
} from '../../../shared/schemas/employee.schema';
import { TaskClassificationService } from './task-classification.service';

@Injectable()
export class ExecutorSelectionService {
  constructor(
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Tool.name)
    private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    private readonly taskClassificationService: TaskClassificationService,
  ) {}

  async selectExecutor(
    title: string,
    description: string,
  ): Promise<{ executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason: string }> {
    const emailTask = this.taskClassificationService.isEmailTask(title, description);
    const researchTask = this.taskClassificationService.isResearchTask(title, description);
    const text = `${title} ${description}`.toLowerCase();
    const keywords = text
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((item) => item.length >= 2)
      .slice(0, 20);

    const [agents, employees] = await Promise.all([
      this.agentModel.find({ isActive: true }).exec(),
      this.employeeModel
        .find({
          status: { $in: [EmployeeStatus.ACTIVE, EmployeeStatus.PROBATION] },
        })
        .exec(),
    ]);

    const emailCapableAgentIdSet = await this.getEmailCapableAgentIdSet(agents);
    const researchCapableAgentIdSet = this.getResearchCapableAgentIdSet(agents);

    const agentCandidates = agents
      .map((agent) => {
        const context = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(' ')}`.toLowerCase();
        const score = keywords.reduce((acc, keyword) => (context.includes(keyword) ? acc + 1 : acc), 0);
        return { id: agent._id.toString(), score };
      })
      .sort((a, b) => b.score - a.score);

    const employeeCandidates = employees
      .map((employee) => {
        const context = `${employee.name || ''} ${employee.title || ''} ${employee.description || ''} ${(employee.capabilities || []).join(' ')}`.toLowerCase();
        const score = keywords.reduce((acc, keyword) => (context.includes(keyword) ? acc + 1 : acc), 0);
        return { id: employee.id, score, type: employee.type };
      })
      .sort((a, b) => b.score - a.score);

    const bestAgent = agentCandidates[0];
    const bestEmployee = employeeCandidates[0];

    if (emailTask) {
      const emailAgent = agentCandidates.find((candidate) => emailCapableAgentIdSet.has(candidate.id));
      if (emailAgent) {
        return {
          executorType: 'agent',
          executorId: emailAgent.id,
          reason: `Email task routed to mail-capable agent score=${emailAgent.score}`,
        };
      }

      const humanEmployee = employees.find((employee) => employee.type === EmployeeType.HUMAN);
      if (humanEmployee) {
        return {
          executorType: 'employee',
          executorId: humanEmployee.id,
          reason: 'Email task routed to human due to missing mail tool capability',
        };
      }

      return {
        executorType: 'unassigned',
        reason: 'Email task requires tool/credential, manual assignment required',
      };
    }

    if (researchTask) {
      const researchAgent = agentCandidates.find((candidate) => researchCapableAgentIdSet.has(candidate.id));
      if (researchAgent) {
        return {
          executorType: 'agent',
          executorId: researchAgent.id,
          reason: `Research task routed to research-capable agent score=${researchAgent.score}`,
        };
      }
    }

    if ((!bestAgent || bestAgent.score <= 0) && (!bestEmployee || bestEmployee.score <= 0)) {
      const fallbackAgent = agents[0];
      if (fallbackAgent?._id) {
        return {
          executorType: 'agent',
          executorId: fallbackAgent._id.toString(),
          reason: 'Fallback assignment to first active agent (no keyword match)',
        };
      }
      return {
        executorType: 'unassigned',
        reason: 'No matching capability found, manual assignment required',
      };
    }

    if ((bestAgent?.score || 0) >= (bestEmployee?.score || 0)) {
      return {
        executorType: 'agent',
        executorId: bestAgent.id,
        reason: `Best capability match score=${bestAgent.score}`,
      };
    }

    return {
      executorType: 'employee',
      executorId: bestEmployee.id,
      reason: `Best human assignment score=${bestEmployee.score}`,
    };
  }

  async hasEmailExecutionCapability(agentId: string): Promise<boolean> {
    const agent = await this.agentModel.findById(agentId).exec();
    if (!agent) {
      return false;
    }
    const toolIds = (agent.tools || []).filter(Boolean);
    if (!toolIds.length) {
      return false;
    }
    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    return tools.some((tool) => this.isEmailTool(tool));
  }

  private async getEmailCapableAgentIdSet(agents: Agent[]): Promise<Set<string>> {
    const toolIds = Array.from(new Set(agents.flatMap((agent) => agent.tools || []).filter(Boolean)));
    if (!toolIds.length) {
      return new Set();
    }

    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    const emailToolIdSet = new Set(
      tools
        .filter((tool) => this.isEmailTool(tool))
        .map((tool) => tool.id),
    );

    return new Set(
      agents
        .filter((agent) => (agent.tools || []).some((toolId) => emailToolIdSet.has(toolId)))
        .map((agent) => this.getEntityId(agent as unknown as Record<string, any>))
        .filter(Boolean),
    );
  }

  private getResearchCapableAgentIdSet(agents: Agent[]): Set<string> {
    const researchToolSet = new Set(['websearch', 'webfetch', 'content_extract']);
    return new Set(
      agents
        .filter((agent) => (agent.tools || []).some((toolId) => researchToolSet.has(toolId)))
        .map((agent) => this.getEntityId(agent as unknown as Record<string, any>))
        .filter(Boolean),
    );
  }

  private isEmailTool(tool: Tool): boolean {
    const text = `${tool.id} ${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    return text.includes('gmail') || text.includes('email') || text.includes('mail');
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) {
      return String(entity.id);
    }
    if (entity._id) {
      return entity._id.toString();
    }
    return '';
  }
}
