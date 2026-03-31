import { Injectable } from '@nestjs/common';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { ChatMessage } from '../../../../../../src/shared/types';
import { SKILL_CONTENT_MAX_INJECT_LENGTH, normalizeToolId } from '../agent.constants';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';
import { ContextFingerprintService } from './context-fingerprint.service';
import { ContextPromptService } from './context-prompt.service';
import { ContextStrategyService } from './context-strategy.service';

@Injectable()
export class ToolsetContextBuilder implements ContextBlockBuilder {
  readonly layer = 'toolset' as const;
  readonly meta = { scope: 'run', stability: 'dynamic' } as const;

  constructor(
    private readonly contextPromptService: ContextPromptService,
    private readonly contextStrategyService: ContextStrategyService,
    private readonly contextFingerprintService: ContextFingerprintService,
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
        content: `Enabled Skills for this agent:\n${skillLines}\n\n`,
        timestamp: new Date(),
      });

      for (const skill of input.enabledSkills) {
        const collaborationCtx = ((input.context as any)?.collaborationContext || {}) as Record<string, unknown>;
        const activationContext = {
          domainType: String(collaborationCtx.domainType || '').trim() || undefined,
          taskType: String(collaborationCtx.taskType || input.task.type || '').trim() || undefined,
          phase: String(collaborationCtx.phase || '').trim() || undefined,
          roleInPlan: String(collaborationCtx.roleInPlan || '').trim() || undefined,
        };
        if (!this.contextStrategyService.shouldActivateSkillContent(skill, input.task, input.context, activationContext)) {
          continue;
        }
        let rawContent = input.shared.skillContents.get(skill.id);
        if (!rawContent) continue;

        // Skill 激活门控（Tag-Based Activation）已精确控制各阶段加载哪些 skill，
        // 无需在此裁剪 phaseInitialize 段落。

        const content =
          rawContent.length > SKILL_CONTENT_MAX_INJECT_LENGTH
            ? rawContent.slice(0, SKILL_CONTENT_MAX_INJECT_LENGTH) + '\n\n[... 内容已截断，可通过工具查询完整版本]'
            : rawContent;
        messages.push({
          role: 'system',
          content: `【enabled skill - ${skill.name}】\n\n${content}`,
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

      const toolSpecContent = await this.contextPromptService.resolvePromptContent(AGENT_PROMPTS.toolInjectionInstruction, { toolSpecs });

      const toolPromptMessages = this.contextStrategyService.buildToolPromptMessages(input.shared.assignedTools);
      const toolStrategyContent =
        toolPromptMessages.length > 0
          ? await this.contextPromptService.resolvePromptContent(AGENT_PROMPTS.toolStrategyWrapper, {
              toolPromptMessages,
            })
          : '';

      const combinedToolsetSpecContent = `${toolSpecContent}\n\n${toolStrategyContent}`;
      const resolvedToolsetSpecContent = await this.contextFingerprintService.resolveSystemContextBlockContent({
        scope: input.contextScope,
        blockType: 'toolset-spec',
        fullContent: combinedToolsetSpecContent,
        snapshot: {
          toolIdsSorted: input.shared.assignedTools
            .map((tool) => String(tool.canonicalId || normalizeToolId(tool.id) || '').trim())
            .filter((id) => id.length > 0)
            .sort(),
        },
      });

      if (resolvedToolsetSpecContent) {
        if (resolvedToolsetSpecContent !== combinedToolsetSpecContent) {
          messages.push({
            role: 'system',
            content: resolvedToolsetSpecContent,
            timestamp: new Date(),
            metadata: {
              promptSlug: `${AGENT_PROMPTS.toolInjectionInstruction.slug}+${AGENT_PROMPTS.toolStrategyWrapper.slug}`,
            },
          });
          return messages;
        }

        messages.push({
          role: 'system',
          content: toolSpecContent,
          timestamp: new Date(),
          metadata: {
            promptSlug: AGENT_PROMPTS.toolInjectionInstruction.slug,
          },
        });
        if (toolStrategyContent) {
          messages.push({
            role: 'system',
            content: toolStrategyContent,
            timestamp: new Date(),
            metadata: {
              promptSlug: AGENT_PROMPTS.toolStrategyWrapper.slug,
            },
          });
        }
      }
    }

    return messages;
  }

  // stripPhaseInitializeSectionIfNeeded 已移除：
  // Skill 激活门控（Tag-Based Activation #12）已精确控制各阶段加载哪些 skill，
  // generating/pre_execute/post_execute 阶段不会加载 rd-workflow，无需代码层裁剪。
}
