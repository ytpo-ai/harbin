import { Controller, Get, Query } from '@nestjs/common';
import { MessageCenterService } from './message-center.service';
import {
  InnerMessageMode,
  InnerMessageStatus,
} from '@agents/schemas/inner-message.schema';

@Controller('message-center')
export class MessageCenterController {
  constructor(private readonly messageCenterService: MessageCenterService) {}

  @Get('inner-messages')
  async listInnerMessages(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('mode') mode?: InnerMessageMode,
    @Query('status') status?: InnerMessageStatus,
    @Query('eventType') eventType?: string,
    @Query('source') source?: string,
    @Query('scheduleId') scheduleId?: string,
    @Query('messageId') messageId?: string,
  ) {
    return {
      success: true,
      data: await this.messageCenterService.listInnerMessages({
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        mode,
        status,
        eventType,
        source,
        scheduleId,
        messageId,
      }),
    };
  }
}
