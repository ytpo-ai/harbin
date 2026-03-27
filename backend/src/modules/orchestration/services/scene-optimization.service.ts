import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';

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

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
  ) {}

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
    return [
      {
        id: 'development-plan-requirement-id-backfill',
        description: 'Backfill plan.metadata.requirementId from the first completed task output in development plans',
        match: (context) => {
          const planDomainType = String(context.planDomainType || '').trim().toLowerCase();
          const taskStatus = String(context.taskStatus || '').trim().toLowerCase();
          return planDomainType === 'development' && taskStatus === 'completed';
        },
        apply: async (context) => this.tryBackfillRequirementId(context),
      },
    ];
  }

  private async tryBackfillRequirementId(context: PostExecuteOptimizationContext): Promise<boolean> {
    const output = String(context.taskOutput || '').trim();
    if (!output) {
      return false;
    }

    const extractedId = this.extractRequirementIdFromOutput(output);
    if (!extractedId) {
      return false;
    }

    const plan = await this.planModel.findById(context.planId).select({ metadata: 1 }).lean().exec();
    const existingRequirementId = String((plan?.metadata || {}).requirementId || '').trim();
    if (existingRequirementId) {
      return false;
    }

    await this.planModel
      .updateOne(
        { _id: context.planId },
        { $set: { 'metadata.requirementId': extractedId } },
      )
      .exec();

    this.logger.log(
      `[scene_optimization] backfill_requirement planId=${context.planId} taskId=${context.taskId} requirementId=${extractedId}`,
    );
    return true;
  }

  private extractRequirementIdFromOutput(output: string): string | undefined {
    const idPattern = '(req-[a-zA-Z0-9_-]+|[a-f0-9]{24})';
    const labelPattern = new RegExp(
      String.raw`(?:\*{0,2})(?:requirementId|requirement_id|需求ID|需求编号)(?:\*{0,2})\s*[=：:|\s]\s*[|\s]*[\x60'"]?`
      + idPattern
      + String.raw`[\x60'"]?`,
      'i',
    );

    const labelMatch = output.match(labelPattern);
    if (labelMatch?.[1]) {
      return labelMatch[1].trim();
    }

    const fallbackMatch = output.match(/\breq-[a-zA-Z0-9_-]{3,}\b/);
    if (fallbackMatch?.[0]) {
      return fallbackMatch[0].trim();
    }

    return undefined;
  }
}
