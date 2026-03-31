import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CollaborationContextFactory } from '@libs/contracts';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import { OrchestrationPlanDocument } from '../../../shared/schemas/orchestration-plan.schema';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { ORCHESTRATION_PROMPTS, OrchestrationPromptEntry } from '../orchestration-prompt-catalog';

@Injectable()
export class OrchestrationContextService {
  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    private readonly agentClientService: AgentClientService,
  ) {}

  async buildTaskDescription(
    baseDescription: string,
    options: {
      dependencyContext: string;
      retryHint?: string;
      stepIndex?: number;
      currentTaskTitle?: string;
      runtimeTaskType?: string;
      planTaskContext?: Record<string, unknown>;
      executePrompt?: string;
    },
  ): Promise<string> {
    const {
      dependencyContext,
      retryHint,
      stepIndex,
      currentTaskTitle,
      runtimeTaskType,
      planTaskContext,
      executePrompt,
    } = options;
    const normalizedRuntimeTaskType = this.normalizeRuntimeTaskType(runtimeTaskType);
    const isResearchTask = normalizedRuntimeTaskType === 'research';
    const isReviewTask = normalizedRuntimeTaskType === 'development.review';
    const sections = [`【Task Target】\n${this.extractCurrentTaskGoal(baseDescription)}`];
    const planTaskContextSection = this.buildPlanTaskContextSection(planTaskContext);
    if (planTaskContextSection) {
      sections.push(planTaskContextSection);
    }
    const stepStatusContext = this.buildStepStatusContext(stepIndex, runtimeTaskType, currentTaskTitle);
    if (stepStatusContext) {
      sections.push(stepStatusContext);
    }
    if (dependencyContext) {
      sections.push(`Dependency context:\n${dependencyContext}`);
    }
    if (retryHint) {
      sections.push(`Previous failed attempt hint:\n${retryHint}`);
    }
    if (executePrompt) {
      sections.push(`## 执行指导\n${executePrompt}`);
    }
    if (isResearchTask) {
      sections.push(await this.buildResearchOutputContract());
    }
    if (isReviewTask) {
      sections.push(
        [
          'Review output contract (MUST comply):',
          '- output must be a generic implementation review result',
          '- include: 1) review verdict (pass/needs-fix), 2) evidence list, 3) minimal fix suggestions',
          '- each evidence item should reference code behavior or file path when available',
        ].join('\n'),
      );
    }
    sections.push(
      [
        'Task output contract (MUST comply):',
        '- this applies only when execution cannot proceed; otherwise follow task-specific output contract first',
        '- if tool/permission is missing, start response with: TASK_INABILITY: <reason>',
        '- do not output fallback suggestions or manual instructions as completed task result',
        '- only return executable result after required actions are actually performed',
      ].join('\n'),
    );
    return sections.join('\n\n');
  }

  private extractCurrentTaskGoal(baseDescription: string): string {
    const normalized = String(baseDescription || '').trim();
    if (!normalized) {
      return '按当前步骤要求完成任务并输出可执行结果。';
    }

    const actionMatch = normalized.match(/动作\s*[：:]\s*([\s\S]*?)(?:\n\s*产出\s*[：:]|$)/i);
    if (actionMatch?.[1]) {
      return actionMatch[1].replace(/\s+/g, ' ').trim();
    }

    const firstSentence = normalized.split(/\n|。/).map((item) => item.trim()).find(Boolean);
    if (firstSentence) {
      return firstSentence;
    }

    return normalized.slice(0, 200);
  }

  private buildStepStatusContext(stepIndex?: number, runtimeTaskType?: string, currentTaskTitle?: string): string {
    if (!Number.isInteger(stepIndex) || Number(stepIndex) < 0) {
      return '';
    }
    const currentStep = Number(stepIndex);
    const lines: string[] = [];
    const taskTypeLabel = this.toTaskTypeLabel(runtimeTaskType);
    lines.push('———————————');
    lines.push(`Task #${currentStep + 1} 【当前任务】`);
    lines.push(
      `标题: 根据 step${Math.max(currentStep - 1, 0)} 的输出,你需要执行的工作是 [${taskTypeLabel}]${currentTaskTitle ? `（${currentTaskTitle}）` : ''}`,
    );
    return lines.join('\n');
  }

  private toTaskTypeLabel(runtimeTaskType?: string): string {
    const normalized = String(runtimeTaskType || '').trim().toLowerCase();
    if (normalized === 'development.exec') {
      return '开发执行';
    }
    if (normalized === 'development.plan') {
      return '开发规划';
    }
    if (normalized === 'development.review') {
      return '开发评审';
    }
    if (normalized === 'research') {
      return '调研';
    }
    return '开发方案';
  }

  async buildDependencyContext(planId: string, dependencyTaskIds: string[]): Promise<string> {
    if (!dependencyTaskIds.length) {
      return '';
    }

    const dependencyTasks = await this.orchestrationTaskModel
      .find({
        planId,
        _id: { $in: dependencyTaskIds },
      })
      .sort({ order: 1 })
      .exec();

    if (!dependencyTasks.length) {
      return '';
    }

    return dependencyTasks
      .map((depTask) => {
        const output = depTask.result?.output || depTask.result?.summary || '';
        return this.buildTaskContextBlock(depTask.order + 1, depTask.title, depTask.status, output || 'N/A');
      })
      .join('\n\n');
  }

  async buildRunDependencyContext(runId: string, dependencySourceTaskIds: string[]): Promise<string> {
    if (!dependencySourceTaskIds.length) {
      return '';
    }

    const dependencyTasks = await this.orchestrationRunTaskModel
      .find({
        runId,
        sourceTaskId: { $in: dependencySourceTaskIds },
      })
      .sort({ order: 1 })
      .exec();

    if (!dependencyTasks.length) {
      return '';
    }

    return dependencyTasks
      .map((depTask) => {
        const output = depTask.result?.output || depTask.result?.summary || '';
        return this.buildTaskContextBlock(depTask.order + 1, depTask.title, depTask.status, output || 'N/A');
      })
      .join('\n\n');
  }

  async buildGeneratingPrompt(
    context: {
      planGoal: string;
      completedTasks: Array<{ title: string; agentId?: string; outputSummary: string }>;
      failedTasks: Array<{ taskId: string; title: string; agentId?: string; agentTools?: string[]; error: string }>;
      totalSteps: number;
      lastError?: string;
      requirementId?: string;
    },
    options?: { domainType?: string; planId?: string; plan?: OrchestrationPlanDocument },
  ): Promise<string> {
    const nextStep = Math.max(1, context.completedTasks.length + 1);
    const metadata = ((options?.plan as unknown as { metadata?: Record<string, unknown> } | undefined)?.metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    const currentOutlineStep = outline.find((item) => Number(item.step) === nextStep);
    const phasePrompts = currentOutlineStep?.phasePrompts;
    const generatingPrompt = phasePrompts && typeof phasePrompts === 'object'
      ? String((phasePrompts as Record<string, unknown>).generating || '').trim()
      : '';

    // --- 修复2: 读取当前步骤的 recommendedAgent ---
    const recommendedAgentRaw = currentOutlineStep?.recommendedAgent as Record<string, unknown> | undefined;
    const recommendedAgentId = recommendedAgentRaw ? String(recommendedAgentRaw.agentId || '').trim() : '';
    const recommendedAgentName = recommendedAgentRaw ? String(recommendedAgentRaw.agentName || '').trim() : '';
    const recommendedAgentSection = recommendedAgentId
      ? [
        '## 推荐执行 Agent（大纲指定）',
        `- agentId: ${recommendedAgentId}`,
        `- agentName: ${recommendedAgentName || '(unknown)'}`,
        `- 说明: 大纲在 phaseInitialize 阶段根据 agent 能力匹配为当前步骤选定了此 agent，submit-task 时请直接使用该 agentId。`,
        '',
      ].join('\n')
      : '';
    const recommendedAgentHint = recommendedAgentId
      ? `大纲为当前步骤推荐了 agent ${recommendedAgentId}（${recommendedAgentName}），优先使用。`
      : '';

    // --- 修复1-1: 构建 outline 中尚未生成的步骤列表 ---
    const remainingSteps = outline
      .filter((item) => Number(item.step) > context.completedTasks.length)
      .map((item) => `- step${Number(item.step)}: ${String(item.title || '(untitled)')} (taskType=${String(item.taskType || 'general')})`);
    const remainingStepsSection = remainingSteps.length > 0
      ? [
        '## 大纲中尚未完成的步骤（禁止跳过）',
        ...remainingSteps,
        `共 ${remainingSteps.length} 个步骤待完成，当前应生成 step${nextStep} 的任务。`,
        '',
      ].join('\n')
      : '';

    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.plannerGenerating);

    const currentStepGuidanceSection = generatingPrompt
      ? ['## 当前步骤指导（Step {{nextStep}}）', '{{generatingPrompt}}', ''].join('\n')
      : '';

    const completedTasksSummary = context.completedTasks.length > 0
      ? `- 已完成任务: ${context.completedTasks.map((item) => item.title).join(' | ')}`
      : '';

    const fallbackRulesSection = generatingPrompt
      ? ''
      : [
        '## 降级规则（无预编译提示时）',
        '- 先调用 list-agents 获取执行者，再提交一个可执行任务。',
        '- task.description 需包含输入、动作、产出与验证标准。',
        '- 任务类型使用 general/research/development.plan/development.exec/development.review。',
        '',
      ].join('\n');

    const completedTasksBlock = context.completedTasks.length > 0
      ? [
        '## 已完成任务摘要',
        ...context.completedTasks.map((item, index) => {
          const stepLabel = options?.domainType === 'development' ? `(对应 step${index + 1}) ` : '';
          return `- ${stepLabel}[${item.title}] (agent=${item.agentId || 'unknown'}): ${item.outputSummary}`;
        }),
        '注意：如果 outputSummary 中出现"无法执行"、"无法完成"、"缺少工具"、"没有权限"等语义，该任务可能是"虚假完成"（被标记 completed 但实际未完成），应视为未完成并重新规划。',
        '',
      ].join('\n')
      : '';

    const failedTasksBlock = context.failedTasks.length > 0
      ? [
        '## 失败任务（请调整策略）',
        ...context.failedTasks.map((item) => {
          const agentLabel = item.agentId || 'unknown';
          const toolsLabel = item.agentTools?.length ? item.agentTools.join(', ') : 'unknown';
          return `- [${item.title}] (taskId=${item.taskId}, agent=${agentLabel}, tools=[${toolsLabel}]): ${item.error}`;
        }),
        '重要：当 action="redesign" 时，redesignTaskId 必须填写上方失败任务中的 taskId 原值，禁止臆造或替换为其他系统 task id。',
        '',
      ].join('\n')
      : '';

    const lastErrorBlock = context.lastError
      ? ['## 最近失败原因', context.lastError, ''].join('\n')
      : '';

    return this.renderTemplate(template, {
      planId: options?.planId || '(unknown)',
      nextStep: String(nextStep),
      totalSteps: String(Math.max(nextStep, outline.length || 1)),
      requirementId: context.requirementId || '(none)',
      planGoal: context.planGoal,
      generatingPrompt,
      createdTaskCount: String(context.totalSteps),
      completedTasksSummary,
      currentStepGuidanceSection,
      fallbackRulesSection,
      completedTasksBlock,
      failedTasksBlock,
      lastErrorBlock,
      remainingStepsSection,
      recommendedAgentSection,
      recommendedAgentHint,
    });
  }

  async buildPhaseInitializePrompt(input: {
    planId: string;
    sourcePrompt: string;
    domainType: string;
    existingTaskContext?: Record<string, unknown>;
  }): Promise<string> {
    const domainType = String(input.domainType || 'general').trim().toLowerCase();
    const existingTaskContext = input.existingTaskContext || {};
    const existingRequirementId = String(existingTaskContext.requirementId || '').trim();
    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.plannerInitialize);

    const existingRequirementHint = existingRequirementId
      ? `- existingRequirementId: ${existingRequirementId}`
      : '';
    const extensionStepHint = existingRequirementId
      ? `提示：已有 requirementId=${existingRequirementId}，可直接用于扩展步骤。`
      : '提示：如需 requirementId，请在扩展步骤中按 skill 指导获取并写入 taskContext。';

    return this.renderTemplate(template, {
      planId: input.planId,
      domainType,
      sourcePrompt: input.sourcePrompt,
      existingRequirementHint,
      extensionStepHint,
    });
  }

  async buildDefaultOutline(
    domainType: string,
  ): Promise<Array<{
    step: number;
    title: string;
    taskType: 'development.plan' | 'development.exec' | 'development.review' | 'general' | 'research';
    phasePrompts: {
      generating: string;
      pre_execute?: string;
      execute?: string;
      post_execute: string;
    };
  }>> {
    const normalized = String(domainType || 'general').trim().toLowerCase();
    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.plannerDefaultOutline);
    const parsed = this.tryParseJsonObject(template);
    const candidate = parsed && typeof parsed === 'object'
      ? (parsed[normalized] || parsed.general)
      : null;

    const rows = Array.isArray(candidate) ? candidate : [];
    if (rows.length === 0) {
      return normalized === 'development'
        ? [
          {
            step: 1,
            title: '制定技术开发计划',
            taskType: 'development.plan',
            phasePrompts: {
              generating: '生成技术规划任务，要求输出结构化开发计划与验收要点。',
              post_execute: '验证开发计划是否完整；完整则 generate_next，否则 redesign/retry。',
            },
          },
          {
            step: 2,
            title: '执行开发',
            taskType: 'development.exec',
            phasePrompts: {
              generating: '生成开发执行任务，要求按上一步计划落地代码变更并附验证证据。',
              post_execute: '验证是否完成代码变更与必要验证；通过则 generate_next。',
            },
          },
          {
            step: 3,
            title: '实现评估',
            taskType: 'development.review',
            phasePrompts: {
              generating: '生成实现评审任务，要求输出评审结论与修复建议。',
              post_execute: '验证评审结论是否完整，完成则 stop。',
            },
          },
        ]
        : [
          {
            step: 1,
            title: '执行任务',
            taskType: normalized === 'research' ? 'research' : 'general',
            phasePrompts: {
              generating: '生成可执行任务，明确输入、动作、产出与验收标准。',
              post_execute: '根据执行结果判断 generate_next 或 stop。',
            },
          },
        ];
    }

    return rows
      .map((item, index) => {
        const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const phasePrompts = row.phasePrompts && typeof row.phasePrompts === 'object' && !Array.isArray(row.phasePrompts)
          ? row.phasePrompts as Record<string, unknown>
          : {};
        return {
          step: Number(row.step) || index + 1,
          title: String(row.title || `步骤 ${index + 1}`).trim(),
          taskType: this.normalizeRuntimeTaskType(String(row.taskType || 'general')),
          phasePrompts: {
            generating: String(phasePrompts.generating || '').trim(),
            post_execute: String(phasePrompts.post_execute || '').trim(),
          },
        };
      })
      .filter((item) => item.phasePrompts.generating && item.phasePrompts.post_execute);
  }

  async resolvePlannerTaskPrompt(input: {
    prompt: string;
    mode: 'sequential' | 'parallel' | 'hybrid';
    requirementId?: string;
    sessionOverride?: string;
  }): Promise<string> {
    const requirementScope = input.requirementId
      ? `来源需求ID: ${input.requirementId}，请确保任务拆解围绕该需求交付闭环。`
      : '若存在来源需求ID，应保持任务拆解与需求范围一致。';

    const template = input.sessionOverride
      ? input.sessionOverride
      : await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.plannerTaskDecomposition);

    const replaced = this.renderTemplate(template, {
      prompt: input.prompt,
      mode: input.mode,
      requirementScope,
    });

    const lines = [replaced.trim()];
    if (!/{{\s*prompt\s*}}/i.test(template) && !replaced.includes('需求:')) {
      lines.push(`需求: ${input.prompt}`);
    }
    if (!/{{\s*mode\s*}}/i.test(template) && !replaced.includes(input.mode)) {
      lines.push(`mode 优先使用 ${input.mode}。`);
    }
    if (!/{{\s*requirementScope\s*}}/i.test(template) && !replaced.includes(requirementScope)) {
      lines.push(requirementScope);
    }
    return lines.join('\n').trim();
  }

  async buildResearchOutputContract(): Promise<string> {
    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.researchOutputContract);
    return template.trim();
  }

  private buildTaskContextBlock(stepNo: number, title: string, status: string, output: string): string {
    const statusLabel = this.toTaskStatusLabel(status);
    return [
      '———————————',
      `Task #${stepNo} 【${statusLabel}】`,
      `标题: ${title}`,
      '',
      output,
    ].join('\n');
  }

  private toTaskStatusLabel(status: string): string {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'completed') {
      return '已完成';
    }
    if (normalized === 'failed') {
      return '失败';
    }
    if (normalized === 'in_progress') {
      return '执行中';
    }
    if (normalized === 'waiting_human') {
      return '待人工';
    }
    if (normalized === 'assigned') {
      return '已分配';
    }
    if (normalized === 'pending') {
      return '待执行';
    }
    if (normalized === 'blocked') {
      return '阻塞';
    }
    if (normalized === 'cancelled') {
      return '已取消';
    }
    return normalized || '未知';
  }

  async buildPreTaskContext(input: {
    step: number;
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    runtimeTaskType?: string;
    planDomainType?: string;
    planGoal?: string;
    taskContext?: Record<string, unknown>;
    preExecuteActions: Array<{ tool: string; params: Record<string, unknown> }>;
  }): Promise<string> {
    const preActions = input.preExecuteActions;
    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.preExecuteContext);

    const tc = input.taskContext || {};
    const tcEntries = Object.entries(tc)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim())
      .map(([k, v]) => [k, String(v).slice(0, 500)] as [string, string]);

    const taskContextSection = tcEntries.length > 0
      ? ['taskContext:', ...tcEntries.map(([key, value]) => `  ${key}: ${value}`), ''].join('\n')
      : '';

    const preActionLines: string[] = [];
    for (let i = 0; i < preActions.length; i++) {
      const a = preActions[i];
      preActionLines.push(`工具ID（tool）: ${a.tool}`);
      preActionLines.push(`参数（parameters）: ${JSON.stringify(a.params)}`);
      preActionLines.push('');
    }

    return this.renderTemplate(template, {
      step: String(input.step),
      taskTitle: input.taskTitle,
      taskContextSection,
      preActionsCount: String(preActions.length),
      preActionsSection: preActionLines.join('\n').trim(),
    }).trim();
  }

  inferRuntimeTaskTypeFromPlanContext(input: {
    planDomainType?: string;
    planGoal?: string;
    step?: number;
    taskTitle: string;
    taskDescription: string;
    taskType?: string;
    existingRuntimeTaskType?: string;
  }): 'research' | 'development.plan' | 'development.exec' | 'development.review' | 'general' {
    const existing = this.normalizeRuntimeTaskTypeOverride(input.existingRuntimeTaskType);
    if (existing) {
      return existing;
    }

    const taskType = this.normalizeRuntimeTaskTypeOverride(input.taskType);
    if (taskType) {
      return taskType;
    }

    // Fallback: planner did not provide a valid taskType.
    // Use only the plan-level domain as a coarse hint; fine-grained
    // classification (plan / exec / review) is the planner's responsibility.
    const domain = String(input.planDomainType || 'general').trim().toLowerCase();

    if (domain === 'research') {
      return 'research';
    }

    if (domain === 'development') {
      return 'development.exec';
    }

    return 'general';
  }

  async buildPostTaskContext(input: {
    step: number;
    taskId: string;
    taskTitle: string;
    runtimeTaskType?: string;
    executionStatus: string;
    executionOutput?: string;
    executionError?: string;
    planDomainType?: string;
    totalGeneratedSteps?: number;
    outlineStepCount?: number;
  }): Promise<string> {
    const output = String(input.executionOutput || '').slice(0, 3000).trim();
    const error = String(input.executionError || '').slice(0, 1000).trim();
    const hasOutput = output.length > 0;
    const hasError = error.length > 0;
    const template = await this.resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.postExecuteContext);

    const executionOutputSection = hasOutput
      ? ['<execution_output>', output, '</execution_output>'].join('\n')
      : 'executionOutput: (空)';
    const executionErrorSection = hasError
      ? ['<execution_error>', error, '</execution_error>'].join('\n')
      : '';

    const totalSteps = input.outlineStepCount;
    let progressSection = '';
    if (input.planDomainType === 'development' || (totalSteps && totalSteps > 1)) {
      const completed = input.totalGeneratedSteps ?? input.step;
      const stepCount = totalSteps || 3;
      const progressLines = ['## 多步流程进度'];
      if (input.planDomainType === 'development') {
        progressLines.push('当前计划类型: development（由 rd-workflow 技能定义的多步流程）');
      }
      progressLines.push(`已完成步骤数: ${completed}`);
      progressLines.push(`计划总步骤数: ${stepCount}（step1 → step${stepCount}）`);
      progressSection = progressLines.join('\n');
    }

    const decisionRules: string[] = [];
    if (input.planDomainType === 'development' || (totalSteps && totalSteps > 1)) {
      const stepCount = totalSteps || 3;
      const completed = input.totalGeneratedSteps ?? input.step;
      if (completed < stepCount) {
        decisionRules.push(`当前 ${completed}/${stepCount} 步已完成，流程尚未结束。`);
        decisionRules.push('- executionStatus=completed 且 <execution_output> 非空 → 必须返回 action="generate_next"');
        decisionRules.push('- executionStatus=failed → 返回 action="retry" 或 action="redesign"');
        decisionRules.push(`- 仅当全部 ${stepCount} 步都完成后才允许 action="stop"`);
      } else {
        decisionRules.push(`全部 ${stepCount} 步已完成，应返回 action="stop"。`);
      }
    } else {
      decisionRules.push('- executionStatus=completed 且输出有效 → action="generate_next" 或 action="stop"');
      decisionRules.push('- executionStatus=failed → action="retry" 或 action="redesign"');
    }

    return this.renderTemplate(template, {
      step: String(input.step),
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      runtimeTaskType: input.runtimeTaskType || 'general',
      executionStatus: input.executionStatus,
      executionOutputSection,
      executionErrorSection,
      progressSection,
      decisionRulesSection: decisionRules.join('\n'),
    }).trim();
  }

  buildOrchestrationCollaborationContext(
    task: OrchestrationTask | OrchestrationTaskDocument,
    options: { dependencyContext?: string; executorAgentId?: string } = {},
  ): Record<string, unknown> {
    return CollaborationContextFactory.orchestration({
      planId: String((task as any).planId || '').trim(),
      roleInPlan: 'executor',
      currentTaskId: this.getEntityId(task as any),
      currentTaskTitle: task.title,
      executorAgentId: options.executorAgentId,
      dependencies: task.dependencyTaskIds || [],
      upstreamOutputs: options.dependencyContext || '',
    });
  }

  resolveRequirementIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    const metadata = (plan.metadata || {}) as Record<string, unknown>;
    const taskContext = this.resolvePlanTaskContextFromMetadata(metadata);
    return String(taskContext.requirementId || metadata.requirementId || '').trim() || undefined;
  }

  resolveRequirementObjectIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    const raw = String(this.resolveRequirementIdFromPlan(plan) || '').trim();
    if (!raw || !Types.ObjectId.isValid(raw)) {
      return undefined;
    }
    return new Types.ObjectId(raw).toString();
  }

  parseRequirementObjectId(requirementId?: string): Types.ObjectId | undefined {
    const normalized = String(requirementId || '').trim();
    if (!normalized) {
      return undefined;
    }
    if (!Types.ObjectId.isValid(normalized)) {
      return undefined;
    }
    return new Types.ObjectId(normalized);
  }

  resolvePlanTaskContextFromMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    const candidate = (metadata as Record<string, unknown>).taskContext;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {};
    }
    return candidate as Record<string, unknown>;
  }

  getRunTaskId(runTask: OrchestrationRunTaskDocument): string {
    return this.getEntityId(runTask as any);
  }

  normalizeRuntimeTaskTypeOverride(
    value?: string,
  ):
    | 'research'
    | 'development.plan'
    | 'development.exec'
    | 'development.review'
    | 'general'
    | null {
    if (!value) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (
      normalized === 'research'
      || normalized === 'development.plan'
      || normalized === 'development.exec'
      || normalized === 'development.review'
      || normalized === 'general'
    ) {
      return normalized;
    }
    return null;
  }

  getRetryFailureHint(task: OrchestrationTask): string {
    const logs = task.runLogs || [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (log.level === 'error' && log.message) {
        return log.message;
      }
    }
    return '';
  }

  private async resolvePromptFromRegistry(entry: OrchestrationPromptEntry): Promise<string> {
    const resolved = await this.agentClientService.resolvePrompt({
      scene: entry.scene,
      role: entry.role,
      defaultContent: entry.buildDefaultContent(),
    });
    return String(resolved.content || '').trim() || entry.buildDefaultContent();
  }

  private renderTemplate(template: string, params: Record<string, unknown>): string {
    return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => {
      const value = params[key];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  private tryParseJsonObject(content: string): Record<string, any> | null {
    const normalized = String(content || '').trim();
    if (!normalized) {
      return null;
    }
    try {
      const parsed = JSON.parse(normalized);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private normalizeRuntimeTaskType(
    input: unknown,
  ): 'research' | 'development.plan' | 'development.exec' | 'development.review' | 'general' {
    const normalized = String(input || '').trim().toLowerCase();
    if (
      normalized === 'research'
      || normalized === 'development.plan'
      || normalized === 'development.exec'
      || normalized === 'development.review'
      || normalized === 'general'
    ) {
      return normalized;
    }
    return 'general';
  }

  private getEntityId(entity: Record<string, any>): string {
    const docId = entity?._id;
    if (typeof docId === 'string') {
      return docId;
    }
    if (docId?.toString) {
      return docId.toString();
    }
    return String(entity?.id || '');
  }

  private buildPlanTaskContextSection(planTaskContext?: Record<string, unknown>): string {
    const context = planTaskContext && typeof planTaskContext === 'object' ? planTaskContext : {};
    const lines = Object.entries(context)
      .filter(([key, value]) => Boolean(String(key || '').trim()) && value !== undefined && value !== null)
      .map(([key, value]) => `- ${key}: ${this.stringifyPlanTaskContextValue(value)}`);

    if (lines.length === 0) {
      return '';
    }

    return [
      '## 计划上下文（系统自动注入，不可修改）',
      ...lines,
    ].join('\n');
  }

  private stringifyPlanTaskContextValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

}
