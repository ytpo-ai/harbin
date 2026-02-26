import { AgentService } from '../../../../src/modules/agents/agent.service';
import { RedisService } from '@libs/infra';
import { AIModel } from '../../../../src/shared/types';
export declare class AgentStreamController {
    private readonly agentService;
    private readonly redisService;
    constructor(agentService: AgentService, redisService: RedisService);
    streamAgentTest(id: string, body: {
        sessionId: string;
        model?: AIModel;
        apiKeyId?: string;
    }): Promise<{
        success: boolean;
        channel: string;
        sessionId: string;
    }>;
}
