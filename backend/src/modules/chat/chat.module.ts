import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Discussion, DiscussionSchema } from '../../shared/schemas/discussion.schema';
import { DiscussionService } from './discussion.service';
import { DiscussionController } from './discussion.controller';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Discussion.name, schema: DiscussionSchema }]),
    AgentClientModule,
    MessagesModule,
  ],
  controllers: [DiscussionController],
  providers: [DiscussionService],
  exports: [DiscussionService],
})
export class ChatModule {}
