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
  teamContext?: {
    sessionId?: string;
    meetingId?: string;
    agendaId?: string;
    latestSummary?: string;
  };
}

@Injectable()
export class AgentExecutionService {
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
    const { runtimeAgentId, agentName, task, messages, mode, roleCode, executionChannel, executionData, teamContext } = options;
    const metadata: Record<string, unknown> = {
      taskType: task.type,
      taskPriority: task.priority,
      roleCode,
      executionChannel,
      executionData,
      sync: {
        state: 'pending',
        retryCount: 0,
      },
    };
    if (mode === 'streaming') {
      metadata.mode = 'streaming';
    }
    if (teamContext?.meetingId) {
      metadata.meetingContext = {
        meetingId: teamContext.meetingId,
        agendaId: teamContext.agendaId,
        latestSummary: teamContext.latestSummary,
      };
    }

    return this.runtimeOrchestrator.startRun({
      agentId: runtimeAgentId,
      agentName,
      taskId: task.id,
      sessionId: typeof teamContext?.sessionId === 'string' ? teamContext.sessionId : undefined,
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
