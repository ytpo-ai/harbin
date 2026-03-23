import { Injectable } from '@nestjs/common';

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
  optimizeTasks(tasks: PlannerTaskDraft[]): PlannerTaskDraft[] {
    return tasks;
  }

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
