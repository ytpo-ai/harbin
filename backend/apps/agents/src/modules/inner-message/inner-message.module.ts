import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InnerMessage,
  InnerMessageSchema,
} from '@agents/schemas/inner-message.schema';
import {
  InnerMessageSubscription,
  InnerMessageSubscriptionSchema,
} from '@agents/schemas/inner-message-subscription.schema';
import { InnerMessageService } from './inner-message.service';
import {
  InnerMessageController,
  InnerMessageSubscriptionController,
} from './inner-message.controller';
import { InnerMessageDispatcherService } from './inner-message-dispatcher.service';
import { InnerMessageCollaborationAutomationService } from './inner-message-collaboration-automation.service';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { InnerMessageAgentRuntimeBridgeService } from './inner-message-agent-runtime-bridge.service';
import { AgentModule } from '../agents/agent.module';

@Module({
  imports: [
    AgentModule,
    MongooseModule.forFeature([
      { name: InnerMessage.name, schema: InnerMessageSchema },
      { name: InnerMessageSubscription.name, schema: InnerMessageSubscriptionSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [InnerMessageController, InnerMessageSubscriptionController],
  providers: [
    InnerMessageService,
    InnerMessageDispatcherService,
    InnerMessageCollaborationAutomationService,
    InnerMessageAgentRuntimeBridgeService,
  ],
  exports: [InnerMessageService],
})
export class InnerMessageModule {}
