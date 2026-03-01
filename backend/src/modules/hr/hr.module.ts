import { Module } from '@nestjs/common';
import { HRService } from './hr.service';
import { HRController } from './hr.controller';
import { OrganizationModule } from '../organization/organization.module';
import { ToolClientModule } from '../tools-client/tool-client.module';
import { TaskModule } from '../tasks/task.module';

@Module({
  imports: [OrganizationModule, ToolClientModule, TaskModule],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}
