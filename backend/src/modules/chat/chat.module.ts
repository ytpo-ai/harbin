import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Discussion, DiscussionSchema } from '../../shared/schemas/discussion.schema';
import { DiscussionService } from './discussion.service';
import { DiscussionController } from './discussion.controller';
import { AgentModule } from '../agents/agent.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Discussion.name, schema: DiscussionSchema }]),
    AgentModule
  ],
  controllers: [DiscussionController],
  providers: [DiscussionService],
  exports: [DiscussionService],
})
export class ChatModule {}