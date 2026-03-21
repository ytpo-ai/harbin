import { Injectable } from '@nestjs/common';
import { AIModel, ChatMessage, Task } from '../../../../../src/shared/types';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';

type ExecutionMode = 'detailed' | 'streaming';

interface RuntimeExecutionOptions {
  runtimeAgentId: string;
  agentName: string;
  task: Task;
  messages: ChatMessage[];
  mode: ExecutionMode;
  roleCode?: string;
  executionChannel: 'native' | 'opencode';
  executionData: Record<string, unknown>;
  collaborationContext?: Record<string, unknown>;
}

@Injectable()
export class AgentExecutorRuntimeService {
  constructor(private readonly runtimeOrchestrator: RuntimeOrchestratorService) {}

  resolveRuntimeAgentId(agent: { id?: string; _id?: { toString?: () => string } }, fallbackAgentId: string): string {
    return agent.id || agent._id?.toString?.() || fallbackAgentId;
  }

  buildModelConfig(model: {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    reasoning?: AIModel['reasoning'];
  }): AIModel {
    return {
      id: model.id,
      name: model.name,
      provider: model.provider as AIModel['provider'],
      model: model.model,
      maxTokens: model.maxTokens || 4096,
      temperature: model.temperature ?? 0.7,
      topP: model.topP,
      reasoning: model.reasoning,
    };
  }

  /** @deprecated System context is run-scoped and should not be persisted to session history. */
  async appendSystemMessagesToSession(
    runtimeContext: RuntimeRunContext,
    messages: ChatMessage[],
    agentId?: string,
  ): Promise<void> {
    if (!runtimeContext.sessionId) {
      return;
    }
    const systemMessages = messages
      .filter((msg) => msg.role === 'system')
      .map((msg) => ({
        role: 'system' as const,
        content: msg.content,
        metadata: { source: 'buildMessages', agentId },
      }));
    if (systemMessages.length > 0) {
      await this.runtimeOrchestrator.appendSystemMessagesToSession(runtimeContext.sessionId, systemMessages);
    }
  }

  async startRuntimeExecution(options: RuntimeExecutionOptions): Promise<RuntimeRunContext> {
    const {
      runtimeAgentId,
      agentName,
      task,
      messages,
      mode,
      roleCode,
      executionChannel,
      executionData,
      collaborationContext,
    } = options;
    const mergedCollaborationContext: Record<string, unknown> = {
      ...((collaborationContext || {}) as Record<string, unknown>),
    };
    const meetingId = String(mergedCollaborationContext.meetingId || '').trim();
    const sessionId = String(mergedCollaborationContext.sessionId || '').trim() || undefined;
    const planId = String(mergedCollaborationContext.planId || '').trim() || undefined;
    const domainContext =
      mergedCollaborationContext.domainContext && typeof mergedCollaborationContext.domainContext === 'object'
        ? (mergedCollaborationContext.domainContext as Record<string, unknown>)
        : undefined;
    const metadata: Record<string, unknown> = {
      taskType: task.type,
      taskPriority: task.priority,
      roleCode,
      executionChannel,
      executionData,
      initialSystemMessages: messages
        .filter((msg) => msg.role === 'system')
        .map((msg) => String(msg.content || '').trim())
        .filter((content) => content.length > 0),
      sync: {
        state: 'pending',
        retryCount: 0,
      },
    };
    if (mode === 'streaming') {
      metadata.mode = 'streaming';
    }
    if (meetingId) {
      metadata.meetingContext = {
        meetingId,
        agendaId: String(mergedCollaborationContext.agendaId || '').trim() || undefined,
        meetingType: String(mergedCollaborationContext.meetingType || '').trim() || undefined,
        latestSummary: String(mergedCollaborationContext.latestSummary || '').trim() || undefined,
      };
    }
    if (planId) {
      metadata.planId = planId;
    }
    if (domainContext) {
      metadata.domainContext = domainContext;
    }
    if (Object.keys(mergedCollaborationContext).length > 0) {
      metadata.collaborationContext = mergedCollaborationContext;
    }

    return this.runtimeOrchestrator.startRun({
      agentId: runtimeAgentId,
      agentName,
      taskId: task.id,
      sessionId,
      taskTitle: task.title,
      taskDescription: task.description,
      userContent: this.resolveLatestUserContent(task, messages),
      metadata,
    });
  }

  async completeRuntimeExecution(
    runtimeContext: RuntimeRunContext,
    runtimeAgentId: string,
    taskId: string,
    assistantContent: string,
  ): Promise<void> {
    await this.runtimeOrchestrator.completeRun({
      runId: runtimeContext.runId,
      agentId: runtimeAgentId,
      sessionId: runtimeContext.sessionId,
      taskId,
      assistantContent,
      traceId: runtimeContext.traceId,
    });
  }

  async failRuntimeExecution(
    runtimeContext: RuntimeRunContext,
    runtimeAgentId: string,
    taskId: string,
    error: string,
  ): Promise<void> {
    await this.runtimeOrchestrator.failRun({
      runId: runtimeContext.runId,
      agentId: runtimeAgentId,
      sessionId: runtimeContext.sessionId,
      taskId,
      error,
      traceId: runtimeContext.traceId,
    });
  }

  async releaseRuntimeExecution(runtimeContext: RuntimeRunContext): Promise<void> {
    await this.runtimeOrchestrator.releaseRun(runtimeContext);
  }

  private resolveLatestUserContent(task: Task, messages: ChatMessage[]): string {
    const latestTaskMessage = [...(task.messages || [])].reverse().find((msg) => msg.role === 'user')?.content;
    if (latestTaskMessage) {
      return latestTaskMessage;
    }
    const latestCompiledMessage = [...messages].reverse().find((msg) => msg.role === 'user')?.content;
    if (latestCompiledMessage) {
      return latestCompiledMessage;
    }
    return task.description || task.title || '';
  }
}
