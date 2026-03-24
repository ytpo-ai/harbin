import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { MeetingEvent } from '../meeting.types';

@Injectable()
export class MeetingEventService {
  private readonly logger = new Logger(MeetingEventService.name);
  private eventListeners = new Map<string, ((event: MeetingEvent) => void)[]>();

  constructor(private readonly redisService: RedisService) {}

  subscribeToEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    if (!this.eventListeners.has(meetingId)) {
      this.eventListeners.set(meetingId, []);
    }
    this.eventListeners.get(meetingId)!.push(callback);
  }


  unsubscribeFromEvents(meetingId: string, callback: (event: MeetingEvent) => void): void {
    const listeners = this.eventListeners.get(meetingId);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) listeners.splice(index, 1);
    }
  }


  async emitEvent(meetingId: string, event: MeetingEvent): Promise<void> {
    void this.redisService.publish(`meeting:${meetingId}`, event).catch(() => {
      // ignore redis publish errors
    });

    const listeners = this.eventListeners.get(meetingId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          this.logger.error(`Error in event listener: ${error.message}`);
        }
      });
    }
  }
}
