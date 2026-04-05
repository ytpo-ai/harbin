import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Employee, EmployeeSchema } from '../../../../../src/shared/schemas/employee.schema';
import { FeishuModule } from '../../providers/feishu/feishu.module';
import { ChannelAuthBridgeService } from './channel-auth-bridge.service';
import { ChannelInboundService } from './channel-inbound.service';
import { ChannelInboundWorkerService } from './channel-inbound-worker.service';
import { ChannelMeetingAutoService } from './channel-meeting-auto.service';
import { ChannelMeetingRelayService } from './channel-meeting-relay.service';
import { ChannelOutboundWorkerService } from './channel-outbound-worker.service';
import { CommandParserService } from './command-parser.service';
import { ChannelSessionService } from './channel-session.service';
import { ChannelUserMappingController } from './channel-user-mapping.controller';
import { ChannelUserMappingService } from './channel-user-mapping.service';
import { FeishuEventListenerService } from './feishu-event-listener.service';
import { ChannelSession, ChannelSessionSchema } from './schemas/channel-session.schema';
import { ChannelUserMapping, ChannelUserMappingSchema } from './schemas/channel-user-mapping.schema';

@Module({
  imports: [
    FeishuModule,
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: ChannelUserMapping.name, schema: ChannelUserMappingSchema },
      { name: ChannelSession.name, schema: ChannelSessionSchema },
    ]),
  ],
  controllers: [ChannelUserMappingController],
  providers: [
    ChannelAuthBridgeService,
    ChannelInboundService,
    ChannelInboundWorkerService,
    ChannelMeetingAutoService,
    ChannelMeetingRelayService,
    ChannelOutboundWorkerService,
    CommandParserService,
    ChannelSessionService,
    ChannelUserMappingService,
    FeishuEventListenerService,
  ],
  exports: [ChannelAuthBridgeService, ChannelInboundService, ChannelSessionService, ChannelUserMappingService],
})
export class InboundModule {}
