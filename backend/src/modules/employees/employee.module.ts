import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Employee, EmployeeSchema } from '../../shared/schemas/employee.schema';
import { Organization, OrganizationSchema } from '../../shared/schemas/organization.schema';
import { EmployeeService } from './employee.service';
import { EmployeeController } from './employee.controller';
import { AgentModule } from '../agents/agent.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Employee.name, schema: EmployeeSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    AgentModule,
  ],
  controllers: [EmployeeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
