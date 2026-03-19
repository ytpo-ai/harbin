import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HRService } from './hr.service';
import { HRController } from './hr.controller';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}
