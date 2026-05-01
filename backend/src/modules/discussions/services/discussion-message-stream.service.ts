import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { DiscussionMessage } from '../../../shared/schemas/discussion-message.schema';
import { DiscussionThreadService } from './discussion-thread.service';

@Injectable()
export class DiscussionMessageStreamService {
  private readonly streamChannels = new Map<string, Set<Subject<MessageEvent>>>();

  constructor(private readonly discussionThreadService: DiscussionThreadService) {}

  async streamThreadMessages(spaceId: string, threadId: string): Promise<Observable<MessageEvent>> {
    const thread = await this.discussionThreadService.getThreadById(spaceId, threadId);
    if (!thread) {
      throw new NotFoundException(`讨论线不存在: ${threadId}`);
    }

    const streamKey = this.buildStreamKey(spaceId, threadId);
    return new Observable<MessageEvent>((subscriber) => {
      let channels = this.streamChannels.get(streamKey);
      if (!channels) {
        channels = new Set<Subject<MessageEvent>>();
        this.streamChannels.set(streamKey, channels);
      }

      const channel = new Subject<MessageEvent>();
      const subscription = channel.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      channels.add(channel);
      channel.next({
        data: {
          type: 'discussion.message.snapshot',
          data: {
            spaceId,
            threadId,
          },
        },
      });

      return () => {
        subscription.unsubscribe();
        const target = this.streamChannels.get(streamKey);
        if (!target) {
          return;
        }
        target.delete(channel);
        channel.complete();
        if (!target.size) {
          this.streamChannels.delete(streamKey);
        }
      };
    });
  }

  emitMessageCreated(spaceId: string, threadId: string, message: DiscussionMessage): void {
    const streamKey = this.buildStreamKey(spaceId, threadId);
    const channels = this.streamChannels.get(streamKey);
    if (!channels?.size) {
      return;
    }

    const event: MessageEvent = {
      data: {
        type: 'discussion.message.created',
        data: {
          spaceId,
          threadId,
          message,
        },
      },
    };

    for (const channel of channels) {
      channel.next(event);
    }
  }

  private buildStreamKey(spaceId: string, threadId: string): string {
    return `${spaceId}:${threadId}`;
  }
}
