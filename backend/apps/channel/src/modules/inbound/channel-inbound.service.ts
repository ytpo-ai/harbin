import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { CHANNEL_INBOUND_QUEUE_KEY, RedisService } from '@libs/infra';
import { ChannelAuthBridgeService } from './channel-auth-bridge.service';
import { CommandParserService } from './command-parser.service';
import { ChannelSessionService } from './channel-session.service';
import { ChannelUserMappingService, ResolvedChannelEmployee } from './channel-user-mapping.service';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { FeishuCardActionEnvelope, FeishuInboundMessage } from './inbound.types';

@Injectable()
export class ChannelInboundService {
  private readonly logger = new Logger(ChannelInboundService.name);
  private readonly inboundQueueKey = CHANNEL_INBOUND_QUEUE_KEY;
  private readonly gatewayBaseUrl = process.env.GATEWAY_SERVICE_URL || 'http://127.0.0.1:3100';
  private readonly executeTimeoutMs = Math.max(5000, Number(process.env.CHANNEL_AGENT_EXECUTE_TIMEOUT_MS || 120000));
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly redisService: RedisService,
    private readonly commandParser: CommandParserService,
    private readonly mappingService: ChannelUserMappingService,
    private readonly sessionService: ChannelSessionService,
    private readonly authBridgeService: ChannelAuthBridgeService,
    private readonly feishuAppProvider: FeishuAppProvider,
  ) {
    this.httpClient = axios.create({
      baseURL: this.gatewayBaseUrl,
      timeout: this.executeTimeoutMs,
      validateStatus: () => true,
    });
  }

  async enqueueInbound(event: FeishuInboundMessage): Promise<void> {
    await this.redisService.lpush(this.inboundQueueKey, JSON.stringify(event));
  }

  async handleInboundEvent(event: FeishuInboundMessage): Promise<void> {
    const parsed = this.commandParser.parse(event.messageText);
    let resolved = await this.mappingService.resolveEmployee(event.providerType, event.externalUserId);

    if (!resolved) {
      if (parsed.type === 'bind') {
        const email = String(parsed.args.email || '').trim();
        if (!email) {
          await this.feishuAppProvider.replyText(
            event.externalChatId,
            '绑定失败：请使用 `/bind <你的邮箱>` 进行绑定。',
            event.messageId,
          );
          return;
        }

        try {
          await this.mappingService.bindByEmail({
            providerType: event.providerType,
            externalUserId: event.externalUserId,
            email,
            displayName: event.displayName,
          });
          resolved = await this.mappingService.resolveEmployee(event.providerType, event.externalUserId);
          await this.feishuAppProvider.replyText(
            event.externalChatId,
            `绑定成功：${email}，你现在可以直接对话或使用 /help 查看指令。`,
            event.messageId,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown_error';
          await this.feishuAppProvider.replyText(
            event.externalChatId,
            `绑定失败：${reason}`,
            event.messageId,
          );
        }
        return;
      }

      await this.feishuAppProvider.replyText(
        event.externalChatId,
        '你还没有完成账号绑定，请先发送 `/bind <公司邮箱>` 完成身份绑定。',
        event.messageId,
      );
      return;
    }

    await this.routeCommand({
      event,
      parsed,
      resolved,
    });
  }

  async handleCardAction(action: FeishuCardActionEnvelope): Promise<string> {
    const resolved = await this.mappingService.resolveEmployee(action.providerType, action.operatorOpenId);
    if (!resolved) {
      return '未找到用户绑定，请先使用 /bind 完成绑定。';
    }

    const actionName = String(action.actionValue.action || '').trim();
    if (!actionName) {
      return '无法识别卡片动作。';
    }

    try {
      switch (actionName) {
        case 'retry_task': {
          const taskId = String(action.actionValue.taskId || '').trim();
          if (!taskId) {
            return '缺少 taskId，无法重试。';
          }
          await this.callApiAsUser(resolved.employeeId, {
            method: 'post',
            url: `/api/orchestration/tasks/${taskId}/retry`,
            data: {},
          });
          return `任务 ${taskId} 已触发重试。`;
        }
        case 'cancel_plan': {
          const planId = String(action.actionValue.planId || '').trim();
          if (!planId) {
            return '缺少 planId，无法取消。';
          }
          const runId = await this.resolveLatestRunId(resolved.employeeId, planId);
          if (!runId) {
            return `计划 ${planId} 当前没有可取消的运行。`;
          }
          await this.cancelRunById(resolved.employeeId, runId);
          return `计划 ${planId} 的运行 ${runId} 已取消。`;
        }
        case 'cancel_task': {
          const taskId = String(action.actionValue.taskId || '').trim();
          if (!taskId) {
            return '缺少 taskId，无法取消执行。';
          }
          await this.callApiAsUser(resolved.employeeId, {
            method: 'post',
            url: `/api/agents/tasks/${taskId}/cancel`,
            data: {
              reason: 'cancelled_from_feishu_card',
            },
          });
          return `执行任务 ${taskId} 已发送取消请求。`;
        }
        case 'ack_alert':
          return '告警已确认。';
        case 'mute_alert': {
          const duration = Number(action.actionValue.duration || 3600);
          return `告警已静默 ${duration} 秒。`;
        }
        case 'create_followup': {
          const planId = String(action.actionValue.planId || '').trim();
          if (!planId) {
            return '缺少 planId，无法创建后续计划。';
          }
          await this.callApiAsUser(resolved.employeeId, {
            method: 'post',
            url: `/api/orchestration/plans/${planId}/generate-next`,
            data: {},
          });
          return `已基于计划 ${planId} 触发后续计划生成。`;
        }
        default:
          return `暂不支持的动作：${actionName}`;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`Card action failed: action=${actionName} reason=${reason}`);
      return `动作执行失败：${reason}`;
    }
  }

  private async routeCommand(input: {
    event: FeishuInboundMessage;
    parsed: ReturnType<CommandParserService['parse']>;
    resolved: ResolvedChannelEmployee;
  }): Promise<void> {
    const { event, parsed, resolved } = input;

    if (parsed.type === 'help') {
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        [
          '可用指令：',
          '/plan <需求描述> - 创建计划',
          '/status <planId> - 查询计划状态',
          '/cancel <runId|planId> - 取消运行',
          '/agent <agentId> <消息> - 指定 Agent 对话',
          '/new - 重置当前会话上下文',
          '/bind <邮箱> - 绑定账号',
        ].join('\n'),
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'new') {
      await this.sessionService.reset({
        providerType: event.providerType,
        externalChatId: event.externalChatId,
        externalUserId: event.externalUserId,
      });
      await this.feishuAppProvider.replyText(event.externalChatId, '会话上下文已重置。', event.messageId);
      return;
    }

    if (parsed.type === 'plan') {
      const prompt = String(parsed.args.prompt || '').trim();
      if (!prompt) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供计划描述，例如：`/plan 实现日报自动汇总`', event.messageId);
        return;
      }

      const response = await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: '/api/orchestration/plans/from-prompt',
        data: {
          prompt,
          domainType: 'development',
          autoGenerate: true,
          autoRun: true,
        },
      });

      const planId = String(response?.id || response?.planId || '').trim();
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        planId ? `计划已创建：${planId}` : '计划已受理，稍后会推送执行结果。',
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'status') {
      const planId = String(parsed.args.planId || '').trim();
      if (!planId) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供 planId，例如：`/status <planId>`', event.messageId);
        return;
      }

      const plan = await this.callApiAsUser(resolved.employeeId, {
        method: 'get',
        url: `/api/orchestration/plans/${planId}`,
      });
      const status = String(plan?.status || plan?.generationState || 'unknown').trim();
      const title = String(plan?.title || plan?.sourcePrompt || '').trim() || '未命名计划';
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        `计划状态\nID: ${planId}\n标题: ${title}\n状态: ${status}`,
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'cancel') {
      const id = String(parsed.args.id || '').trim();
      if (!id) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供 runId 或 planId，例如：`/cancel <id>`', event.messageId);
        return;
      }

      let cancelledRunId = '';
      try {
        await this.cancelRunById(resolved.employeeId, id);
        cancelledRunId = id;
      } catch {
        const runId = await this.resolveLatestRunId(resolved.employeeId, id);
        if (!runId) {
          await this.feishuAppProvider.replyText(event.externalChatId, `未找到可取消的运行：${id}`, event.messageId);
          return;
        }
        await this.cancelRunById(resolved.employeeId, runId);
        cancelledRunId = runId;
      }

      await this.feishuAppProvider.replyText(event.externalChatId, `已取消运行：${cancelledRunId}`, event.messageId);
      return;
    }

    if (parsed.type === 'agent' || parsed.type === 'chat') {
      const explicitAgentId = parsed.type === 'agent' ? String(parsed.args.agentId || '').trim() : '';
      const prompt =
        parsed.type === 'agent'
          ? String(parsed.args.prompt || '').trim()
          : String(parsed.args.prompt || parsed.rawText || '').trim();

      if (!prompt) {
        await this.feishuAppProvider.replyText(event.externalChatId, '消息为空，请输入你要发送的内容。', event.messageId);
        return;
      }

      const targetAgentId = explicitAgentId || String(resolved.exclusiveAssistantAgentId || '').trim();
      if (!targetAgentId) {
        await this.feishuAppProvider.replyText(event.externalChatId, '未找到可用的专属助理 Agent，请联系管理员。', event.messageId);
        return;
      }

      const session = await this.sessionService.getOrCreate({
        providerType: event.providerType,
        externalChatId: event.externalChatId,
        externalUserId: event.externalUserId,
        employeeId: resolved.employeeId,
        agentId: targetAgentId,
      });

      const directResult = await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: '/api/inner-messages/direct',
        data: {
          senderAgentId: 'system',
          receiverAgentId: targetAgentId,
          eventType: parsed.type === 'agent' ? 'channel.user.agent.command' : 'channel.user.message',
          title: '飞书用户消息',
          content: prompt,
          source: 'channel:feishu',
          payload: {
            channelSource: 'feishu',
            channelChatId: event.externalChatId,
            channelMessageId: event.messageId,
            channelUserId: event.externalUserId,
            employeeId: resolved.employeeId,
            channelSessionId: session._id.toString(),
            sessionId: session.agentSessionId,
            traceId: `${event.externalChatId}:${event.messageId}`,
          },
        },
      });

      const directData = (directResult?.data || directResult) as Record<string, unknown>;
      const messageId = String(directData?.messageId || '').trim();
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        messageId ? `已收到，正在处理中（${messageId}）。` : '已收到，正在处理中。',
        event.messageId,
      );
      return;
    }

    await this.feishuAppProvider.replyText(event.externalChatId, '无法识别该指令，请使用 /help 查看可用命令。', event.messageId);
  }

  private async cancelRunById(employeeId: string, runId: string): Promise<void> {
    await this.callApiAsUser(employeeId, {
      method: 'post',
      url: `/api/orchestration/runs/${runId}/cancel`,
      data: {
        reason: 'cancelled_from_feishu',
      },
    });
  }

  private async resolveLatestRunId(employeeId: string, planId: string): Promise<string | undefined> {
    const response = await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/orchestration/plans/${planId}/runs/latest`,
    });
    const runId = String(response?.id || response?.runId || '').trim();
    return runId || undefined;
  }

  private async callApiAsUser(
    employeeId: string,
    request: {
      method: 'get' | 'post' | 'patch' | 'delete';
      url: string;
      data?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<Record<string, unknown>> {
    const headers = await this.authBridgeService.buildSignedHeaders(employeeId, {
      'content-type': 'application/json',
    });

    const response = await this.httpClient.request({
      method: request.method,
      url: request.url,
      data: request.data,
      params: request.params,
      headers,
    });

    if (response.status >= 400) {
      throw new Error(`api_request_failed:${response.status}`);
    }

    const payload = response.data;
    if (payload && typeof payload === 'object' && 'data' in payload && payload.data && typeof payload.data === 'object') {
      return payload.data as Record<string, unknown>;
    }
    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }

    return {};
  }
}
