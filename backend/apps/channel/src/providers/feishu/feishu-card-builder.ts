import { Injectable } from '@nestjs/common';
import { ChannelMessage } from '../../contracts/channel-message.types';

@Injectable()
export class FeishuCardBuilder {
  buildCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const cardType = String(payload.cardType || '').trim();

    switch (cardType) {
      case 'agent_log':
        return this.buildAgentLogCard(message);
      case 'agent_log_aggregated':
        return this.buildAgentLogAggregatedCard(message);
      case 'alert':
        return this.buildAlertCard(message);
      case 'meeting_ended':
        return this.buildMeetingEndedCard(message);
      case 'meeting_summary':
        return this.buildMeetingSummaryCard(message);
      case 'report':
        return this.buildReportCard(message);
      default:
        return this.buildTaskResultCard(message);
    }
  }

  buildTaskResultCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const status = String(payload.status || '').trim().toLowerCase();
    const isSuccess = status === 'completed' || status === 'success';
    const summary = String(payload.summary || message.content || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();

    return this.wrapCard({
      title: message.title,
      template: isSuccess ? 'green' : 'red',
      elements: [
        this.markdownLine(`**状态**：${isSuccess ? '成功' : '失败'}`),
        this.markdownLine(`**结果摘要**：${summary || '无摘要'}`),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  buildAgentLogCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const status = String(payload.status || '').trim().toLowerCase();
    const statusLabel = status === 'failed' ? '失败' : '完成';
    const durationMs = Number(payload.durationMs || 0);
    const durationText = durationMs > 0 ? `${durationMs}ms` : 'n/a';
    const agentName = String(payload.agentName || payload.agentId || '未知Agent').trim();
    const taskTitle = String(payload.taskTitle || payload.action || '未命名任务').trim();
    const actionUrl = String(payload.actionUrl || '').trim();

    return this.wrapCard({
      title: message.title,
      template: status === 'failed' ? 'red' : 'grey',
      elements: [
        this.markdownLine(`**Agent**：${agentName}`),
        this.markdownLine(`**任务**：${taskTitle}`),
        this.markdownLine(`**状态**：${statusLabel}  |  **耗时**：${durationText}`),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  buildAgentLogAggregatedCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
    const count = Number(payload.count || items.length || 0);
    const windowSeconds = Number(payload.windowSeconds || 60);
    const actionUrl = String(payload.actionUrl || '').trim();

    const lines = items.slice(0, 8).map((item) => {
      const taskTitle = String(item.taskTitle || item.action || '未命名任务').trim();
      const agentName = String(item.agentName || item.agentId || '未知Agent').trim();
      const status = String(item.status || '').trim().toLowerCase();
      const statusIcon = status === 'failed' ? '❌' : '✅';
      return `${statusIcon} ${taskTitle} - ${agentName}`;
    });

    return this.wrapCard({
      title: message.title || 'Agent 执行日志汇总',
      template: 'grey',
      elements: [
        this.markdownLine(`过去 ${windowSeconds} 秒共 ${count} 条执行记录`),
        this.markdownLine(lines.join('\n') || '暂无明细'),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  buildAlertCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const reason = String(payload.reason || message.content || '').trim();
    const scheduleName = String(payload.scheduleName || '').trim();

    return this.wrapCard({
      title: message.title,
      template: 'red',
      elements: [
        this.markdownLine(`**来源**：调度系统`),
        this.markdownLine(`**任务**：${scheduleName || '未知任务'}`),
        this.markdownLine(`**原因**：${reason || '未知'}`),
      ],
    });
  }

  buildMeetingEndedCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const endedAt = String(payload.endedAt || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();

    return this.wrapCard({
      title: message.title,
      template: 'blue',
      elements: [
        this.markdownLine(message.content),
        ...(endedAt ? [this.markdownLine(`**结束时间**：${endedAt}`)] : []),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  buildMeetingSummaryCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const summary = String(payload.summary || message.content || '').trim();
    const actionItems = Array.isArray(payload.actionItems) ? payload.actionItems : [];
    const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    const actionUrl = String(payload.actionUrl || '').trim();

    return this.wrapCard({
      title: message.title,
      template: 'blue',
      elements: [
        this.markdownLine(`**会议纪要**：${summary || '暂无'}`),
        ...(decisions.length ? [this.markdownLine(`**决议**：\n- ${decisions.slice(0, 5).join('\n- ')}`)] : []),
        ...(actionItems.length ? [this.markdownLine(`**待办**：\n- ${actionItems.slice(0, 5).join('\n- ')}`)] : []),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  buildReportCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const executionTime = String(payload.executionTime || '').trim();
    const summary = String(payload.outputSummary || message.content || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();

    return this.wrapCard({
      title: message.title,
      template: 'purple',
      elements: [
        ...(executionTime ? [this.markdownLine(`**执行时间**：${executionTime}`)] : []),
        this.markdownLine(`**摘要**：${summary || '无摘要'}`),
        ...this.buildActionButton(actionUrl),
      ],
    });
  }

  private wrapCard(input: {
    title: string;
    template: string;
    elements: Array<Record<string, unknown>>;
  }): Record<string, unknown> {
    return {
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: input.template,
        title: {
          tag: 'plain_text',
          content: input.title,
        },
      },
      body: {
        elements: input.elements,
      },
    };
  }

  private markdownLine(content: string): Record<string, unknown> {
    return {
      tag: 'markdown',
      content,
    };
  }

  private buildActionButton(actionUrl: string): Array<Record<string, unknown>> {
    if (!actionUrl) {
      return [];
    }

    return [
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: {
              tag: 'plain_text',
              content: '查看详情',
            },
            url: actionUrl,
          },
        ],
      },
    ];
  }
}
