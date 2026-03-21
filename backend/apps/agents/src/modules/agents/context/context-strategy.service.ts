import { Injectable } from '@nestjs/common';
import { Task } from '../../../../../../src/shared/types';
import { isMeetingLikeTask } from '../agent-executor.helpers';
import { AgentContext, EnabledAgentSkillContext } from '../agent.types';

@Injectable()
export class ContextStrategyService {
  shouldActivateSkillContent(
    skill: EnabledAgentSkillContext,
    task: Task,
    context?: AgentContext,
  ): boolean {
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

    if (task.type === 'planning') {
      const planningSignals = ['planning', 'orchestration', 'guard', 'planner'];
      if (tags.some((tag) => planningSignals.some((s) => tag.includes(s)))) {
        return true;
      }
    }

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
      .map((item) => `工具使用策略（${item.toolId}）:\n${item.prompt}`)
      .filter((message) => {
        if (seen.has(message)) return false;
        seen.add(message);
        return true;
      });
  }
}
