import { Injectable } from '@nestjs/common';
import { ChatMessage, Task } from '../../../../../src/shared/types';

const ORCHESTRATION_TOOL_IDS = {
  createPlan: 'builtin.sys-mg.mcp.orchestration.create-plan',
  updatePlan: 'builtin.sys-mg.mcp.orchestration.update-plan',
  runPlan: 'builtin.sys-mg.mcp.orchestration.run-plan',
  getPlan: 'builtin.sys-mg.mcp.orchestration.get-plan',
  listPlans: 'builtin.sys-mg.mcp.orchestration.list-plans',
  reassignTask: 'builtin.sys-mg.mcp.orchestration.reassign-task',
  completeHumanTask: 'builtin.sys-mg.mcp.orchestration.complete-human-task',
  createSchedule: 'builtin.sys-mg.mcp.orchestration.create-schedule',
  updateSchedule: 'builtin.sys-mg.mcp.orchestration.update-schedule',
  debugTask: 'builtin.sys-mg.mcp.orchestration.debug-task',
} as const;

const ORCHESTRATION_TOOL_ID_SET = new Set<string>(Object.values(ORCHESTRATION_TOOL_IDS));

export interface ForcedOrchestrationAction {
  tool:
    | 'builtin.sys-mg.mcp.orchestration.create-plan'
    | 'builtin.sys-mg.mcp.orchestration.run-plan'
    | 'builtin.sys-mg.mcp.orchestration.get-plan'
    | 'builtin.sys-mg.mcp.orchestration.list-plans'
    | 'builtin.sys-mg.mcp.orchestration.reassign-task'
    | 'builtin.sys-mg.mcp.orchestration.complete-human-task'
    | 'builtin.sys-mg.mcp.orchestration.create-schedule'
    | 'builtin.sys-mg.mcp.orchestration.update-schedule'
    | 'builtin.sys-mg.mcp.orchestration.debug-task';
  parameters: Record<string, any>;
  reason: string;
}

@Injectable()
export class AgentOrchestrationIntentService {
  hasAnyOrchestrationTool(toolIds: string[] | Set<string>): boolean {
    const ids = toolIds instanceof Set ? Array.from(toolIds) : toolIds;
    return ids.some((toolId) => ORCHESTRATION_TOOL_ID_SET.has(String(toolId || '').trim()));
  }

  extractForcedOrchestrationAction(
    task: Task,
    messages: ChatMessage[],
    assignedToolIds: Set<string>,
    executionContext?: { teamContext?: any; taskType?: string; teamId?: string },
  ): ForcedOrchestrationAction | null {
    const meetingLike =
      task.type === 'meeting' ||
      executionContext?.taskType === 'meeting' ||
      Boolean(executionContext?.teamContext?.meetingId);
    if (!meetingLike) {
      return null;
    }

    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const latestUser = this.normalizeMeetingUserInstruction(latestUserMessage);
    if (!latestUser) {
      return null;
    }
    const lower = latestUser.toLowerCase();
    if (this.hasOrchestrationNegationIntent(lower)) {
      return null;
    }

    const planId = this.extractEntityIdFromText(latestUser, 'plan');
    const taskId = this.extractEntityIdFromText(latestUser, 'task');
    const recoveredPlanId = this.extractRecentPlanIdFromConversation(task, messages);
    const shortRunConfirmIntent = this.isShortRunConfirmIntent(lower) && Boolean(recoveredPlanId);
    const includesAny = (patterns: string[]) => patterns.some((item) => lower.includes(item.toLowerCase()));

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.createPlan) &&
      includesAny(['创建计划', '生成计划', '拆解计划', '编排计划', 'create plan'])
    ) {
      return {
        tool: ORCHESTRATION_TOOL_IDS.createPlan,
        parameters: {
          prompt: latestUser,
          title: task.title || '会议编排计划',
          mode: 'hybrid',
          autoRun: false,
        },
        reason: 'meeting_orchestration_create',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.createSchedule) &&
      includesAny(['创建定时计划', '新增定时计划', '创建调度计划', 'create schedule'])
    ) {
      const selectedPlanId = planId || recoveredPlanId;
      if (!selectedPlanId) {
        if (!assignedToolIds.has(ORCHESTRATION_TOOL_IDS.listPlans)) {
          return null;
        }
        return {
          tool: ORCHESTRATION_TOOL_IDS.listPlans,
          parameters: {},
          reason: 'meeting_orchestration_create_schedule_missing_planid_fallback_list',
        };
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.createSchedule,
        parameters: {
          planId: selectedPlanId,
          scheduleType: 'cron',
          expression: '0 */2 * * *',
          timezone: 'Asia/Shanghai',
          enabled: true,
        },
        reason: 'meeting_orchestration_create_schedule',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.updateSchedule) &&
      includesAny(['修改定时计划', '更新定时计划', '调整定时计划', 'update schedule'])
    ) {
      const scheduleId = this.extractEntityIdFromText(latestUser, 'schedule');
      if (!scheduleId) {
        return null;
      }
      const enabledSignal = includesAny(['启用', 'enable']) ? true : includesAny(['停用', 'disable']) ? false : undefined;
      if (enabledSignal === undefined) {
        return null;
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.updateSchedule,
        parameters: {
          scheduleId,
          enabled: enabledSignal,
        },
        reason: 'meeting_orchestration_update_schedule',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.runPlan) &&
      (includesAny(['执行计划', '运行计划', '开始执行计划', 'run plan']) || shortRunConfirmIntent)
    ) {
      const selectedPlanId = planId || recoveredPlanId;
      if (!selectedPlanId) {
        if (!assignedToolIds.has(ORCHESTRATION_TOOL_IDS.listPlans)) {
          return null;
        }
        return {
          tool: ORCHESTRATION_TOOL_IDS.listPlans,
          parameters: {},
          reason: 'meeting_orchestration_run_missing_planid_fallback_list',
        };
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.runPlan,
        parameters: {
          planId: selectedPlanId,
          continueOnFailure: true,
          confirm: true,
        },
        reason: shortRunConfirmIntent && !planId ? 'meeting_orchestration_run_short_confirm' : 'meeting_orchestration_run',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.getPlan) &&
      includesAny(['查看计划', '计划详情', '查询计划', 'get plan'])
    ) {
      if (!planId) {
        return null;
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.getPlan,
        parameters: {
          planId,
        },
        reason: 'meeting_orchestration_get',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.listPlans) &&
      includesAny(['计划列表', '所有计划', 'list plans'])
    ) {
      return {
        tool: ORCHESTRATION_TOOL_IDS.listPlans,
        parameters: {},
        reason: 'meeting_orchestration_list',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.reassignTask) &&
      includesAny(['改派任务', '重新分配任务', 'reassign task'])
    ) {
      if (!taskId) {
        return null;
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.reassignTask,
        parameters: {
          taskId,
          executorType: 'agent',
          reason: '会议中触发改派',
          confirm: true,
        },
        reason: 'meeting_orchestration_reassign',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.completeHumanTask) &&
      includesAny(['人工完成任务', '完成人工任务', 'complete human task'])
    ) {
      if (!taskId) {
        return null;
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.completeHumanTask,
        parameters: {
          taskId,
          summary: '会议中确认人工任务完成',
          output: latestUser,
          confirm: true,
        },
        reason: 'meeting_orchestration_complete_human',
      };
    }

    if (
      assignedToolIds.has(ORCHESTRATION_TOOL_IDS.debugTask) &&
      includesAny(['调试任务', '任务调试', 'debug task', 'debug-run'])
    ) {
      if (!taskId) {
        return null;
      }
      return {
        tool: ORCHESTRATION_TOOL_IDS.debugTask,
        parameters: {
          taskId,
          resetResult: true,
        },
        reason: 'meeting_orchestration_debug_task',
      };
    }

    return null;
  }

  hasMeetingOrchestrationIntent(
    task: Task,
    messages: ChatMessage[],
    executionContext?: { teamContext?: any; taskType?: string; teamId?: string },
  ): boolean {
    const meetingLike =
      task.type === 'meeting' ||
      executionContext?.taskType === 'meeting' ||
      Boolean(executionContext?.teamContext?.meetingId);
    if (!meetingLike) {
      return false;
    }
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const lower = this.normalizeMeetingUserInstruction(latestUserMessage).toLowerCase();
    if (!lower) {
      return false;
    }
    if (this.hasOrchestrationNegationIntent(lower)) {
      return false;
    }
    return [
      '创建计划',
      '生成计划',
      '编排计划',
      '执行计划',
      '运行计划',
      '计划详情',
      '计划列表',
      '改派任务',
      '人工完成任务',
      'create plan',
      'run plan',
      'create schedule',
      'update schedule',
      '调试任务',
      '任务调试',
      'debug task',
      'debug-run',
      '定时计划',
      '调度计划',
      'orchestration_',
    ].some((item) => lower.includes(item));
  }

  formatForcedOrchestrationAnswer(tool: string, result: any, parameters: Record<string, any>): string {
    const payload = result?.result || result || {};
    if (tool === ORCHESTRATION_TOOL_IDS.createPlan) {
      const planId = payload?.id || payload?._id || payload?.planId || 'unknown';
      const taskCount = Array.isArray(payload?.tasks) ? payload.tasks.length : 0;
      return `已触发计划创建，planId=${planId}，任务数=${taskCount}。如需继续执行，请回复“执行计划 planId:${planId}”。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.updatePlan) {
      return `已提交计划更新（planId=${parameters.planId || 'unknown'}）。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.runPlan) {
      return `已触发计划执行（planId=${parameters.planId}，continueOnFailure=${parameters.continueOnFailure === true ? 'true' : 'false'}）。可继续让我查询执行进度。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.getPlan) {
      const status = payload?.status || 'unknown';
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      const completed = tasks.filter((item: any) => item?.status === 'completed').length;
      const failed = tasks.filter((item: any) => item?.status === 'failed').length;
      const waitingHuman = tasks.filter((item: any) => item?.status === 'waiting_human').length;
      return `计划状态：${status}。任务统计：completed=${completed}，failed=${failed}，waiting_human=${waitingHuman}，total=${tasks.length}。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.listPlans) {
      const plans = Array.isArray(payload) ? payload : Array.isArray(payload?.plans) ? payload.plans : [];
      return `已查询计划列表，当前可见计划数量=${plans.length}。如需执行请提供 planId（例如：执行计划 planId:xxx）。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.reassignTask) {
      return `已提交任务改派请求（taskId=${parameters.taskId}）。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.completeHumanTask) {
      return `已提交人工任务完成回填（taskId=${parameters.taskId}）。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.createSchedule) {
      const scheduleId = payload?.id || payload?._id || payload?.scheduleId || 'unknown';
      const nextRunAt = payload?.nextRunAt || payload?.schedule?.nextRunAt || 'unknown';
      return `已创建定时计划，scheduleId=${scheduleId}，nextRunAt=${nextRunAt}。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.updateSchedule) {
      return `已提交定时计划更新（scheduleId=${parameters.scheduleId}）。`;
    }
    if (tool === ORCHESTRATION_TOOL_IDS.debugTask) {
      const status = payload?.execution?.status || payload?.task?.status || payload?.debug?.status || 'unknown';
      const error = payload?.execution?.error || payload?.debug?.error;
      return error
        ? `已执行任务调试（taskId=${parameters.taskId}，status=${status}），失败原因：${error}`
        : `已执行任务调试（taskId=${parameters.taskId}，status=${status}）。`;
    }
    return `已执行编排工具 ${tool}。`;
  }

  private hasOrchestrationNegationIntent(latestUserLower: string): boolean {
    const normalized = String(latestUserLower || '').trim();
    if (!normalized) {
      return false;
    }

    return [
      '不要执行计划',
      '不执行计划',
      '不是编排',
      '无需编排',
      '不需要编排',
      '取消编排',
      '不要计划编排',
      '不要run plan',
      "don't run plan",
      'not orchestration',
      'no orchestration',
    ].some((item) => normalized.includes(item));
  }

  private isShortRunConfirmIntent(latestUserLower: string): boolean {
    const normalized = String(latestUserLower || '').trim();
    return ['执行', '继续', '开始', 'run', 'go', 'ok执行', '确认执行'].includes(normalized);
  }

  private normalizeMeetingUserInstruction(content: unknown): string {
    const raw = String(content || '').trim();
    if (!raw) {
      return '';
    }

    const wrapped = raw.match(/\[新消息\][^:：]*[:：]\s*([\s\S]*?)(?:\n\n请对此做出回应。?)?$/i);
    if (wrapped?.[1]) {
      return wrapped[1].trim();
    }

    return raw;
  }

  private extractRecentPlanIdFromConversation(task: Task, messages: ChatMessage[]): string | null {
    const source = [...(task.messages || []), ...(messages || [])]
      .map((item) => String(item?.content || ''))
      .reverse();

    for (const text of source) {
      const explicit = text.match(/planId\s*[:=]\s*([a-zA-Z0-9_-]{6,64})/i);
      if (explicit?.[1]) {
        return explicit[1];
      }
      const objectId = text.match(/\b[a-f0-9]{24}\b/i);
      if (objectId?.[0] && /plan|计划/i.test(text)) {
        return objectId[0];
      }
    }

    return null;
  }

  private extractEntityIdFromText(input: string, entity: 'plan' | 'task' | 'schedule'): string | null {
    const text = String(input || '');
    const explicit = text.match(new RegExp(`${entity}\\s*[_-]?id\\s*[:：]\\s*([a-zA-Z0-9_-]{6,64})`, 'i'));
    if (explicit?.[1]) {
      return explicit[1];
    }
    const objectId = text.match(/\b[a-f0-9]{24}\b/i);
    if (objectId?.[0]) {
      return objectId[0];
    }
    return null;
  }
}
