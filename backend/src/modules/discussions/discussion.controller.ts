import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AddDiscussionParticipantDto,
  BranchDiscussionThreadDto,
  CreateDiscussionSpaceDto,
  CreateDiscussionKnowledgeEntryDto,
  CreateDiscussionThreadDto,
  GenerateDiscussionSedimentDto,
  ListDiscussionSpacesQuery,
  ListDiscussionKnowledgeQuery,
  SendDiscussionMessageDto,
  UpdateDiscussionSedimentModeDto,
  UpdateDiscussionParticipantDto,
  UpdateDiscussionSpaceDto,
  UpdateDiscussionThreadDto,
} from './discussion.types';
import { DiscussionSpaceStatus } from '../../shared/schemas/discussion-space.schema';
import { DiscussionMessageService } from './services/discussion-message.service';
import { DiscussionKnowledgeService } from './services/discussion-knowledge.service';
import { DiscussionParticipantService } from './services/discussion-participant.service';
import { DiscussionSedimentService } from './services/discussion-sediment.service';
import { DiscussionSpaceService } from './services/discussion-space.service';
import { DiscussionThreadService } from './services/discussion-thread.service';

@Controller('discussions')
export class DiscussionController {
  constructor(
    private readonly discussionSpaceService: DiscussionSpaceService,
    private readonly discussionThreadService: DiscussionThreadService,
    private readonly discussionMessageService: DiscussionMessageService,
    private readonly discussionParticipantService: DiscussionParticipantService,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
    private readonly discussionSedimentService: DiscussionSedimentService,
  ) {}

  @Post()
  async createSpace(@Body() dto: CreateDiscussionSpaceDto) {
    const space = await this.discussionSpaceService.createSpace(dto);
    const rootThread = await this.discussionThreadService.createRootThread(space.id);
    await this.discussionSpaceService.setRootThread(space.id, rootThread.id);
    await this.discussionParticipantService.ensureCreatorParticipant(space.id, dto.creatorId);

    if (dto.initialParticipants?.length) {
      for (const participant of dto.initialParticipants) {
        await this.discussionParticipantService.addParticipant(space.id, participant);
      }
    }

    return this.discussionSpaceService.getSpaceById(space.id);
  }

  @Get()
  async listSpaces(
    @Query('status') status?: DiscussionSpaceStatus,
    @Query('creatorId') creatorId?: string,
    @Query('projectId') projectId?: string,
    @Query('tags') tagsRaw?: string,
  ) {
    const query: ListDiscussionSpacesQuery = {
      status,
      creatorId,
      projectId,
      tags: tagsRaw?.split(',').map((tag) => tag.trim()).filter(Boolean),
    };

    return this.discussionSpaceService.listSpaces(query);
  }

  @Get(':spaceId')
  async getSpaceDetail(@Param('spaceId') spaceId: string) {
    const [space, threadTree, participants] = await Promise.all([
      this.discussionSpaceService.getSpaceById(spaceId),
      this.discussionThreadService.listThreadTree(spaceId),
      this.discussionParticipantService.listParticipants(spaceId),
    ]);

    return {
      ...space,
      threadTree,
      participants,
    };
  }

  @Put(':spaceId')
  async updateSpace(@Param('spaceId') spaceId: string, @Body() dto: UpdateDiscussionSpaceDto) {
    return this.discussionSpaceService.updateSpace(spaceId, dto);
  }

  @Put(':spaceId/status')
  async updateSpaceStatus(@Param('spaceId') spaceId: string, @Body('status') status: DiscussionSpaceStatus) {
    return this.discussionSpaceService.updateStatus(spaceId, status);
  }

  @Delete(':spaceId')
  async archiveSpace(@Param('spaceId') spaceId: string) {
    return this.discussionSpaceService.archiveSpace(spaceId);
  }

  @Post(':spaceId/threads')
  async createThread(@Param('spaceId') spaceId: string, @Body() dto: CreateDiscussionThreadDto) {
    return this.discussionThreadService.createThread(spaceId, dto);
  }

  @Get(':spaceId/threads')
  async getThreadTree(@Param('spaceId') spaceId: string) {
    return this.discussionThreadService.listThreadTree(spaceId);
  }

  @Get(':spaceId/threads/:threadId')
  async getThread(@Param('spaceId') spaceId: string, @Param('threadId') threadId: string) {
    return this.discussionThreadService.getThreadById(spaceId, threadId);
  }

  @Put(':spaceId/threads/:threadId')
  async updateThread(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Body() dto: UpdateDiscussionThreadDto,
  ) {
    return this.discussionThreadService.updateThread(spaceId, threadId, dto);
  }

  @Post(':spaceId/threads/:threadId/messages')
  async sendMessage(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Body() dto: SendDiscussionMessageDto,
  ) {
    return this.discussionMessageService.sendMessage(spaceId, threadId, dto);
  }

  @Get(':spaceId/threads/:threadId/messages')
  async listMessages(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Query('limit') limit?: string,
  ) {
    return this.discussionMessageService.listMessages(spaceId, threadId, Number(limit || 100));
  }

  @Post(':spaceId/threads/:threadId/messages/:messageId/branch')
  async branchFromMessage(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
    @Body() dto: BranchDiscussionThreadDto,
  ) {
    await this.discussionMessageService.getMessageById(spaceId, threadId, messageId);
    return this.discussionThreadService.createThread(spaceId, {
      title: dto.title,
      parentThreadId: threadId,
      branchFromMessageId: messageId,
      contextSummary: dto.contextSummary,
      branchOrigin: dto.branchOrigin,
    });
  }

  @Post(':spaceId/participants')
  async addParticipant(@Param('spaceId') spaceId: string, @Body() dto: AddDiscussionParticipantDto) {
    return this.discussionParticipantService.addParticipant(spaceId, dto);
  }

  @Get(':spaceId/participants')
  async listParticipants(@Param('spaceId') spaceId: string) {
    return this.discussionParticipantService.listParticipants(spaceId);
  }

  @Put(':spaceId/participants/:participantId')
  async updateParticipant(
    @Param('spaceId') spaceId: string,
    @Param('participantId') participantId: string,
    @Body() dto: UpdateDiscussionParticipantDto,
  ) {
    return this.discussionParticipantService.updateParticipant(spaceId, participantId, dto);
  }

  @Delete(':spaceId/participants/:participantId')
  async removeParticipant(@Param('spaceId') spaceId: string, @Param('participantId') participantId: string) {
    await this.discussionParticipantService.removeParticipant(spaceId, participantId);
    return { removed: true };
  }

  @Post(':spaceId/knowledge')
  async createKnowledgeEntry(@Param('spaceId') spaceId: string, @Body() dto: CreateDiscussionKnowledgeEntryDto) {
    return this.discussionKnowledgeService.createKnowledgeEntry(spaceId, dto);
  }

  @Get(':spaceId/knowledge')
  async listKnowledgeEntries(
    @Param('spaceId') spaceId: string,
    @Query('threadId') threadId?: string,
    @Query('participantId') participantId?: string,
    @Query('keyword') keyword?: string,
    @Query('credibility') credibility?: ListDiscussionKnowledgeQuery['credibility'],
    @Query('limit') limit?: string,
  ) {
    const query: ListDiscussionKnowledgeQuery = {
      threadId,
      participantId,
      keyword,
      credibility,
      limit: limit ? Number(limit) : undefined,
    };
    return this.discussionKnowledgeService.listKnowledgeEntries(spaceId, query);
  }

  @Put(':spaceId/sediment/mode')
  async updateSedimentMode(@Param('spaceId') spaceId: string, @Body() dto: UpdateDiscussionSedimentModeDto) {
    return this.discussionSedimentService.updateSedimentMode(spaceId, dto.mode);
  }

  @Post(':spaceId/sediment/generate')
  async generateSediment(@Param('spaceId') spaceId: string, @Body() dto: GenerateDiscussionSedimentDto) {
    return this.discussionSedimentService.generateSediment({
      spaceId,
      threadScope: dto.threadScope,
    });
  }

  @Get(':spaceId/sediment/latest')
  async getLatestSediment(@Param('spaceId') spaceId: string) {
    return this.discussionSedimentService.getLatestSediment(spaceId);
  }
}
