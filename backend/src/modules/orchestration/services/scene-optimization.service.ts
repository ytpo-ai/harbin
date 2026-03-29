import { Injectable, Logger } from '@nestjs/common';

export interface PlannerTaskDraft {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies: number[];
}

export interface SceneOptimizationRule {
  id: string;
  scene: string;
  description: string;
  match: (tasks: PlannerTaskDraft[]) => boolean;
  optimize: (tasks: PlannerTaskDraft[]) => PlannerTaskDraft[];
}

export interface TaskQualityRule {
  minDescriptionLength?: number;
  requiredPatterns?: { pattern: RegExp; label: string; minMatchRatio?: number }[];
  forbiddenPatterns?: { pattern: RegExp; label: string }[];
}

export interface QualityValidationResult {
  passed: boolean;
  warnings: string[];
}

export interface PostExecuteOptimizationContext {
  planId: string;
  planDomainType?: string;
  taskId: string;
  runtimeTaskType?: string;
  taskStatus: string;
  taskOutput?: string;
}

interface PostExecuteOptimizationRule {
  id: string;
  description: string;
  match: (context: PostExecuteOptimizationContext) => boolean;
  apply: (context: PostExecuteOptimizationContext) => Promise<boolean>;
}

const MAX_TASKS = parseInt(process.env.PLANNER_MAX_TASKS || '8', 10);
const MAX_TITLE_LENGTH = parseInt(process.env.PLANNER_MAX_TITLE_LENGTH || '120', 10);
const MAX_DESCRIPTION_LENGTH = parseInt(process.env.PLANNER_MAX_DESCRIPTION_LENGTH || '1000', 10);
const MIN_DESCRIPTION_LENGTH = parseInt(process.env.PLANNER_MIN_DESCRIPTION_LENGTH || '20', 10);

export { MAX_TASKS, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH };

@Injectable()
export class SceneOptimizationService {
  private readonly logger = new Logger(SceneOptimizationService.name);

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

  async applyPostExecuteOptimizations(context: PostExecuteOptimizationContext): Promise<{ appliedRuleIds: string[] }> {
    const rules = this.getPostExecuteRules();
    const appliedRuleIds: string[] = [];

    for (const rule of rules) {
      if (!rule.match(context)) {
        continue;
      }
      try {
        const applied = await rule.apply(context);
        if (applied) {
          appliedRuleIds.push(rule.id);
        }
      } catch (error) {
        this.logger.warn(
          `[scene_optimization] rule=${rule.id} failed planId=${context.planId} taskId=${context.taskId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { appliedRuleIds };
  }

  private getPostExecuteRules(): PostExecuteOptimizationRule[] {
    return [];
  }
}
