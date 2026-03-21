import { Injectable } from '@nestjs/common';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { ChatMessage } from '../../../../../../src/shared/types';
import { SKILL_CONTENT_MAX_INJECT_LENGTH, normalizeToolId } from '../agent.constants';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextPromptService } from './context-prompt.service';
import { ContextStrategyService } from './context-strategy.service';

@Injectable()
export class ToolsetContextBuilder implements ContextBlockBuilder {
  readonly layer = 'toolset' as const;

  constructor(
    private readonly contextPromptService: ContextPromptService,
    private readonly contextStrategyService: ContextStrategyService,
  ) {}

  shouldInject(): boolean {
    return true;
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    if (input.enabledSkills.length > 0) {
      const skillLines = input.enabledSkills
        .map(
          (skill) =>
            `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${(skill.tags || []).join(', ') || 'N/A'}`,
        )
        .join('\n');

      messages.push({
        role: 'system',
        content: `Enabled Skills for this agent:\n${skillLines}\n\n以下为技能索引。请按任务上下文激活并严格遵循对应技能方法论。`,
        timestamp: new Date(),
      });

      for (const skill of input.enabledSkills) {
        if (!this.contextStrategyService.shouldActivateSkillContent(skill, input.task, input.context)) {
          continue;
        }
        const rawContent = input.shared.skillContents.get(skill.id);
        if (!rawContent) continue;

        const content =
          rawContent.length > SKILL_CONTENT_MAX_INJECT_LENGTH
            ? rawContent.slice(0, SKILL_CONTENT_MAX_INJECT_LENGTH) + '\n\n[... 内容已截断，可通过工具查询完整版本]'
            : rawContent;
        messages.push({
          role: 'system',
          content: `【激活技能方法论 - ${skill.name}】\n\n${content}`,
          timestamp: new Date(),
        });
      }
    }

    if (input.shared.assignedTools.length > 0) {
      const toolSpecs = input.shared.assignedTools.map((tool) => {
        const id = tool.canonicalId || normalizeToolId(tool.id);
        const name = String(tool.name || '').trim() || 'Unnamed Tool';
        const description = String(tool.description || '').trim() || 'No description';
        return `- ${id} | ${name} | ${description}`;
      });

      messages.push({
        role: 'system',
        content: await this.contextPromptService.resolvePromptContent(AGENT_PROMPTS.toolInjectionInstruction, { toolSpecs }),
        timestamp: new Date(),
      });

      const toolPromptMessages = this.contextStrategyService.buildToolPromptMessages(input.shared.assignedTools);
      if (toolPromptMessages.length > 0) {
        messages.push({
          role: 'system',
          content: await this.contextPromptService.resolvePromptContent(AGENT_PROMPTS.toolStrategyWrapper, {
            toolPromptMessages,
          }),
          timestamp: new Date(),
        });
      }
    }

    return messages;
  }
}
