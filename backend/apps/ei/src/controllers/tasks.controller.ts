import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import { CreateRdTaskDto, QueryRdTaskDto, UpdateRdTaskDto } from '../dto';
import { EiTasksService } from '../services/tasks.service';

@Controller('ei/tasks')
export class EiTasksController {
  constructor(
    private readonly tasksService: EiTasksService,
    private readonly authService: AuthService,
  ) {}

  private async getUserFromAuthHeader(authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return employee;
  }

  @Post()
  async createTask(@Body() createDto: CreateRdTaskDto, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.createTask(createDto, user.id);
  }

  @Get()
  async findAllTasks(@Query() query: QueryRdTaskDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.findAllTasks(query);
  }

  @Get(':id')
  async findTaskById(@Param('id') taskId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.findTaskById(taskId);
  }

  @Put(':id')
  async updateTask(
    @Param('id') taskId: string,
    @Body() updateDto: UpdateRdTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.updateTask(taskId, updateDto);
  }

  @Delete(':id')
  async deleteTask(@Param('id') taskId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.deleteTask(taskId);
  }

  @Post(':id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @Body('result') result: any,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.tasksService.completeTask(taskId, result);
  }
}
