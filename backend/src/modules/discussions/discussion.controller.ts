import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  AddDiscussionParticipantDto,
  BranchDiscussionThreadDto,
  CreateDiscussionOutlineSectionDto,
  DiscussionOutlineTaskSnapshot,
  EnrichAllDiscussionOutlineSectionsResult,
  EnrichDiscussionOutlineSectionResult,
  CreateDiscussionRequirementDto,
  CreateDiscussionRequirementResult,
  CreateDiscussionSpaceDto,
  CreateDiscussionKnowledgeEntryDto,
  CreateDiscussionThreadDto,
  DeleteDiscussionThreadResult,
  DeleteDiscussionSedimentHistoryDto,
  GenerateDiscussionSedimentDto,
  ListDiscussionSpacesQuery,
  ListDiscussionKnowledgeQuery,
  LinkDiscussionMessageKnowledgeDto,
  LinkDiscussionMessageKnowledgeResult,
  ListDiscussionSedimentHistoryQuery,
  SendDiscussionMessageDto,
  TriggerDiscussionDataAnalysisDto,
  UpdateDiscussionOutlineDto,
  UpdateDiscussionOutlineSectionDto,
  UpdateDiscussionSedimentModeDto,
  UpdateDiscussionParticipantDto,
  UpdateDiscussionSpaceDto,
  UpdateDiscussionThreadDto,
} from './discussion.types';
import { DiscussionSpaceCategory, DiscussionSpaceStatus } from '../../shared/schemas/discussion-space.schema';
import { DiscussionMessageService } from './services/discussion-message.service';
import { DiscussionKnowledgeService } from './services/discussion-knowledge.service';
import { DiscussionOutlineService } from './services/discussion-outline.service';
import { DiscussionParticipantService } from './services/discussion-participant.service';
import { DiscussionSedimentService } from './services/discussion-sediment.service';
import { DiscussionSpaceService } from './services/discussion-space.service';
import { DiscussionThreadService } from './services/discussion-thread.service';
import { DiscussionMessageStreamService } from './services/discussion-message-stream.service';
import { DiscussionRequirementBridgeService } from './services/discussion-requirement-bridge.service';

@Controller('discussions')
export class DiscussionController {
  constructor(
    private readonly discussionSpaceService: DiscussionSpaceService,
    private readonly discussionThreadService: DiscussionThreadService,
    private readonly discussionMessageService: DiscussionMessageService,
    private readonly discussionParticipantService: DiscussionParticipantService,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
    private readonly discussionOutlineService: DiscussionOutlineService,
    private readonly discussionSedimentService: DiscussionSedimentService,
    private readonly discussionMessageStreamService: DiscussionMessageStreamService,
    private readonly discussionRequirementBridgeService: DiscussionRequirementBridgeService,
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

    if (dto.category === DiscussionSpaceCategory.INDUSTRY_OBSERVATION) {
      await this.discussionOutlineService.createGenerateOutlineTask(space.id, {
        industryContext: dto.industryContext,
      });
    }

    return this.discussionSpaceService.getSpaceById(space.id);
  }

  @Get()
  async listSpaces(
    @Query('status') status?: DiscussionSpaceStatus,
    @Query('includeArchived') includeArchivedRaw?: string,
    @Query('category') category?: DiscussionSpaceCategory,
    @Query('creatorId') creatorId?: string,
    @Query('projectId') projectId?: string,
    @Query('tags') tagsRaw?: string,
  ) {
    const includeArchived = includeArchivedRaw === '1' || includeArchivedRaw === 'true';
    const query: ListDiscussionSpacesQuery = {
      status,
      includeArchived,
      category,
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
  async updateSpaceStatus(
    @Param('spaceId') spaceId: string,
    @Body('status') status: DiscussionSpaceStatus,
    @Body('operatorId') operatorId?: string,
  ) {
    return this.discussionSpaceService.updateStatus(spaceId, status, operatorId);
  }

  @Post(':spaceId/archive')
  async archiveSpaceByAction(@Param('spaceId') spaceId: string, @Body('operatorId') operatorId?: string) {
    return this.discussionSpaceService.archiveSpace(spaceId, operatorId);
  }

  @Post(':spaceId/unarchive')
  async unarchiveSpace(@Param('spaceId') spaceId: string) {
    return this.discussionSpaceService.unarchiveSpace(spaceId);
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

  @Delete(':spaceId/threads/:threadId')
  async deleteThread(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
  ): Promise<DeleteDiscussionThreadResult> {
    return this.discussionThreadService.deleteThread(spaceId, threadId);
  }

  @Post(':spaceId/threads/:threadId/messages')
  async sendMessage(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Body() dto: SendDiscussionMessageDto,
  ) {
    return this.discussionMessageService.sendMessage(spaceId, threadId, dto);
  }

  @Post(':spaceId/system/data-analysis')
  async triggerDataAnalysis(
    @Param('spaceId') spaceId: string,
    @Body() dto: TriggerDiscussionDataAnalysisDto,
  ) {
    return this.discussionMessageService.createDataUpdateAnalysisMessage(spaceId, dto);
  }

  @Get(':spaceId/threads/:threadId/messages')
  async listMessages(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Query('limit') limit?: string,
  ) {
    return this.discussionMessageService.listMessages(spaceId, threadId, Number(limit || 100));
  }

  @Post(':spaceId/threads/:threadId/messages/:messageId/knowledge/link')
  async linkMessageKnowledge(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
    @Body() dto: LinkDiscussionMessageKnowledgeDto,
  ): Promise<LinkDiscussionMessageKnowledgeResult> {
    const knowledgeEntryIds = await this.discussionKnowledgeService.linkExistingKnowledgeEntriesToMessage({
      spaceId,
      threadId,
      messageId,
      knowledgeEntryIds: dto.knowledgeEntryIds,
    });
    return {
      linked: true,
      messageId,
      knowledgeEntryIds,
    };
  }

  @Sse(':spaceId/threads/:threadId/messages/events')
  async streamThreadMessages(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
  ): Promise<Observable<MessageEvent>> {
    return this.discussionMessageStreamService.streamThreadMessages(spaceId, threadId);
  }

  @Post(':spaceId/threads/:threadId/messages/:messageId/branch')
  async branchFromMessage(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
    @Body() dto: BranchDiscussionThreadDto,
  ) {
    const [sourceMessage, parentThread] = await Promise.all([
      this.discussionMessageService.getMessageById(spaceId, threadId, messageId),
      this.discussionThreadService.getThreadById(spaceId, threadId),
    ]);

    const thread = await this.discussionThreadService.createThread(spaceId, {
      title: dto.title,
      parentThreadId: threadId,
      branchFromMessageId: messageId,
      contextSummary: dto.contextSummary,
      branchOrigin: dto.branchOrigin,
    });

    await this.discussionMessageService.createBranchContextMessage({
      spaceId,
      threadId: thread.id,
      parentThreadTitle: parentThread.title,
      sourceMessage,
    });

    return thread;
  }

  @Post(':spaceId/threads/:threadId/messages/:messageId/to-requirement')
  async createRequirementFromMessage(
    @Param('spaceId') spaceId: string,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
    @Body() dto: CreateDiscussionRequirementDto,
  ): Promise<CreateDiscussionRequirementResult> {
    const [space, thread, message] = await Promise.all([
      this.discussionSpaceService.getSpaceById(spaceId),
      this.discussionThreadService.getThreadById(spaceId, threadId),
      this.discussionMessageService.getMessageById(spaceId, threadId, messageId),
    ]);

    const messagePreview = String(message.content || '').trim().slice(0, 200);
    const title = String(dto.title || '').trim() || messagePreview || '讨论转化需求';
    const description = String(dto.description || '').trim() || String(message.content || '').trim();
    const result = await this.discussionRequirementBridgeService.createRequirementFromDiscussion({
      title,
      description,
      priority: dto.priority || 'medium',
      projectId: dto.projectId || space.projectId,
      createdById: dto.createdById,
      createdByName: dto.createdByName,
      source: {
        spaceId,
        spaceTitle: space.title,
        threadId,
        threadTitle: thread.title,
        messageId,
        messagePreview,
      },
    });

    return {
      requirementId: result.requirementId,
      title: result.title,
    };
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
    await this.discussionSpaceService.clearDefaultReplyAgentIfMatched(spaceId, participantId);
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
    @Query('outlineSectionId') outlineSectionId?: string,
    @Query('participantId') participantId?: string,
    @Query('keyword') keyword?: string,
    @Query('credibility') credibility?: ListDiscussionKnowledgeQuery['credibility'],
    @Query('limit') limit?: string,
  ) {
    const query: ListDiscussionKnowledgeQuery = {
      threadId,
      outlineSectionId,
      participantId,
      keyword,
      credibility,
      limit: limit ? Number(limit) : undefined,
    };
    return this.discussionKnowledgeService.listKnowledgeEntries(spaceId, query);
  }

  @Get(':spaceId/knowledge/coverage')
  async getKnowledgeCoverage(@Param('spaceId') spaceId: string) {
    return this.discussionOutlineService.getKnowledgeCoverage(spaceId);
  }

  @Post(':spaceId/outline/generate')
  async generateOutline(@Param('spaceId') spaceId: string, @Body('industryContext') industryContext?: string) {
    return this.discussionOutlineService.generateOutline(spaceId, { industryContext });
  }

  @Post(':spaceId/outline/generate-task')
  async generateOutlineTask(
    @Param('spaceId') spaceId: string,
    @Body('industryContext') industryContext?: string,
  ): Promise<DiscussionOutlineTaskSnapshot> {
    return this.discussionOutlineService.createGenerateOutlineTask(spaceId, { industryContext });
  }

  @Get(':spaceId/outline')
  async getOutline(@Param('spaceId') spaceId: string) {
    return this.discussionOutlineService.getOutline(spaceId);
  }

  @Put(':spaceId/outline')
  async updateOutline(@Param('spaceId') spaceId: string, @Body() dto: UpdateDiscussionOutlineDto) {
    return this.discussionOutlineService.updateOutline(spaceId, dto);
  }

  @Post(':spaceId/outline/sections')
  async addOutlineSection(@Param('spaceId') spaceId: string, @Body() dto: CreateDiscussionOutlineSectionDto) {
    return this.discussionOutlineService.addSection(spaceId, dto);
  }

  @Put(':spaceId/outline/sections/:sectionId')
  async updateOutlineSection(
    @Param('spaceId') spaceId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateDiscussionOutlineSectionDto,
  ) {
    return this.discussionOutlineService.updateSection(spaceId, sectionId, dto);
  }

  @Delete(':spaceId/outline/sections/:sectionId')
  async deleteOutlineSection(@Param('spaceId') spaceId: string, @Param('sectionId') sectionId: string) {
    return this.discussionOutlineService.deleteSection(spaceId, sectionId);
  }

  @Post(':spaceId/outline/sections/:sectionId/enrich')
  async enrichOutlineSection(
    @Param('spaceId') spaceId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<EnrichDiscussionOutlineSectionResult> {
    return this.discussionOutlineService.enrichSection(spaceId, sectionId);
  }

  @Post(':spaceId/outline/sections/:sectionId/enrich-task')
  async enrichOutlineSectionTask(
    @Param('spaceId') spaceId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<DiscussionOutlineTaskSnapshot> {
    return this.discussionOutlineService.createEnrichSectionTask(spaceId, sectionId);
  }

  @Post(':spaceId/outline/enrich-all')
  async enrichAllOutlineSections(@Param('spaceId') spaceId: string): Promise<EnrichAllDiscussionOutlineSectionsResult> {
    return this.discussionOutlineService.enrichAllDraftSections(spaceId);
  }

  @Sse(':spaceId/outline/tasks/:taskId/events')
  async streamOutlineTaskEvents(
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Query('access_token') _accessToken?: string,
  ): Promise<Observable<MessageEvent>> {
    return this.discussionOutlineService.streamOutlineTaskEvents(spaceId, taskId);
  }

  @Put(':spaceId/sediment/mode')
  async updateSedimentMode(@Param('spaceId') spaceId: string, @Body() dto: UpdateDiscussionSedimentModeDto) {
    return this.discussionSedimentService.updateSedimentMode(spaceId, dto.mode);
  }

  @Post(':spaceId/sediment/generate')
  async generateSediment(@Param('spaceId') spaceId: string, @Body() dto: GenerateDiscussionSedimentDto) {
    return this.discussionSedimentService.createSedimentTask({
      spaceId,
      mode: dto.mode,
      title: dto.title,
      threadScope: dto.threadScope,
    });
  }

  @Sse(':spaceId/sediment/tasks/:taskId/events')
  async streamSedimentTaskEvents(
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Query('access_token') _accessToken?: string,
  ): Promise<Observable<MessageEvent>> {
    return this.discussionSedimentService.streamSedimentTaskEvents(spaceId, taskId);
  }

  @Get(':spaceId/sediment/latest')
  async getLatestSediment(@Param('spaceId') spaceId: string) {
    return this.discussionSedimentService.getLatestSediment(spaceId);
  }

  @Get(':spaceId/sediment/history')
  async getSedimentHistory(@Param('spaceId') spaceId: string, @Query('limit') limit?: string) {
    const query: ListDiscussionSedimentHistoryQuery = {
      limit: limit ? Number(limit) : undefined,
    };
    return this.discussionSedimentService.listSedimentHistory(spaceId, query.limit);
  }

  @Delete(':spaceId/sediment/history/:historyId')
  async deleteSedimentHistory(
    @Param('spaceId') spaceId: string,
    @Param('historyId') historyId: string,
    @Query('operatorId') operatorId?: string,
  ) {
    const dto: DeleteDiscussionSedimentHistoryDto = {
      operatorId: String(operatorId || '').trim(),
    };
    return this.discussionSedimentService.deleteSedimentHistory(spaceId, historyId, dto.operatorId);
  }
}
