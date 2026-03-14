import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AgentCollaborationMessage,
  AgentCollaborationMessageSchema,
} from '../../shared/schemas/agent-collaboration-message.schema';
import {
  AgentMessageSubscription,
  AgentMessageSubscriptionSchema,
} from '../../shared/schemas/agent-message-subscription.schema';
import { AgentMessagesService } from './agent-messages.service';
import {
  AgentMessagesController,
  AgentMessageSubscriptionsController,
} from './agent-messages.controller';
import { AgentMessageDispatcherService } from './agent-message-dispatcher.service';
import { AgentCollaborationAutomationService } from './agent-collaboration-automation.service';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentCollaborationMessage.name, schema: AgentCollaborationMessageSchema },
      { name: AgentMessageSubscription.name, schema: AgentMessageSubscriptionSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [AgentMessagesController, AgentMessageSubscriptionsController],
  providers: [AgentMessagesService, AgentMessageDispatcherService, AgentCollaborationAutomationService],
  exports: [AgentMessagesService],
})
export class AgentMessagesModule {}
