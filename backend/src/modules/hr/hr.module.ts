import { Module } from '@nestjs/common';
import { HRService } from './hr.service';
import { HRController } from './hr.controller';
import { OrganizationModule } from '../organization/organization.module';
import { ToolModule } from '../tools/tool.module';
import { TaskModule } from '../tasks/task.module';

@Module({
  imports: [OrganizationModule, ToolModule, TaskModule],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}