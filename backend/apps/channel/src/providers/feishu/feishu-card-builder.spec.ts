import { FeishuCardBuilder } from './feishu-card-builder';

describe('FeishuCardBuilder', () => {
  it('builds success card with action button', () => {
    const builder = new FeishuCardBuilder();
    const card = builder.buildCard({
      title: '任务完成通知',
      content: '任务执行成功',
      contentType: 'card',
      payload: {
        cardType: 'task_result',
        status: 'completed',
        summary: '执行成功，产出 2 个文件',
        actionUrl: 'https://example.com/task/1',
      },
      sourceEvent: {
        eventId: 'evt-1',
        eventType: 'orchestration.task.completed',
        occurredAt: new Date().toISOString(),
      },
    });

    expect(card).toEqual(
      expect.objectContaining({
        schema: '2.0',
        header: expect.objectContaining({
          template: 'green',
        }),
      }),
    );
    const elements = ((card.body || {}) as Record<string, any>).elements || [];
    expect(elements.some((element) => element.tag === 'action')).toBe(true);
  });
});
