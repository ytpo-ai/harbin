import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { InvitationService, CreateInvitationDto, AcceptInvitationDto } from './invitation.service';

@Controller('invitations')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  /**
   * 创建邀请
   */
  @Post()
  async createInvitation(@Body() dto: CreateInvitationDto) {
    const invitation = await this.invitationService.createInvitation(dto);
    const link = this.invitationService.getInvitationLink(invitation.code, invitation.linkToken);
    
    return {
      success: true,
      data: {
        ...invitation,
        link,
      },
      message: '邀请创建成功',
    };
  }

  /**
   * 获取组织所有邀请
   */
  @Get('organization/:organizationId')
  async getByOrganization(@Param('organizationId') organizationId: string) {
    const invitations = await this.invitationService.getByOrganization(organizationId);
    return {
      success: true,
      data: invitations,
    };
  }

  /**
   * 获取邀请统计
   */
  @Get('stats/:organizationId')
  async getStats(@Param('organizationId') organizationId: string) {
    const stats = await this.invitationService.getStats(organizationId);
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * 验证邀请
   */
  @Post('validate')
  async validateInvitation(
    @Body() body: { code: string; linkToken: string }
  ) {
    const result = await this.invitationService.validateInvitation(body.code, body.linkToken);
    return {
      valid: result.valid,
      error: result.error,
      data: result.invitation ? {
        id: result.invitation.id,
        organizationId: result.invitation.organizationId,
        role: result.invitation.role,
        title: result.invitation.title,
        invitedByName: result.invitation.invitedByName,
        message: result.invitation.message,
        expiresAt: result.invitation.expiresAt,
      } : undefined,
    };
  }

  /**
   * 接受邀请（注册）
   */
  @Post('accept')
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    const employee = await this.invitationService.acceptInvitation(dto);
    return {
      success: true,
      data: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        organizationId: employee.organizationId,
      },
      message: '加入组织成功',
    };
  }

  /**
   * 取消邀请
   */
  @Post(':id/cancel')
  async cancelInvitation(@Param('id') id: string) {
    const invitation = await this.invitationService.cancelInvitation(id);
    return {
      success: !!invitation,
      message: invitation ? '邀请已取消' : '邀请不存在',
    };
  }

  /**
   * 重新发送邀请
   */
  @Post(':id/resend')
  async resendInvitation(
    @Param('id') id: string,
    @Body() body: { expiresInDays?: number }
  ) {
    const invitation = await this.invitationService.resendInvitation(id, body.expiresInDays);
    if (!invitation) {
      return { success: false, message: '邀请不存在' };
    }
    
    const link = this.invitationService.getInvitationLink(invitation.code, invitation.linkToken);
    return {
      success: true,
      data: {
        ...invitation,
        link,
      },
      message: '邀请已重新发送',
    };
  }

  /**
   * 删除过期邀请
   */
  @Delete('cleanup/:organizationId')
  async cleanupExpired(@Param('organizationId') organizationId: string) {
    const deletedCount = await this.invitationService.deleteExpiredInvitations(organizationId);
    return {
      success: true,
      data: { deletedCount },
      message: `已删除 ${deletedCount} 个过期邀请`,
    };
  }
}
