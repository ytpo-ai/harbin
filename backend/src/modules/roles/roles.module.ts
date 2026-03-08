import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentRole, AgentRoleSchema } from '../../shared/schemas/agent-role.schema';
import { Agent, AgentSchema } from '../../shared/schemas/agent.schema';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentRole.name, schema: AgentRoleSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
