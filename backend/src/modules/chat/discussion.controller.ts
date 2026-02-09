import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { DiscussionService } from './discussion.service';
import { Discussion, DiscussionMessage } from '../../shared/types';

@Controller('discussions')
export class DiscussionController {
  constructor(private readonly discussionService: DiscussionService) {}

  @Post()
  async createDiscussion(@Body() body: { 
    taskId: string, 
    participantIds: string[], 
    initialPrompt?: string 
  }) {
    return this.discussionService.createDiscussion(
      body.taskId, 
      body.participantIds, 
      body.initialPrompt
    );
  }

  @Get(':id')
  getDiscussion(@Param('id') id: string) {
    return this.discussionService.getDiscussion(id);
  }

  @Get()
  getAllDiscussions() {
    return this.discussionService.getAllDiscussions();
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string, 
    @Body() body: { 
      agentId: string, 
      content: string, 
      type?: DiscussionMessage['type'] 
    }) {
    return this.discussionService.sendMessage(
      id, 
      body.agentId, 
      body.content, 
      body.type
    );
  }

  @Post(':id/conclude')
  async concludeDiscussion(@Param('id') id: string, @Body() body: { summary?: string }) {
    await this.discussionService.concludeDiscussion(id, body.summary);
    return { message: 'Discussion concluded' };
  }

  @Post(':id/pause')
  async pauseDiscussion(@Param('id') id: string) {
    await this.discussionService.pauseDiscussion(id);
    return { message: 'Discussion paused' };
  }

  @Post(':id/resume')
  async resumeDiscussion(@Param('id') id: string) {
    await this.discussionService.resumeDiscussion(id);
    return { message: 'Discussion resumed' };
  }

  @Post(':id/participants')
  async addParticipant(@Param('id') id: string, @Body() body: { agentId: string }) {
    await this.discussionService.addParticipant(id, body.agentId);
    return { message: 'Participant added' };
  }
}