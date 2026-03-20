import { Injectable, Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerTaskDraft {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies: number[];
}

export interface SceneOptimizationRule {
  /** Unique identifier for this rule */
  id: string;
  /** Scene this rule applies to (e.g., 'email', 'code_dev', 'doc', 'general') */
  scene: string;
  /** Human-readable description */
  description: string;
  /** Determines if this rule should apply to the given task list */
  match: (tasks: PlannerTaskDraft[]) => boolean;
  /** Transforms the task list (e.g., rewrite dependencies, reorder, merge) */
  optimize: (tasks: PlannerTaskDraft[]) => PlannerTaskDraft[];
}

export interface TaskQualityRule {
  /** Minimum description length */
  minDescriptionLength?: number;
  /** Patterns that must appear in at least N% of task descriptions (e.g., file paths) */
  requiredPatterns?: { pattern: RegExp; label: string; minMatchRatio?: number }[];
  /** Patterns that indicate low-quality (template copying, vague language) */
  forbiddenPatterns?: { pattern: RegExp; label: string }[];
}

export interface QualityValidationResult {
  passed: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants (configurable via env)
// ---------------------------------------------------------------------------

const MAX_TASKS = parseInt(process.env.PLANNER_MAX_TASKS || '8', 10);
const MAX_TITLE_LENGTH = parseInt(process.env.PLANNER_MAX_TITLE_LENGTH || '120', 10);
const MAX_DESCRIPTION_LENGTH = parseInt(process.env.PLANNER_MAX_DESCRIPTION_LENGTH || '1000', 10);
const MIN_DESCRIPTION_LENGTH = parseInt(process.env.PLANNER_MIN_DESCRIPTION_LENGTH || '20', 10);

export { MAX_TASKS, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH };

// ---------------------------------------------------------------------------
// Built-in Scene Rules
// ---------------------------------------------------------------------------

const EMAIL_SCENE_RULE: SceneOptimizationRule = {
  id: 'builtin:email',
  scene: 'email',
  description: 'Email workflow: draft → review → send dependency chain',
  match: (tasks) =>
    tasks.some((t) => {
      const text = `${t.title} ${t.description}`.toLowerCase();
      return (
        text.includes('email') || text.includes('邮件') ||
        text.includes('发邮件') || text.includes('send mail')
      );
    }),
  optimize: (tasks) => {
    const draftIndex = tasks.findIndex((task) => {
      const text = `${task.title} ${task.description}`.toLowerCase();
      return (
        text.includes('draft email') || text.includes('email draft') ||
        text.includes('邮件草稿') || text.includes('撰写邮件')
      );
    });

    const reviewIndex = tasks.findIndex((task) => {
      const text = `${task.title} ${task.description}`.toLowerCase();
      return (
        text.includes('review') || text.includes('finalize') ||
        text.includes('校对') || text.includes('润色')
      );
    });

    const sendIndex = tasks.findIndex((task) => {
      const text = `${task.title} ${task.description}`.toLowerCase();
      return (
        text.includes('send email') || text.includes('发送邮件') ||
        text.includes('发邮件')
      );
    });

    if (sendIndex >= 0 && draftIndex >= 0) {
      tasks[sendIndex].dependencies = [draftIndex];
    }

    if (reviewIndex >= 0 && draftIndex >= 0) {
      tasks[reviewIndex].dependencies = Array.from(
        new Set([...tasks[reviewIndex].dependencies, draftIndex]),
      );
    }

    return tasks;
  },
};

const CODE_DEV_SCENE_RULE: SceneOptimizationRule = {
  id: 'builtin:code_dev',
  scene: 'code_dev',
  description: 'Code development: design → implement → test → review dependency chain',
  match: (tasks) =>
    tasks.some((t) => {
      const text = `${t.title} ${t.description}`.toLowerCase();
      return (
        text.includes('开发') || text.includes('implement') ||
        text.includes('代码') || text.includes('code') ||
        text.includes('前端') || text.includes('后端') ||
        text.includes('frontend') || text.includes('backend')
      );
    }),
  optimize: (tasks) => {
    const designIndex = tasks.findIndex((t) => {
      const text = `${t.title} ${t.description}`.toLowerCase();
      return (
        text.includes('方案') || text.includes('设计') ||
        text.includes('design') || text.includes('plan')
      );
    });

    const testIndex = tasks.findIndex((t) => {
      const text = `${t.title} ${t.description}`.toLowerCase();
      return (
        text.includes('验收') || text.includes('测试') || text.includes('联调') ||
        text.includes('test') || text.includes('verify') || text.includes('validate')
      );
    });

    // Ensure test/verification depends on all implementation tasks
    if (testIndex >= 0) {
      const implIndices = tasks
        .map((t, i) => {
          if (i === testIndex || i === designIndex) return -1;
          const text = `${t.title} ${t.description}`.toLowerCase();
          const isImpl =
            text.includes('开发') || text.includes('实现') || text.includes('implement') ||
            text.includes('修改') || text.includes('前端') || text.includes('后端') ||
            text.includes('改造') || text.includes('补齐') || text.includes('接口');
          return isImpl ? i : -1;
        })
        .filter((i) => i >= 0);

      if (implIndices.length) {
        tasks[testIndex].dependencies = Array.from(
          new Set([...tasks[testIndex].dependencies, ...implIndices]),
        );
      }
    }

    // Ensure implementation tasks depend on design task
    if (designIndex >= 0) {
      for (let i = 0; i < tasks.length; i++) {
        if (i === designIndex || i === testIndex) continue;
        const text = `${tasks[i].title} ${tasks[i].description}`.toLowerCase();
        const isImpl =
          text.includes('开发') || text.includes('实现') || text.includes('implement') ||
          text.includes('修改') || text.includes('前端') || text.includes('后端') ||
          text.includes('改造') || text.includes('补齐');
        if (isImpl && !tasks[i].dependencies.includes(designIndex)) {
          tasks[i].dependencies = Array.from(
            new Set([...tasks[i].dependencies, designIndex]),
          );
        }
      }
    }

    return tasks;
  },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SceneOptimizationService {
  private readonly logger = new Logger(SceneOptimizationService.name);
  private readonly rules: SceneOptimizationRule[] = [
    EMAIL_SCENE_RULE,
    CODE_DEV_SCENE_RULE,
  ];

  /**
   * Register an additional scene optimization rule at runtime.
   * This allows external modules or DB-loaded configs to extend the pipeline.
   */
  registerRule(rule: SceneOptimizationRule): void {
    const existing = this.rules.findIndex((r) => r.id === rule.id);
    if (existing >= 0) {
      this.rules[existing] = rule;
      this.logger.log(`Updated scene optimization rule: ${rule.id}`);
    } else {
      this.rules.push(rule);
      this.logger.log(`Registered scene optimization rule: ${rule.id}`);
    }
  }

  /**
   * Apply all matching scene optimization rules to the task list.
   */
  optimizeTasks(tasks: PlannerTaskDraft[]): PlannerTaskDraft[] {
    if (!tasks.length) return tasks;

    let result = [...tasks.map((t) => ({ ...t, dependencies: [...t.dependencies] }))];

    for (const rule of this.rules) {
      try {
        if (rule.match(result)) {
          result = rule.optimize(result);
          this.logger.debug(`Applied scene optimization rule: ${rule.id}`);
        }
      } catch (err) {
        this.logger.warn(`Scene optimization rule ${rule.id} failed: ${(err as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Validate task description quality.
   * Returns warnings for tasks that don't meet quality standards.
   */
  validateTaskQuality(
    tasks: PlannerTaskDraft[],
    customRules?: TaskQualityRule,
  ): QualityValidationResult {
    const warnings: string[] = [];
    const rules: TaskQualityRule = {
      minDescriptionLength: MIN_DESCRIPTION_LENGTH,
      requiredPatterns: [
        {
          pattern: /[a-zA-Z\/\\]+\.(ts|tsx|js|jsx|py|go|md|json|yaml|yml)/i,
          label: '文件路径',
          minMatchRatio: 0.3,
        },
      ],
      forbiddenPatterns: [
        {
          pattern: /^基于\s*(Step|步骤)\s*\d+\s*(方案|输出|结论)/i,
          label: '纯模板复述',
        },
      ],
      ...customRules,
    };

    // Check minimum description length
    for (const task of tasks) {
      if (rules.minDescriptionLength && task.description.length < rules.minDescriptionLength) {
        warnings.push(
          `Task "${task.title}" description too short (${task.description.length} < ${rules.minDescriptionLength})`,
        );
      }
    }

    // Check required patterns (e.g., file paths should appear in at least N% of tasks)
    if (rules.requiredPatterns?.length && tasks.length > 0) {
      for (const rp of rules.requiredPatterns) {
        const matchCount = tasks.filter((t) => rp.pattern.test(t.description)).length;
        const ratio = matchCount / tasks.length;
        const minRatio = rp.minMatchRatio ?? 0.5;
        if (ratio < minRatio) {
          warnings.push(
            `Only ${matchCount}/${tasks.length} tasks contain ${rp.label} (${Math.round(ratio * 100)}% < ${Math.round(minRatio * 100)}%)`,
          );
        }
      }
    }

    // Check forbidden patterns
    if (rules.forbiddenPatterns?.length) {
      for (const task of tasks) {
        for (const fp of rules.forbiddenPatterns) {
          if (fp.pattern.test(task.description)) {
            warnings.push(`Task "${task.title}" matches forbidden pattern: ${fp.label}`);
          }
        }
      }
    }

    if (warnings.length) {
      this.logger.log(`Task quality warnings (${warnings.length}): ${warnings.join('; ')}`);
    }

    return {
      passed: warnings.length === 0,
      warnings,
    };
  }
}
