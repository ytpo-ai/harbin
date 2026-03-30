import { Injectable } from '@nestjs/common';
import { Task } from '../../../../../../src/shared/types';
import { isMeetingLikeTask } from '../agent-executor.helpers';
import { AgentContext, EnabledAgentSkillContext } from '../agent.types';

type ActivationField = 'domainType' | 'taskType' | 'phase' | 'roleInPlan';
type ActivationRule = 'must' | 'no' | 'enable';

interface ActivationTag {
  field: ActivationField;
  values: string[];
  rule: ActivationRule;
}

export interface SkillActivationContext {
  domainType?: string;
  taskType?: string;
  phase?: string;
  roleInPlan?: string;
}

@Injectable()
export class ContextStrategyService {
  parseActivationTags(tags: string[]): ActivationTag[] {
    const validFields = new Set<ActivationField>(['domainType', 'taskType', 'phase', 'roleInPlan']);
    const validRules = new Set<ActivationRule>(['must', 'no', 'enable']);

    return (tags || [])
      .map((tag) => {
        const normalizedTag = String(tag || '').trim();
        if (!normalizedTag) {
          return null;
        }
        const parts = normalizedTag.split(':');
        if (parts.length !== 3) {
          return null;
        }
        const [rawField, rawValues, rawRule] = parts;
        const field = String(rawField || '').trim() as ActivationField;
        const rule = String(rawRule || '').trim() as ActivationRule;
        if (!validFields.has(field) || !validRules.has(rule)) {
          return null;
        }
        const values = String(rawValues || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (values.length === 0) {
          return null;
        }
        return {
          field,
          values,
          rule,
        };
      })
      .filter((item): item is ActivationTag => Boolean(item));
  }

  evaluateActivationTags(
    activationTags: ActivationTag[],
    context: SkillActivationContext,
  ): { active: boolean; reason: string } {
    for (const tag of activationTags.filter((item) => item.rule === 'no')) {
      const contextValue = String(context[tag.field] || '').trim();
      if (contextValue && tag.values.includes(contextValue)) {
        return {
          active: false,
          reason: `no rule matched: ${tag.field}=${contextValue}`,
        };
      }
    }

    for (const tag of activationTags.filter((item) => item.rule === 'must')) {
      const contextValue = String(context[tag.field] || '').trim();
      if (!contextValue || !tag.values.includes(contextValue)) {
        return {
          active: false,
          reason: `must rule failed: ${tag.field}=${contextValue || 'undefined'}, expected ${tag.values.join(',')}`,
        };
      }
    }

    const enableHints = activationTags
      .filter((item) => item.rule === 'enable')
      .filter((item) => {
        const contextValue = String(context[item.field] || '').trim();
        return contextValue && item.values.includes(contextValue);
      });

    return {
      active: true,
      reason: enableHints.length > 0
        ? `enable hints: ${enableHints.map((item) => `${item.field}=${item.values.join(',')}`).join('; ')}`
        : 'all must passed',
    };
  }

  shouldActivateSkillContent(
    skill: EnabledAgentSkillContext,
    task: Task,
    context?: AgentContext,
    activationContext?: SkillActivationContext,
  ): boolean {
    const collaborationCtx = (context?.collaborationContext || {}) as Record<string, any>;
    const skillActivation = collaborationCtx.skillActivation as
      | { mode?: string; skillIds?: string[] }
      | undefined;

    // precise 模式（预留）：只激活白名单中的 skill
    if (skillActivation?.mode === 'precise') {
      const ids = Array.isArray(skillActivation.skillIds) ? skillActivation.skillIds : [];
      return ids.includes(skill.id);
    }

    const resolvedActivationContext: SkillActivationContext = activationContext || {
      domainType: String(collaborationCtx.domainType || '').trim() || undefined,
      taskType: String(collaborationCtx.taskType || task.type || '').trim() || undefined,
      phase: String(collaborationCtx.phase || '').trim() || undefined,
      roleInPlan: String(collaborationCtx.roleInPlan || '').trim() || undefined,
    };

    const activationTags = this.parseActivationTags(skill.tags || []);
    if (activationTags.length > 0) {
      return this.evaluateActivationTags(activationTags, resolvedActivationContext).active;
    }

    const meetingLike = isMeetingLikeTask(task, context);
    const taskText = `${task.title || ''} ${task.description || ''} ${task.type || ''}`.toLowerCase();
    const tags = (skill.tags || []).map((t) => t.toLowerCase());
    const skillName = String(skill.name || '').toLowerCase();

    if (meetingLike) {
      const meetingPinnedSkills = ['meeting-resilience', 'meeting-sensitive-planner'];
      if (meetingPinnedSkills.some((signal) => skillName.includes(signal) || tags.some((tag) => tag.includes(signal)))) {
        return true;
      }
    }

    if (task.type && tags.some((tag) => tag.includes(task.type))) {
      return true;
    }

    // standard 模式：跳过 planning 强制激活，走普通语义匹配
    // 未配置 skillActivation 时：保留原有 planning 强制激活逻辑（向后兼容）
    // if (task.type === 'planning' && skillActivation?.mode !== 'standard') {
    //   const planningSignals = ['planning', 'orchestration', 'guard', 'planner'];
    //   if (tags.some((tag) => planningSignals.some((s) => tag.includes(s)))) {
    //     return true;
    //   }
    // }

    const skillSignals = [skill.name.toLowerCase(), ...tags];
    let hitCount = 0;
    for (const signal of skillSignals) {
      const words = signal.split(/[\s\-_]+/).filter((w) => w.length >= 3);
      if (words.some((word) => taskText.includes(word))) {
        hitCount += 1;
      }
      if (hitCount >= 2) return true;
    }

    return false;
  }

  buildToolPromptMessages(
    assignedTools: Array<{
      id?: string;
      canonicalId?: string;
      prompt?: string;
    }>,
  ): string[] {
    const seen = new Set<string>();
    return assignedTools
      .map((tool) => {
        const toolId = String(tool.canonicalId || tool.id || '').trim();
        const prompt = String(tool.prompt || '').trim();
        return { toolId, prompt };
      })
      .filter((item) => item.toolId && item.prompt)
      .sort((a, b) => a.toolId.localeCompare(b.toolId))
      .map((item) => `Tool Use Strategy（${item.toolId}）:\n${item.prompt}`)
      .filter((message) => {
        if (seen.has(message)) return false;
        seen.add(message);
        return true;
      });
  }
}
