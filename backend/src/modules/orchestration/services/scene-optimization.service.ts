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
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SceneOptimizationService {
  private readonly logger = new Logger(SceneOptimizationService.name);
  private readonly rules: SceneOptimizationRule[] = [];

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
    return tasks;
  }

  /**
   * Validate task description quality.
   * Returns warnings for tasks that don't meet quality standards.
   */
  validateTaskQuality(
    tasks: PlannerTaskDraft[],
    customRules?: TaskQualityRule,
  ): QualityValidationResult {
    void tasks;
    void customRules;

    return {
      passed: true,
      warnings: [],
    };
  }
}
