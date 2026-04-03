import { Injectable } from '@nestjs/common';
import { ChannelMessage } from '../../contracts/channel-message.types';

@Injectable()
export class FeishuCardBuilder {
  buildTaskResultCard(message: ChannelMessage): Record<string, unknown> {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const status = String(payload.status || '').trim().toLowerCase();
    const isSuccess = status === 'completed' || status === 'success';
    const summary = String(payload.summary || message.content || '').trim();
    const actionUrl = String(payload.actionUrl || '').trim();

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: isSuccess ? 'green' : 'red',
        title: {
          tag: 'plain_text',
          content: message.title,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**状态**：${isSuccess ? '成功' : '失败'}`,
          },
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**结果摘要**：${summary || '无摘要'}`,
          },
        },
        ...(actionUrl
          ? [
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
            ]
          : []),
      ],
    };
  }
}
