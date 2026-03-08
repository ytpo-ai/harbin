import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HRService } from './hr.service';
import { HRController } from './hr.controller';
import { ToolClientModule } from '../tools-client/tool-client.module';
import { TaskModule } from '../tasks/task.module';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
    ToolClientModule,
    TaskModule,
  ],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}
