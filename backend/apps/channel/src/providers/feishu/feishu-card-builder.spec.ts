import { FeishuCardBuilder } from './feishu-card-builder';

describe('FeishuCardBuilder', () => {
  it('builds success card with action button', () => {
    const builder = new FeishuCardBuilder();
    const card = builder.buildTaskResultCard({
      title: '任务完成通知',
      content: '任务执行成功',
      contentType: 'card',
      payload: {
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
        header: expect.objectContaining({
          template: 'green',
        }),
      }),
    );
    const elements = (card.elements || []) as Array<Record<string, unknown>>;
    expect(elements.some((element) => element.tag === 'action')).toBe(true);
  });
});
