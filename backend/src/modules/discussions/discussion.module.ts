import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DiscussionSpace,
  DiscussionSpaceSchema,
} from '../../shared/schemas/discussion-space.schema';
import {
  DiscussionThread,
  DiscussionThreadSchema,
} from '../../shared/schemas/discussion-thread.schema';
import {
  DiscussionMessage,
  DiscussionMessageSchema,
} from '../../shared/schemas/discussion-message.schema';
import {
  DiscussionParticipant,
  DiscussionParticipantSchema,
} from '../../shared/schemas/discussion-participant.schema';
import {
  DiscussionKnowledgeEntry,
  DiscussionKnowledgeEntrySchema,
} from '../../shared/schemas/discussion-knowledge-entry.schema';
import { DiscussionController } from './discussion.controller';
import { DiscussionSpaceService } from './services/discussion-space.service';
import { DiscussionThreadService } from './services/discussion-thread.service';
import { DiscussionMessageService } from './services/discussion-message.service';
import { DiscussionParticipantService } from './services/discussion-participant.service';
import { MessageCenterModule } from '../message-center/message-center.module';
import { DiscussionMentionDispatchService } from './services/discussion-mention-dispatch.service';
import { DiscussionKnowledgeService } from './services/discussion-knowledge.service';
import { DiscussionSedimentService } from './services/discussion-sediment.service';

@Module({
  imports: [
    MessageCenterModule,
    MongooseModule.forFeature([
      { name: DiscussionSpace.name, schema: DiscussionSpaceSchema },
      { name: DiscussionThread.name, schema: DiscussionThreadSchema },
      { name: DiscussionMessage.name, schema: DiscussionMessageSchema },
      { name: DiscussionParticipant.name, schema: DiscussionParticipantSchema },
      { name: DiscussionKnowledgeEntry.name, schema: DiscussionKnowledgeEntrySchema },
    ]),
  ],
  controllers: [DiscussionController],
  providers: [
    DiscussionSpaceService,
    DiscussionThreadService,
    DiscussionMessageService,
    DiscussionParticipantService,
    DiscussionMentionDispatchService,
    DiscussionKnowledgeService,
    DiscussionSedimentService,
  ],
  exports: [
    DiscussionSpaceService,
    DiscussionThreadService,
    DiscussionMessageService,
    DiscussionParticipantService,
    DiscussionMentionDispatchService,
    DiscussionKnowledgeService,
    DiscussionSedimentService,
  ],
})
export class DiscussionModule {}
