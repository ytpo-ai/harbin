import { Injectable } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanningContext {
  agentManifest: string;
  requirementDetail: string;
  planningConstraints: string;
}

interface RequirementInfo {
  requirementId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIREMENT_DETAIL_MAX_LENGTH = parseInt(
  process.env.PLANNER_REQUIREMENT_DETAIL_MAX_LENGTH || '1500',
  10,
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PlanningContextService {
  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async buildPlanningContext(input: {
    prompt: string;
    requirementId?: string;
    plannerAgentId?: string;
  }): Promise<PlanningContext> {
    void input.prompt;
    const agentManifest = this.buildAgentDiscoveryInstruction();
    const requirementSyncAgentId = this.resolveRequirementSyncAgentId(input.plannerAgentId);
    const requirementDetail = input.requirementId
      ? await this.buildRequirementDetail(input.requirementId, requirementSyncAgentId)
      : '';

    return {
      agentManifest,
      requirementDetail,
      planningConstraints: '',
    };
  }

  // -----------------------------------------------------------------------
  // Agent Discovery
  // -----------------------------------------------------------------------

  private buildAgentDiscoveryInstruction(): string {
    return [
      '执行者发现规则（强制）:',
      '- 在决定 agentId 前，必须先调用 builtin.sys-mg.internal.agent-master.list-agents 获取实时清单。',
      '- 先按 requiredTools 过滤候选，再按能力和角色匹配排序。',
      '- 不允许基于静态列表或记忆推断可用执行者。',
    ].join('\n');
  }

  // -----------------------------------------------------------------------
  // Requirement Detail
  // -----------------------------------------------------------------------

  private resolveRequirementSyncAgentId(plannerAgentId?: string): string | undefined {
    const fromInput = String(plannerAgentId || '').trim();
    if (fromInput) {
      return fromInput;
    }
    const fromEnv = String(process.env.ORCHESTRATION_REQUIREMENT_AGENT_ID || '').trim();
    return fromEnv || undefined;
  }

  private async buildRequirementDetail(requirementId: string, agentId?: string): Promise<string> {
    const info = this.buildRequirementGetInstruction(requirementId, agentId);
    if (!info) {
      return '';
    }

    const lines = [
      '需求上下文获取规则（强制）:',
      `- requirementId: ${info.requirementId}`,
      '- 在开始拆解任务前，必须先调用工具 `builtin.sys-mg.mcp.requirement.get` 获取最新需求详情。',
      '- 调用参数必须包含 requirementId，禁止凭记忆或历史快照推断需求状态。',
      '- 获取后请在你的规划中以内嵌摘要方式体现标题、状态、优先级、标签和核心描述。',
      '- 若工具不可用或调用失败，请直接输出 `TASK_INABILITY: requirement.get failed` 并停止规划。',
      `- 需求摘要最大长度建议 ${REQUIREMENT_DETAIL_MAX_LENGTH} 字符。`,
    ];

    return lines.join('\n');
  }

  private buildRequirementGetInstruction(requirementId: string, agentId?: string): RequirementInfo {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      throw new Error('Missing planner agentId for requirement.get prompt instruction');
    }
    return {
      requirementId,
    };
  }

}
