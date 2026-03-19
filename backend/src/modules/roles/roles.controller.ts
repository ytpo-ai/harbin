import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RolesService } from './roles.service';
import { AgentRoleTier } from '../../shared/role-tier';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  getRoles(@Query('status') status?: 'active' | 'inactive') {
    return this.rolesService.getRoles({ status });
  }

  @Get(':id')
  getRole(@Param('id') id: string) {
    return this.rolesService.getRoleById(id);
  }

  @Post()
  createRole(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.rolesService.createRole(body);
  }

  @Put(':id')
  updateRole(
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.rolesService.updateRole(id, body);
  }

  @Delete(':id')
  deleteRole(@Param('id') id: string) {
    return this.rolesService.deleteRole(id);
  }
}
