import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from '../../shared/schemas/organization.schema';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';
import { AgentClientModule } from '../agents-client/agent-client.module';
import { ModelModule } from '../models/model.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }]),
    AgentClientModule,
    ModelModule
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
