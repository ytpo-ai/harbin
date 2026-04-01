import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ChatMessage } from '../../../../../src/shared/types';
import { Agent, AgentDocument } from '../../schemas/agent.schema';
import { ApiKeyService } from '@legacy/modules/api-keys/api-key.service';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { AgentRunScoreService } from './agent-run-score.service';
import { ModelService } from '../models/model.service';

@Injectable()
export class RuntimeRunDiagnosisService {
  private readonly logger = new Logger(RuntimeRunDiagnosisService.name);

  constructor(
    private readonly persistence: RuntimePersistenceService,
    private readonly runScoreService: AgentRunScoreService,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
  ) {}

  private buildRecentContext(
    messages: Array<{ role: string; content: string; timestamp: Date }>,
  ): Array<{ role: string; content: string; timestamp: Date }> {
    const result: Array<{ role: string; content: string; timestamp: Date }> = [];
    let assistantRounds = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      result.push(item);
      if (item.role === 'assistant') {
        assistantRounds += 1;
      }
      if (assistantRounds >= 15) {
        break;
      }
    }
    return result.reverse();
  }

  private toCompactJson(value: unknown): string {
    try {
      const raw = JSON.stringify(value);
      if (!raw) return '-';
      return raw.length > 1200 ? `${raw.slice(0, 1200)}...(truncated)` : raw;
    } catch {
      return '-';
    }
  }

  private async buildDiagnosisInput(runId: string, question: string): Promise<{ modelConfig: AIModel; chatMessages: ChatMessage[] }> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      throw new NotFoundException('Runtime run not found');
    }

    const [messagesWithParts, score, agent, initialSysMessages] = await Promise.all([
      this.persistence.listRunMessagesWithParts(runId),
      this.runScoreService.getScoreByRunId(runId),
      this.agentModel.findOne({ $or: [{ id: run.agentId }, { _id: run.agentId }] }).lean().exec(),
      run.sessionId ? this.persistence.getSessionInitialSystemMessages(run.sessionId) : Promise.resolve(undefined),
    ]);

    if (!agent?.model?.id || !agent?.model?.name || !agent?.model?.provider || !agent?.model?.model) {
      throw new NotFoundException('Agent model config not found');
    }

    const modelConfig: AIModel = {
      id: String(agent.model.id),
      name: String(agent.model.name),
      provider: String(agent.model.provider) as AIModel['provider'],
      model: String(agent.model.model),
      maxTokens: Number(agent.model.maxTokens || 4096),
      temperature: 0.2,
      topP: Number(agent.model.topP ?? 1),
      reasoning: agent.model.reasoning,
    };

    // 从 Agent 绑定的 apiKeyId 解密获取自定义 API Key，与正常任务执行链路一致
    let resolvedApiKey: string | undefined;
    const apiKeyId = (agent as any).apiKeyId;
    if (apiKeyId) {
      const decrypted = await this.apiKeyService.getDecryptedKey(String(apiKeyId));
      if (decrypted) {
        resolvedApiKey = decrypted;
        this.logger.log(`[diagnose_api_key] runId=${runId} agent=${agent.name} source=custom`);
      } else {
        this.logger.warn(`[diagnose_api_key] runId=${runId} agent=${agent.name} customApiKeyNotAvailable fallback=system`);
      }
    }
    this.modelService.ensureProviderWithKey(modelConfig, resolvedApiKey);

    // 初始 system messages（Identity/Toolset/Deduction 等）存于 session 级缓存，
    // 不在 agent_messages 的 task run 消息中，需单独补入。
    const initialSystemChatMessages: Array<{ role: 'system'; content: string; timestamp: Date }> =
      (initialSysMessages || []).map((msg) => ({
        role: 'system' as const,
        content: String(msg.content || ''),
        timestamp: new Date((run as any).createdAt || Date.now()),
      }));

    const runSystemMessages = messagesWithParts
      .filter((message) => message.role === 'system')
      .map((message) => ({
        role: 'system' as const,
        content: String(message.content || ''),
        timestamp: new Date(message.timestamp || Date.now()),
      }));

    const systemMessages = [...initialSystemChatMessages, ...runSystemMessages];

    const interactionMessages = this.buildRecentContext(
      messagesWithParts
        .filter((message) => message.role !== 'system')
        .map((message) => {
          const partSummary = (message.parts || [])
            .map((part) => `${part.type}${part.toolId ? `(${part.toolId})` : ''}:${part.error || part.content || this.toCompactJson(part.output || part.input)}`)
            .join('\n');
          const merged = [String(message.content || ''), partSummary].filter(Boolean).join('\n');
          return {
            role: message.role,
            content: merged,
            timestamp: new Date(message.timestamp || Date.now()),
          };
        }),
    );

    const diagnosticSystem: ChatMessage = {
      role: 'system',
      content:
        '你是一个 AI Agent 调试分析师。你会基于完整执行记录进行因果分析，明确指出具体轮次、触发规则、证据片段，并给出可执行改进建议。不要泛泛而谈。',
      timestamp: new Date(),
    };

    const scoreSummary = score
      ? `score=${Math.round(score.score)}/100 totalDeductions=${score.totalDeductions} rounds=${score.stats.totalRounds} toolCalls=${score.stats.totalToolCalls}`
      : 'score=unknown';

    const userPrompt: ChatMessage = {
      role: 'user',
      content: [
        `RunId: ${runId}`,
        `TaskTitle: ${run.taskTitle || '-'}`,
        `Status: ${run.status}`,
        `ScoreSummary: ${scoreSummary}`,
        `Deductions: ${this.toCompactJson(score?.deductions || [])}`,
        '--- User Question ---',
        question,
        '--- Requirements ---',
        '1) 明确回答问题。',
        '2) 引用关键证据（轮次/消息/工具调用/扣分规则）。',
        '3) 输出 3-5 条可执行改进建议。',
      ].join('\n'),
      timestamp: new Date(),
    };

    const chatMessages: ChatMessage[] = [
      diagnosticSystem,
      ...systemMessages,
      ...interactionMessages.map((msg) => ({
        role: msg.role as ChatMessage['role'],
        content: msg.content,
        timestamp: msg.timestamp,
      })),
      userPrompt,
    ];

    return {
      modelConfig,
      chatMessages,
    };
  }

  async diagnose(runId: string, question: string): Promise<string> {
    const { modelConfig, chatMessages } = await this.buildDiagnosisInput(runId, question);

    const result = await this.modelService.chat(modelConfig.id, chatMessages, {
      temperature: 0.2,
      maxTokens: 1800,
    });

    return String(result.response || '').trim();
  }

  async diagnoseStream(runId: string, question: string, onChunk: (chunk: string) => void): Promise<string> {
    const { modelConfig, chatMessages } = await this.buildDiagnosisInput(runId, question);

    let fullText = '';
    await this.modelService.streamingChat(
      modelConfig.id,
      chatMessages,
      (token) => {
        const chunk = String(token || '');
        if (!chunk) {
          return;
        }
        fullText += chunk;
        onChunk(chunk);
      },
      {
        temperature: 0.2,
        maxTokens: 1800,
      },
    );

    return fullText.trim();
  }
}
