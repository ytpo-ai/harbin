import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Meeting, MeetingSchema } from '../../shared/schemas/meeting.schema';
import { MeetingService } from './meeting.service';
import { MeetingController } from './meeting.controller';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { EmployeeModule } from '../employees/employee.module';
import { MessagesModule } from '../messages/messages.module';
import { MeetingEventService } from './services/meeting-event.service';
import { MeetingAgentStateService } from './services/meeting-agent-state.service';
import { MeetingLifecycleService } from './services/meeting-lifecycle.service';
import { MeetingParticipantService } from './services/meeting-participant.service';
import { MeetingMessageService } from './services/meeting-message.service';
import { MeetingOrchestrationService } from './services/meeting-orchestration.service';
import { MeetingSummaryService } from './services/meeting-summary.service';
import { MeetingParticipantHelperService } from './services/meeting-participant-helper.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Meeting.name, schema: MeetingSchema }]),
    AgentClientModule,
    EmployeeModule,
    MessagesModule,
  ],
  controllers: [MeetingController],
  providers: [
    MeetingService,
    MeetingEventService,
    MeetingAgentStateService,
    MeetingLifecycleService,
    MeetingParticipantService,
    MeetingMessageService,
    MeetingOrchestrationService,
    MeetingSummaryService,
    MeetingParticipantHelperService,
  ],
  exports: [MeetingService],
})
export class MeetingModule {}
