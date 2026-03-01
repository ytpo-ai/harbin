import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessageSceneType } from '../../shared/schemas/message.schema';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  async listMessages(
    @Query('sceneType') sceneType: MessageSceneType,
    @Query('sceneId') sceneId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    if (!sceneType || !sceneId) {
      throw new BadRequestException('sceneType and sceneId are required');
    }

    const parsedLimit = limit ? Number(limit) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    const safeBefore = parsedBefore && !Number.isNaN(parsedBefore.getTime()) ? parsedBefore : undefined;

    const data = await this.messagesService.listSceneMessages({
      sceneType,
      sceneId,
      limit: Number.isFinite(parsedLimit as number) ? parsedLimit : undefined,
      before: safeBefore,
    });

    return {
      success: true,
      data,
    };
  }
}
