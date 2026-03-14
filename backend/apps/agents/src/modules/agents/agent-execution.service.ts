import { Injectable } from '@nestjs/common';
import { AIModel, ChatMessage } from '../../../../../src/shared/types';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';

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
}
