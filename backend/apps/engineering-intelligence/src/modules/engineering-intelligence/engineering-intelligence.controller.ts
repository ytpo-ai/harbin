import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EngineeringIntelligenceService } from './engineering-intelligence.service';
import { CreateEngineeringRepositoryDto, UpdateEngineeringRepositoryDto } from './dto';

function verifyToken(token: string, secret: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expectedSig) return null;
    const payloadObj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (payloadObj.exp < Date.now()) return null;
    return payloadObj;
  } catch {
    return null;
  }
}

@Controller('engineering-intelligence')
export class EngineeringIntelligenceController {
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';

  constructor(private readonly engineeringIntelligenceService: EngineeringIntelligenceService) {}

  private async getUserFromAuthHeader(authHeader: string): Promise<{ organizationId: string }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token, this.jwtSecret);
    if (!payload?.organizationId) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return { organizationId: payload.organizationId };
  }

  @Post('repositories')
  async createRepository(
    @Body() dto: CreateEngineeringRepositoryDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.createRepository(dto, user.organizationId);
  }

  @Get('repositories')
  async listRepositories(@Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.listRepositories(user.organizationId);
  }

  @Put('repositories/:id')
  async updateRepository(
    @Param('id') id: string,
    @Body() dto: UpdateEngineeringRepositoryDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.updateRepository(id, dto, user.organizationId);
  }

  @Delete('repositories/:id')
  async deleteRepository(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.deleteRepository(id, user.organizationId);
  }

  @Post('repositories/:id/summarize')
  async summarizeRepository(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.summarizeRepository(id, user.organizationId);
  }

  @Get('repositories/:id/docs/tree')
  async getDocsTree(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.getRepositoryDocsTree(id, user.organizationId);
  }

  @Get('repositories/:id/docs/content')
  async getDocContent(
    @Param('id') id: string,
    @Query('path') path: string,
    @Headers('authorization') authHeader: string,
  ) {
    if (!path) {
      throw new BadRequestException('path is required');
    }
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.getRepositoryDocContent(id, user.organizationId, path);
  }

  @Get('repositories/:id/docs/history')
  async getDocHistory(
    @Param('id') id: string,
    @Query('path') path: string,
    @Query('limit') limit: string,
    @Headers('authorization') authHeader: string,
  ) {
    if (!path) {
      throw new BadRequestException('path is required');
    }
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.engineeringIntelligenceService.getRepositoryDocHistory(
      id,
      user.organizationId,
      path,
      limit ? Number(limit) : undefined,
    );
  }
}
