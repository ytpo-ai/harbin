import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import {
  CreateIncubationProjectDto,
  UpdateIncubationProjectDto,
  QueryIncubationProjectDto,
} from '../dto';
import { IncubationProjectsService } from '../services/incubation-projects.service';

@Controller('ei/incubation-projects')
export class IncubationProjectsController {
  constructor(
    private readonly incubationProjectsService: IncubationProjectsService,
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
  async create(
    @Body() dto: CreateIncubationProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.incubationProjectsService.create(dto, user.id);
  }

  @Get()
  async findAll(
    @Query() query: QueryIncubationProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.incubationProjectsService.findAll(query);
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.incubationProjectsService.findById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateIncubationProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.incubationProjectsService.update(id, dto);
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.incubationProjectsService.delete(id);
  }
}
