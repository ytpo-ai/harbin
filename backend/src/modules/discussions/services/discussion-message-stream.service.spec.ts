import { NotFoundException } from '@nestjs/common';
import { DiscussionMessageStreamService } from './discussion-message-stream.service';

describe('DiscussionMessageStreamService', () => {
  const buildService = () => {
    const discussionThreadService = {
      getThreadById: jest.fn(),
    } as any;

    const service = new DiscussionMessageStreamService(discussionThreadService);

    return {
      service,
      discussionThreadService,
    };
  };

  it('emits snapshot first and pushes created message events', async () => {
    const { service, discussionThreadService } = buildService();
    discussionThreadService.getThreadById.mockResolvedValue({ id: 'thread-1' });

    const observable = await service.streamThreadMessages('space-1', 'thread-1');
    const events: any[] = [];
    const subscription = observable.subscribe((event) => events.push(event));

    service.emitMessageCreated('space-1', 'thread-1', {
      id: 'msg-1',
      content: 'hello',
    } as any);

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].data.type).toBe('discussion.message.snapshot');
    expect(events[1].data.type).toBe('discussion.message.created');
    expect(events[1].data.data.message.id).toBe('msg-1');

    subscription.unsubscribe();
  });

  it('throws when target thread does not exist', async () => {
    const { service, discussionThreadService } = buildService();
    discussionThreadService.getThreadById.mockResolvedValue(undefined);

    await expect(service.streamThreadMessages('space-1', 'missing-thread')).rejects.toBeInstanceOf(NotFoundException);
  });
});
