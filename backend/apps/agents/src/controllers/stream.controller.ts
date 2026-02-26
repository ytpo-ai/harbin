import { Body, Controller, Param, Post } from '@nestjs/common';
import { AgentService } from '../../../../src/modules/agents/agent.service';
import { RedisService } from '@libs/infra';
import { StreamChunkEvent } from '@libs/contracts';
import { AIModel } from '../../../../src/shared/types';

@Controller('agents')
export class AgentStreamController {
  constructor(
    private readonly agentService: AgentService,
    private readonly redisService: RedisService,
  ) {}

  @Post(':id/test-stream')
  async streamAgentTest(
    @Param('id') id: string,
    @Body() body: { sessionId: string; model?: AIModel; apiKeyId?: string },
  ): Promise<{ success: boolean; channel: string; sessionId: string }> {
    const sessionId = body.sessionId;
    const channel = `stream:${sessionId}`;

    const startEvent: StreamChunkEvent = {
      sessionId,
      type: 'start',
      timestamp: Date.now(),
    };
    await this.redisService.publish(channel, startEvent);

    const result = await this.agentService.testAgentConnection(id, {
      model: body.model,
      apiKeyId: body.apiKeyId,
    });

    if (!result.success) {
      const errorEvent: StreamChunkEvent = {
        sessionId,
        type: 'error',
        payload: result.error || 'Unknown stream error',
        timestamp: Date.now(),
      };
      await this.redisService.publish(channel, errorEvent);
      return { success: false, channel, sessionId };
    }

    const text = result.response || '';
    const tokens = text.split(/(\s+)/).filter(Boolean);
    for (const token of tokens) {
      const chunkEvent: StreamChunkEvent = {
        sessionId,
        type: 'chunk',
        payload: token,
        timestamp: Date.now(),
      };
      await this.redisService.publish(channel, chunkEvent);
    }

    const doneEvent: StreamChunkEvent = {
      sessionId,
      type: 'done',
      timestamp: Date.now(),
    };
    await this.redisService.publish(channel, doneEvent);

    return { success: true, channel, sessionId };
  }
}
