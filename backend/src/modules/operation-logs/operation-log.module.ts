import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OperationLog, OperationLogSchema } from '../../shared/schemas/operation-log.schema';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';
import { OperationLogService } from './operation-log.service';
import { OperationLogController } from './operation-log.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: OperationLog.name, schema: OperationLogSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  providers: [OperationLogService],
  controllers: [OperationLogController],
})
export class OperationLogModule {}
