import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Meeting, MeetingSchema } from '../../shared/schemas/meeting.schema';
import { MeetingService } from './meeting.service';
import { MeetingController } from './meeting.controller';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { EmployeeModule } from '../employees/employee.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Meeting.name, schema: MeetingSchema }]),
    AgentClientModule,
    EmployeeModule,
  ],
  controllers: [MeetingController],
  providers: [MeetingService],
  exports: [MeetingService],
})
export class MeetingModule {}
