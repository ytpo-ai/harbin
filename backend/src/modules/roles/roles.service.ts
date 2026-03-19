import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument, AgentRoleStatus } from '../../shared/schemas/agent-role.schema';
import {
  AgentRoleTier,
  getTierByAgentRoleCode,
  hasPresetTierByAgentRoleCode,
  normalizeAgentRoleTier,
} from '../../shared/role-tier';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(AgentRole.name) private readonly agentRoleModel: Model<AgentRoleDocument>,
  ) {}

  async getRoles(query?: { status?: AgentRoleStatus }): Promise<AgentRole[]> {
    const filter: Record<string, unknown> = {};
    if (query?.status === 'active' || query?.status === 'inactive') {
      filter.status = query.status;
    }
    return this.agentRoleModel.find(filter).sort({ updatedAt: -1 }).exec();
  }

  async getRoleById(id: string): Promise<AgentRole> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }

    const role = await this.agentRoleModel.findOne({ id: normalizedId }).exec();
    if (!role) {
      throw new NotFoundException(`Role not found: ${normalizedId}`);
    }
    return role;
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: AgentRoleStatus;
    tier?: AgentRoleTier;
  }): Promise<AgentRole> {
    const code = String(input?.code || '').trim();
    const name = String(input?.name || '').trim();
    if (!code) {
      throw new BadRequestException('Role code is required');
    }
    if (!name) {
      throw new BadRequestException('Role name is required');
    }

    const existing = await this.agentRoleModel.findOne({ code }).exec();
    if (existing) {
      throw new BadRequestException(`Role code already exists: ${code}`);
    }

    const normalizedTier = normalizeAgentRoleTier(input?.tier);
    if (input?.tier !== undefined && !normalizedTier) {
      throw new BadRequestException('Role tier must be one of leadership, operations, temporary');
    }
    if (normalizedTier && hasPresetTierByAgentRoleCode(code) && normalizedTier !== getTierByAgentRoleCode(code)) {
      throw new BadRequestException(`Role tier mismatch with code ${code}: expected ${getTierByAgentRoleCode(code)}`);
    }

    const role = new this.agentRoleModel({
      code,
      name,
      tier: normalizedTier || getTierByAgentRoleCode(code),
      description: String(input?.description || '').trim(),
      capabilities: Array.isArray(input?.capabilities)
        ? input.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      tools: Array.isArray(input?.tools)
        ? input.tools.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      promptTemplate: String(input?.promptTemplate || '').trim(),
      status: input?.status === 'inactive' ? 'inactive' : 'active',
    });

    return role.save();
  }

  async updateRole(
    id: string,
    updates: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: AgentRoleStatus;
      tier?: AgentRoleTier;
    },
  ): Promise<AgentRole> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }

    const role = await this.agentRoleModel.findOne({ id: normalizedId }).exec();
    if (!role) {
      throw new NotFoundException(`Role not found: ${normalizedId}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'code')) {
      const nextCode = String(updates.code || '').trim();
      if (!nextCode) {
        throw new BadRequestException('Role code cannot be empty');
      }
      const duplicate = await this.agentRoleModel.findOne({ code: nextCode, id: { $ne: normalizedId } }).exec();
      if (duplicate) {
        throw new BadRequestException(`Role code already exists: ${nextCode}`);
      }
      role.code = nextCode;
      if (!Object.prototype.hasOwnProperty.call(updates, 'tier')) {
        role.tier = getTierByAgentRoleCode(nextCode);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tier')) {
      const nextTier = normalizeAgentRoleTier(updates.tier);
      if (!nextTier) {
        throw new BadRequestException('Role tier must be one of leadership, operations, temporary');
      }
      if (hasPresetTierByAgentRoleCode(role.code) && nextTier !== getTierByAgentRoleCode(role.code)) {
        throw new BadRequestException(
          `Role tier mismatch with code ${role.code}: expected ${getTierByAgentRoleCode(role.code)}`,
        );
      }
      role.tier = nextTier;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const nextName = String(updates.name || '').trim();
      if (!nextName) {
        throw new BadRequestException('Role name cannot be empty');
      }
      role.name = nextName;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      role.description = String(updates.description || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'capabilities')) {
      role.capabilities = Array.isArray(updates.capabilities)
        ? updates.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tools')) {
      role.tools = Array.isArray(updates.tools)
        ? updates.tools.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'promptTemplate')) {
      role.promptTemplate = String(updates.promptTemplate || '').trim();
    }

    if (updates.status === 'active' || updates.status === 'inactive') {
      role.status = updates.status;
    }

    return role.save();
  }

  async deleteRole(id: string): Promise<{ deleted: boolean }> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }
    const result = await this.agentRoleModel.deleteOne({ id: normalizedId }).exec();
    return { deleted: result.deletedCount === 1 };
  }
}
