import { Injectable } from '@nestjs/common';

import { ModelService } from '@agent/modules/models/model.service';

import { AgentExecutorEngine } from './agent-executor-engine.interface';
import { AgentExecutorEngineInput, AgentExecutorEngineResult } from './agent-executor-engine.types';

@Injectable()
export class NativeAgentExecutorEngine implements AgentExecutorEngine {
  readonly mode = 'detailed' as const;
  readonly channel = 'native' as const;

  constructor(private readonly modelService: ModelService) {}

  async execute(input: AgentExecutorEngineInput): Promise<AgentExecutorEngineResult> {
    const customApiKey = await input.resolveCustomApiKey('task');
    this.modelService.ensureProviderWithKey(input.modelConfig, customApiKey);

    const response = await input.executeWithToolCalling(
      input.agent,
      input.task,
      input.messages,
      input.modelConfig,
      input.runtimeContext,
        {
          collaborationContext: input.context?.collaborationContext,
          actor: input.context?.actor,
          taskType: input.task.type,
          teamId: input.task.teamId,
          preactivatedToolIds: Array.isArray((input.context?.sessionContext as any)?.preactivatedToolIds)
            ? ((input.context?.sessionContext as any).preactivatedToolIds as string[])
            : undefined,
        },
      );

    return { response };
  }
}
