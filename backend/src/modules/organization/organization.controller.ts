import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { OrganizationService } from './organization.service';

@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post('initialize')
  async initializeOrganization() {
    return this.organizationService.createInitialOrganization();
  }

  @Get()
  getOrganization() {
    return this.organizationService.getOrganization();
  }

  @Get('debug/status')
  async getDebugStatus() {
    const org = await this.organizationService.getOrganization();
    if (!org) {
      return {
        initialized: false,
        message: 'Organization not initialized',
        timestamp: new Date().toISOString()
      };
    }

    return {
      initialized: true,
      name: org.name,
      foundedDate: org.foundedDate,
      totalShares: org.totalShares,
      shareDistribution: org.shareDistribution,
      totalEmployees: org.employees.length,
      totalRoles: org.roles.length,
      totalDepartments: org.departments.length,
      employees: org.employees.map(e => ({
        id: e.agentId,
        roleId: e.roleId,
        status: e.status,
        joinDate: e.joinDate
      })),
      timestamp: new Date().toISOString()
    };
  }

  @Put(':id')
  updateOrganization(@Param('id') id: string, @Body() updates: any) {
    return this.organizationService.updateOrganization(id, updates);
  }

  @Post('hire')
  async hireAgent(@Body() body: { agentId: string; roleId: string; proposerId: string }) {
    return this.organizationService.hireAgent(body.agentId, body.roleId, body.proposerId);
  }

  @Post('fire')
  async fireAgent(@Body() body: { agentId: string; reason: string }) {
    return this.organizationService.fireAgent(body.agentId, body.reason);
  }

  @Post('evaluate')
  async evaluateAgent(@Body() body: { agentId: string; evaluation: any }) {
    return this.organizationService.evaluateAgentPerformance(body.agentId, body.evaluation);
  }

  @Get('stats')
  getOrganizationStats() {
    return this.organizationService.getOrganizationStats();
  }
}
