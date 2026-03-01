import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../../shared/schemas/task.schema';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    AgentClientModule,
    ChatModule,
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
