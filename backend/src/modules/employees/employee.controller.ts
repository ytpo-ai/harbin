import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { 
  EmployeeService, 
  CreateEmployeeDto, 
  UpdateEmployeeDto 
} from './employee.service';
import { EmployeeType, EmployeeStatus } from '../../shared/schemas/employee.schema';

@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  async createEmployee(@Body() dto: CreateEmployeeDto) {
    const employee = await this.employeeService.createEmployee(dto);
    return {
      success: true,
      data: employee,
      message: '员工创建成功',
    };
  }

  @Get('organization')
  async getEmployeesByOrganization(
    @Query('type') type?: EmployeeType,
    @Query('status') status?: EmployeeStatus,
    @Query('departmentId') departmentId?: string,
  ) {
    const employees = await this.employeeService.getEmployeesByOrganization(
      { type, status, departmentId }
    );
    return {
      success: true,
      data: employees,
    };
  }

  @Get('stats')
  async getEmployeeStats() {
    const stats = await this.employeeService.getEmployeeStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get(':id')
  async getEmployee(@Param('id') id: string) {
    const employee = await this.employeeService.getEmployee(id);
    if (!employee) {
      return {
        success: false,
        message: '员工不存在',
      };
    }
    return {
      success: true,
      data: employee,
    };
  }

  @Put(':id')
  async updateEmployee(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const employee = await this.employeeService.updateEmployee(id, dto);
    if (!employee) {
      return {
        success: false,
        message: '员工不存在',
      };
    }
    return {
      success: true,
      data: employee,
      message: '员工信息更新成功',
    };
  }

  @Delete(':id')
  async deleteEmployee(@Param('id') id: string) {
    const success = await this.employeeService.deleteEmployee(id);
    return {
      success,
      message: success ? '员工删除成功' : '员工不存在',
    };
  }

  @Post(':id/confirm')
  async confirmEmployee(@Param('id') id: string) {
    const employee = await this.employeeService.confirmEmployee(id);
    return {
      success: !!employee,
      data: employee,
      message: employee ? '员工已转正' : '员工不存在',
    };
  }

  @Post(':id/terminate')
  async terminateEmployee(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    const employee = await this.employeeService.terminateEmployee(id, reason);
    return {
      success: !!employee,
      data: employee,
      message: employee ? '员工已离职' : '员工不存在',
    };
  }

  @Post(':id/ai-proxy')
  async setAIProxy(
    @Param('id') id: string,
    @Body('agentId') agentId: string | null,
  ) {
    const employee = await this.employeeService.setAIProxy(id, agentId);
    return {
      success: !!employee,
      data: employee,
      message: agentId ? 'AI代理已设置' : 'AI代理已取消',
    };
  }

  @Post(':id/exclusive-assistant')
  async setExclusiveAssistant(
    @Param('id') id: string,
    @Body('agentId') agentId: string,
  ) {
    const employee = await this.employeeService.setExclusiveAssistant(id, agentId);
    return {
      success: !!employee,
      data: employee,
      message: employee ? '专属助理绑定成功' : '员工不存在',
    };
  }

  @Get(':id/exclusive-assistant')
  async getExclusiveAssistant(@Param('id') id: string) {
    const binding = await this.employeeService.getExclusiveAssistant(id);
    return {
      success: !!binding,
      data: binding,
      message: binding ? '查询成功' : '员工不存在',
    };
  }

  @Post(':id/exclusive-assistant/auto-create')
  async createAndBindExclusiveAssistant(@Param('id') id: string) {
    const employee = await this.employeeService.createAndBindExclusiveAssistant(id);
    return {
      success: !!employee,
      data: employee,
      message: employee ? '专属助理创建并绑定成功' : '员工不存在',
    };
  }
}
