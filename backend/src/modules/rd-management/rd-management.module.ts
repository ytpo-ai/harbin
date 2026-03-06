import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RdManagementController } from './rd-management.controller';
import { RdManagementService } from './rd-management.service';
import { OpencodeService } from './opencode.service';
import { RdTask, RdTaskSchema } from '../../shared/schemas/rd-task.schema';
import { RdProject, RdProjectSchema } from '../../shared/schemas/rd-project.schema';
import { AuthModule } from '../auth/auth.module';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: RdTask.name, schema: RdTaskSchema },
      { name: RdProject.name, schema: RdProjectSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [RdManagementController],
  providers: [RdManagementService, OpencodeService],
  exports: [RdManagementService, OpencodeService],
})
export class RdManagementModule {}
