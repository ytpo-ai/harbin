import { Injectable, Logger } from '@nestjs/common';
import { CHANNEL_INBOUND_QUEUE_KEY, RedisService } from '@libs/infra';
import { ChannelApiClientService } from './channel-api-client.service';
import { ChannelMeetingAutoService } from './channel-meeting-auto.service';
import { ChannelMeetingRelayService } from './channel-meeting-relay.service';
import { CommandParserService } from './command-parser.service';
import { ChannelSessionService, SessionFilter } from './channel-session.service';
import { ChannelUserMappingService, ResolvedChannelEmployee } from './channel-user-mapping.service';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { FeishuCardActionEnvelope, FeishuInboundMessage } from './inbound.types';

@Injectable()
export class ChannelInboundService {
  private readonly logger = new Logger(ChannelInboundService.name);
  private readonly inboundQueueKey = CHANNEL_INBOUND_QUEUE_KEY;
  private readonly inboundDedupTtlSeconds = Math.max(60, Number(process.env.CHANNEL_INBOUND_DEDUP_TTL_SECONDS || 600));
  private readonly feishuBindTokenPrefix = 'channel:feishu-bind:';
  private readonly allowEmailBindFallback = String(process.env.FEISHU_BIND_EMAIL_FALLBACK || 'false').toLowerCase() === 'true';
  private readonly emailBindFallbackAdminRoles = new Set(
    String(process.env.FEISHU_BIND_EMAIL_FALLBACK_ADMIN_ROLES || 'founder,co_founder,ceo,cto')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  constructor(
    private readonly redisService: RedisService,
    private readonly commandParser: CommandParserService,
    private readonly mappingService: ChannelUserMappingService,
    private readonly sessionService: ChannelSessionService,
    private readonly apiClient: ChannelApiClientService,
    private readonly meetingAutoService: ChannelMeetingAutoService,
    private readonly meetingRelayService: ChannelMeetingRelayService,
    private readonly feishuAppProvider: FeishuAppProvider,
  ) {}

  async enqueueInbound(event: FeishuInboundMessage): Promise<boolean> {
    const messageId = String(event.messageId || '').trim();
    if (!messageId) {
      return false;
    }

    const dedupKey = `channel:inbound:dedup:${messageId}`;
    const acquired = await this.redisService.setnx(dedupKey, event.receivedAt || new Date().toISOString(), this.inboundDedupTtlSeconds);
    if (!acquired) {
      return false;
    }

    await this.redisService.lpush(this.inboundQueueKey, JSON.stringify(event));
    return true;
  }

  async handleInboundEvent(event: FeishuInboundMessage): Promise<void> {
    try {
      const parsed = this.commandParser.parse(event.messageText);
      let resolved = await this.mappingService.resolveEmployee(event.providerType, event.externalUserId);

      if (!resolved) {
        if (parsed.type === 'bind') {
          const token = String(parsed.args.token || '').trim();
          const email = String(parsed.args.email || '').trim();

          if (token) {
            const employeeId = await this.redisService.getdel(`${this.feishuBindTokenPrefix}${token}`);
            if (!employeeId) {
              await this.feishuAppProvider.replyText(
                event.externalChatId,
                '绑定失败：token 无效或已过期，请在系统中重新生成。',
                event.messageId,
              );
              return;
            }

            try {
              await this.mappingService.bindUser({
                providerType: event.providerType,
                externalUserId: event.externalUserId,
                employeeId,
                displayName: event.displayName,
              });
              resolved = await this.mappingService.resolveEmployee(event.providerType, event.externalUserId);
              const maskedEmail = String(resolved?.email || '').trim();
              const bindTarget = maskedEmail || employeeId;
              await this.feishuAppProvider.replyText(
                event.externalChatId,
                `绑定成功：${bindTarget}，你现在可以直接对话或使用 /help 查看指令。`,
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

          if (!this.allowEmailBindFallback) {
            await this.feishuAppProvider.replyText(
              event.externalChatId,
              '绑定失败：请先在系统中点击「绑定飞书」生成 token，再发送 `/bind token:<token>`。',
              event.messageId,
            );
            return;
          }

          if (!email) {
            await this.feishuAppProvider.replyText(
              event.externalChatId,
              '绑定失败：请使用 `/bind token:<token>`，管理员可使用 `/bind <你的邮箱>`。',
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
              allowedRoles: this.emailBindFallbackAdminRoles,
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
          '你还没有完成账号绑定，请先在系统中生成 token 并发送 `/bind token:<token>` 完成绑定。',
          event.messageId,
        );
        return;
      }

      await this.routeCommand({
        event,
        parsed,
        resolved,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(`handleInboundEvent failed: messageId=${event.messageId} reason=${reason}`);
      await this.feishuAppProvider
        .replyText(event.externalChatId, '系统暂时无法处理该请求，请稍后重试。', event.messageId)
        .catch(() => undefined);
    }
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
          return '当前版本暂不支持「确认告警」回写，请在系统内处理。';
        case 'mute_alert': {
          const duration = Number(action.actionValue.duration || 3600);
          return `当前版本暂不支持静默告警（请求 ${duration} 秒），请在系统内处理。`;
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
    const sessionFilter: SessionFilter = {
      providerType: event.providerType,
      externalChatId: event.externalChatId,
      externalUserId: event.externalUserId,
    };

    if (parsed.type === 'help') {
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        [
          '可用指令：',
          '',
          '计划：',
          '  /plan new <需求描述>     - 创建计划',
          '  /plan status <planId>   - 查询计划状态',
          '  /plan cancel <id>       - 取消运行',
          '',
          '对话：',
          '  /agent chat <agentId> <消息> - 指定 Agent 对话',
          '  直接输入文字               - 与默认 Agent 对话',
          '',
          '会话：',
          '  /session reset           - 重置会话（结束当前对话）',
          '',
          '会议：',
          '  /meeting list            - 查看进行中的会议',
          '  /meeting create <标题>    - 创建多人会议',
          '  /meeting join <meetingId> - 加入会议',
          '  /meeting leave           - 离开当前会议',
          '  /meeting end             - 结束当前会议',
          '',
          '其他：',
          '  /bind token:<token>      - 绑定账号',
          '  /help                    - 显示此帮助',
          '',
          '所有对话自动保存，可在系统前端查看历史。',
        ].join('\n'),
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'unknown_command') {
      await this.feishuAppProvider.replyText(event.externalChatId, '未知指令，输入 /help 查看可用命令。', event.messageId);
      return;
    }

    if (parsed.type === 'session_reset') {
      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      if (activeMeeting?.meetingType === 'one_on_one') {
        await this.meetingAutoService.endOneOnOneMeeting({
          meetingId: activeMeeting.meetingId,
          employeeId: resolved.employeeId,
          sessionFilter,
        });
      } else if (activeMeeting?.meetingId) {
        await this.meetingRelayService.stopRelay(activeMeeting.meetingId, resolved.employeeId);
        await this.sessionService.clearActiveMeeting(sessionFilter);
      }

      await this.sessionService.reset(sessionFilter);
      await this.feishuAppProvider.replyText(event.externalChatId, '会话已重置。', event.messageId);
      return;
    }

    if (parsed.type === 'plan_new') {
      const prompt = String(parsed.args.prompt || '').trim();
      if (!prompt) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供计划描述，例如：`/plan new 实现日报自动汇总`', event.messageId);
        return;
      }

      const response = (await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: '/api/orchestration/plans/from-prompt',
        data: {
          prompt,
          domainType: 'development',
          autoGenerate: true,
          autoRun: true,
        },
      })) as Record<string, unknown>;

      const planId = String(response?.id || response?.planId || '').trim();
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        planId ? `计划已创建：${planId}` : '计划已受理，稍后会推送执行结果。',
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'plan_status') {
      const planId = String(parsed.args.planId || '').trim();
      if (!planId) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供 planId，例如：`/plan status <planId>`', event.messageId);
        return;
      }

      const plan = (await this.callApiAsUser(resolved.employeeId, {
        method: 'get',
        url: `/api/orchestration/plans/${planId}`,
      })) as Record<string, unknown>;
      const status = String(plan?.status || plan?.generationState || 'unknown').trim();
      const title = String(plan?.title || plan?.sourcePrompt || '').trim() || '未命名计划';
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        `计划状态\nID: ${planId}\n标题: ${title}\n状态: ${status}`,
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'plan_cancel') {
      const id = String(parsed.args.id || '').trim();
      if (!id) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供 runId 或 planId，例如：`/plan cancel <id>`', event.messageId);
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

    if (parsed.type === 'meeting_list') {
      const response = await this.callApiAsUser(resolved.employeeId, {
        method: 'get',
        url: `/api/meetings/by-participant/${resolved.employeeId}`,
        params: { type: 'employee' },
      });
      const meetings = Array.isArray(response) ? response : [];
      const visibleMeetings = meetings.filter((item) => {
        const meeting = item as Record<string, unknown>;
        const meetingType = String(meeting.type || '').trim();
        const status = String(meeting.status || '').trim();
        if (meetingType === 'one_on_one' || status !== 'active') {
          return false;
        }

        const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
        return participants.some((participant) => {
          const row = participant as Record<string, unknown>;
          return String(row.participantType || '').trim() === 'employee' && String(row.participantId || '').trim() === resolved.employeeId;
        });
      });

      if (visibleMeetings.length === 0) {
        await this.feishuAppProvider.replyText(event.externalChatId, '当前没有进行中的会议。', event.messageId);
        return;
      }

      const lines = visibleMeetings.map((item, index) => {
        const meeting = item as Record<string, unknown>;
        const id = String(meeting.id || '').trim();
        const title = String(meeting.title || id || `会议-${index + 1}`).trim();
        const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
        return `${index + 1}. ${title}\n   ID: ${id}\n   参与人数: ${participants.length}`;
      });
      await this.feishuAppProvider.replyText(event.externalChatId, ['进行中的会议：', ...lines].join('\n'), event.messageId);
      return;
    }

    if (parsed.type === 'meeting_create') {
      const title = String(parsed.args.title || '').trim();
      if (!title) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供会议标题，例如：`/meeting create 研发评审会`', event.messageId);
        return;
      }

      const created = (await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: '/api/meetings',
        data: {
          title,
          type: 'ad_hoc',
          hostId: resolved.employeeId,
          hostType: 'employee',
        },
      })) as Record<string, unknown>;
      const meetingId = String(created.id || '').trim();
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        `会议已创建：${title}（${meetingId}），使用 /meeting join ${meetingId} 加入。`,
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'meeting_join') {
      const meetingId = String(parsed.args.meetingId || '').trim();
      if (!meetingId) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请提供 meetingId，例如：`/meeting join <meetingId>`', event.messageId);
        return;
      }

      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      if (activeMeeting?.meetingType === 'one_on_one') {
        await this.meetingRelayService.stopRelay(activeMeeting.meetingId, resolved.employeeId);
      }

      await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/join`,
        data: {
          id: resolved.employeeId,
          type: 'employee',
          name: resolved.employeeId,
          isHuman: true,
        },
      });

      await this.sessionService.setActiveMeeting(sessionFilter, meetingId, 'ad_hoc', resolved.employeeId);
      await this.meetingRelayService.startRelay({
        meetingId,
        chatId: event.externalChatId,
        employeeId: resolved.employeeId,
      });

      const meeting = (await this.callApiAsUser(resolved.employeeId, {
        method: 'get',
        url: `/api/meetings/${meetingId}`,
      })) as Record<string, unknown>;
      const title = String(meeting.title || meetingId).trim();
      await this.feishuAppProvider.replyText(
        event.externalChatId,
        `已加入会议「${title}」，当前进入会议模式——直接输入文字即为发言，/meeting leave 退出会议。`,
        event.messageId,
      );
      return;
    }

    if (parsed.type === 'meeting_leave') {
      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      if (!activeMeeting) {
        await this.feishuAppProvider.replyText(event.externalChatId, '你当前不在任何会议中。', event.messageId);
        return;
      }

      await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: `/api/meetings/${activeMeeting.meetingId}/leave`,
        data: {
          id: resolved.employeeId,
          type: 'employee',
          name: resolved.employeeId,
          isHuman: true,
        },
      }).catch(() => undefined);

      await this.meetingRelayService.stopRelay(activeMeeting.meetingId, resolved.employeeId);
      await this.sessionService.clearActiveMeeting(sessionFilter);
      await this.feishuAppProvider.replyText(event.externalChatId, '已离开会议，恢复正常对话模式。', event.messageId);
      return;
    }

    if (parsed.type === 'meeting_end') {
      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      if (!activeMeeting) {
        await this.feishuAppProvider.replyText(event.externalChatId, '你当前不在任何会议中。', event.messageId);
        return;
      }

      await this.callApiAsUser(resolved.employeeId, {
        method: 'post',
        url: `/api/meetings/${activeMeeting.meetingId}/end`,
      });
      await this.meetingRelayService.stopRelay(activeMeeting.meetingId, resolved.employeeId);
      await this.sessionService.clearActiveMeeting(sessionFilter);
      await this.feishuAppProvider.replyText(event.externalChatId, '会议已结束。', event.messageId);
      return;
    }

    if (parsed.type === 'agent_chat') {
      const agentId = String(parsed.args.agentId || '').trim();
      const prompt = String(parsed.args.prompt || '').trim();
      if (!agentId || !prompt) {
        await this.feishuAppProvider.replyText(event.externalChatId, '请使用 `/agent chat <agentId> <消息>`。', event.messageId);
        return;
      }

      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      let meetingId = '';
      if (activeMeeting?.meetingType === 'one_on_one') {
        const currentAgentId = await this.getOneOnOneMeetingAgentId(activeMeeting.meetingId, resolved.employeeId);
        if (currentAgentId && currentAgentId !== agentId) {
          meetingId = await this.meetingAutoService.switchAgent({
            employeeId: resolved.employeeId,
            newAgentId: agentId,
            currentMeetingId: activeMeeting.meetingId,
            sessionFilter,
            chatId: event.externalChatId,
          });
        } else {
          meetingId = activeMeeting.meetingId;
        }
      } else {
        meetingId = await this.meetingAutoService.resolveOrCreateOneOnOneMeeting({
          employeeId: resolved.employeeId,
          agentId,
          sessionFilter,
          chatId: event.externalChatId,
        });
      }

      await this.sendMeetingMessage(meetingId, resolved.employeeId, prompt);
      return;
    }

    if (parsed.type === 'chat') {
      const prompt = String(parsed.args.prompt || parsed.rawText || '').trim();
      if (!prompt) {
        await this.feishuAppProvider.replyText(event.externalChatId, '消息为空，请输入你要发送的内容。', event.messageId);
        return;
      }

      const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
      if (activeMeeting) {
        await this.sendMeetingMessage(activeMeeting.meetingId, resolved.employeeId, prompt);
        return;
      }

      const defaultAgentId = String(resolved.exclusiveAssistantAgentId || '').trim();
      if (!defaultAgentId) {
        await this.feishuAppProvider.replyText(event.externalChatId, '未绑定默认 Agent，请使用 /agent chat <agentId> 指定。', event.messageId);
        return;
      }

      const meetingId = await this.meetingAutoService.resolveOrCreateOneOnOneMeeting({
        employeeId: resolved.employeeId,
        agentId: defaultAgentId,
        sessionFilter,
        chatId: event.externalChatId,
      });

      await this.sendMeetingMessage(meetingId, resolved.employeeId, prompt);
      return;
    }

    await this.feishuAppProvider.replyText(event.externalChatId, '未知指令，输入 /help 查看可用命令。', event.messageId);
  }

  private async sendMeetingMessage(meetingId: string, employeeId: string, content: string): Promise<void> {
    await this.callApiAsUser(employeeId, {
      method: 'post',
      url: `/api/meetings/${meetingId}/messages`,
      data: {
        senderId: employeeId,
        senderType: 'employee',
        content,
        type: 'opinion',
        metadata: {
          source: 'feishu',
        },
      },
    });
  }

  private async getOneOnOneMeetingAgentId(meetingId: string, employeeId: string): Promise<string | undefined> {
    // This helper is only used for one_on_one sessions.
    const meeting = (await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/meetings/${meetingId}`,
    })) as Record<string, unknown>;
    const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
    const target = participants.find((item) => {
      const participant = item as Record<string, unknown>;
      return String(participant.participantType || '').trim() === 'agent';
    }) as Record<string, unknown> | undefined;
    const agentId = String(target?.participantId || '').trim();
    return agentId || undefined;
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
    const response = (await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/orchestration/plans/${planId}/runs/latest`,
    })) as Record<string, unknown>;
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
  ): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    return this.apiClient.callApiAsUser(employeeId, request);
  }
}
