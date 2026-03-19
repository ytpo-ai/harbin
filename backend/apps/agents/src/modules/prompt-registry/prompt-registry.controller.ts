import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { PromptRegistryAdminService } from './prompt-registry-admin.service';
import { decodeUserContext, verifyEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';

@Controller('prompt-registry')
export class PromptRegistryController {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(private readonly promptRegistryAdminService: PromptRegistryAdminService) {}

  @Get('templates')
  async listTemplates(
    @Query('scene') scene?: string,
    @Query('role') role?: string,
    @Query('status') status?: 'draft' | 'published' | 'archived' | 'all',
    @Query('limit') limit?: string,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.listTemplates({
      scene,
      role,
      status,
      limit: Number(limit || 50),
    });
  }

  @Get('templates/filters')
  async listTemplateFilters(
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.listTemplateFilters();
  }

  @Get('templates/effective')
  async getEffectiveTemplate(
    @Query('scene') scene: string,
    @Query('role') role: string,
    @Query('sessionOverride') sessionOverride: string | undefined,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.getEffectiveTemplate({ scene, role, sessionOverride });
  }

  @Post('templates/draft')
  async saveDraft(
    @Body()
    body: { scene?: string; role?: string; content?: string; description?: string; baseVersion?: number; summary?: string },
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const operatorId = this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.saveDraft({
      scene: String(body.scene || ''),
      role: String(body.role || ''),
      content: String(body.content || ''),
      description: body.description,
      baseVersion: typeof body.baseVersion === 'number' ? body.baseVersion : undefined,
      summary: body.summary,
      operatorId,
    });
  }

  @Post('templates/publish')
  async publish(
    @Body() body: { scene?: string; role?: string; version?: number; summary?: string },
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const operatorId = this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.publish({
      scene: String(body.scene || ''),
      role: String(body.role || ''),
      version: Number(body.version || 0),
      summary: body.summary,
      operatorId,
    });
  }

  @Post('templates/unpublish')
  async unpublish(
    @Body() body: { scene?: string; role?: string; version?: number; summary?: string },
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const operatorId = this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.unpublish({
      scene: String(body.scene || ''),
      role: String(body.role || ''),
      version: Number(body.version || 0),
      summary: body.summary,
      operatorId,
    });
  }

  @Post('templates/rollback')
  async rollback(
    @Body() body: { scene?: string; role?: string; targetVersion?: number; summary?: string },
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const operatorId = this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.rollback({
      scene: String(body.scene || ''),
      role: String(body.role || ''),
      targetVersion: Number(body.targetVersion || 0),
      summary: body.summary,
      operatorId,
    });
  }

  @Get('templates/diff')
  async diff(
    @Query('scene') scene: string,
    @Query('role') role: string,
    @Query('baseVersion') baseVersion: string,
    @Query('targetVersion') targetVersion: string,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.compareVersions({
      scene,
      role,
      baseVersion: Number(baseVersion || 0),
      targetVersion: Number(targetVersion || 0),
    });
  }

  @Get('templates/:id')
  async getTemplateById(
    @Param('id') id: string,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.getTemplateById(String(id || ''));
  }

  @Get('audits')
  async listAudits(
    @Query('scene') scene: string | undefined,
    @Query('role') role: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.listAudits({
      scene,
      role,
      limit: Number(limit || 50),
    });
  }

  @Delete('templates/:id')
  async deleteTemplate(
    @Param('id') id: string,
    @Req() req?: any,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    this.resolveOperatorId(req, internalContext, internalSignature);
    return this.promptRegistryAdminService.deleteTemplate({ templateId: String(id || '') });
  }

  private resolveOperatorId(req?: any, encoded?: string, signature?: string): string {
    const fromMiddleware = String(req?.userContext?.employeeId || '').trim();
    if (fromMiddleware) {
      return fromMiddleware;
    }

    if (!encoded || !signature) {
      throw new UnauthorizedException('Missing internal user context');
    }

    if (!verifyEncodedContext(encoded, signature, this.contextSecret)) {
      throw new UnauthorizedException('Invalid internal user context signature');
    }

    const context = decodeUserContext(encoded) as GatewayUserContext;
    const employeeId = String(context?.employeeId || '').trim();
    if (!employeeId || Number(context?.expiresAt || 0) <= Date.now()) {
      throw new UnauthorizedException('Invalid internal user context');
    }

    return employeeId;
  }
}
