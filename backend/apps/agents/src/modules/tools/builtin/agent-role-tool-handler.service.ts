import { Injectable } from '@nestjs/common';
import { InternalApiClient } from '../internal-api-client.service';
import { getTierByAgentRoleCode, normalizeAgentRoleTier } from '../../../../../../src/shared/role-tier';
import { normalizeStringArray } from '../tool-identity.util';

@Injectable()
export class AgentRoleToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  private normalizeRoleMcpPayload(role: any): {
    id: string;
    code: string;
    name: string;
    description: string;
    capabilities: string[];
    tools: string[];
    promptTemplate: string;
    status: 'active' | 'inactive';
    tier: string;
  } {
    const code = String(role?.code || '').trim();
    return {
      id: String(role?.id || role?._id || '').trim(),
      code,
      name: String(role?.name || code).trim(),
      description: String(role?.description || '').trim(),
      capabilities: normalizeStringArray(role?.capabilities),
      tools: normalizeStringArray(role?.tools),
      promptTemplate: String(role?.promptTemplate || '').trim(),
      status: role?.status === 'inactive' ? 'inactive' : 'active',
      tier: normalizeAgentRoleTier(role?.tier) || getTierByAgentRoleCode(code),
    };
  }
  async listAgentRolesByMcp(params: {
    status?: string;
    includeInactive?: boolean;
  }): Promise<any> {
    const normalizedStatus = String(params?.status || '').trim().toLowerCase();
    if (normalizedStatus && normalizedStatus !== 'active' && normalizedStatus !== 'inactive') {
      throw new Error('agent_role_master_list_roles invalid status, expected active|inactive');
    }

    const includeInactive = params?.includeInactive === true;
    const status = normalizedStatus || (includeInactive ? '' : 'active');
    const endpoint = status ? `/agents/roles?status=${status}` : '/agents/roles';
    const roles = (await this.internalApiClient.callAgentsApi('GET', endpoint)) || [];
    const items = (Array.isArray(roles) ? roles : []).map((role) => this.normalizeRoleMcpPayload(role));

    return {
      action: 'list_roles',
      total: items.length,
      status: status || 'all',
      roles: items,
      fetchedAt: new Date().toISOString(),
    };
  }
  async createAgentRoleByMcp(params: {
    code?: string;
    name?: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: string;
    tier?: string;
  }): Promise<any> {
    const code = String(params?.code || '').trim();
    const name = String(params?.name || '').trim();
    if (!code) {
      throw new Error('agent_role_master_create_role requires code');
    }
    if (!name) {
      throw new Error('agent_role_master_create_role requires name');
    }

    const status = String(params?.status || '').trim().toLowerCase();
    if (status && status !== 'active' && status !== 'inactive') {
      throw new Error('agent_role_master_create_role invalid status, expected active|inactive');
    }

    const payload = {
      code,
      name,
      ...(Object.prototype.hasOwnProperty.call(params || {}, 'description')
        ? { description: String(params?.description || '').trim() }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(params || {}, 'capabilities')
        ? { capabilities: normalizeStringArray(params?.capabilities) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(params || {}, 'tools') ? { tools: normalizeStringArray(params?.tools) } : {}),
      ...(Object.prototype.hasOwnProperty.call(params || {}, 'promptTemplate')
        ? { promptTemplate: String(params?.promptTemplate || '').trim() }
        : {}),
      ...(status ? { status } : {}),
      ...(Object.prototype.hasOwnProperty.call(params || {}, 'tier') ? { tier: String(params?.tier || '').trim() } : {}),
    };

    const created = await this.internalApiClient.callAgentsApi('POST', '/agents/roles', payload);
    return {
      action: 'create_role',
      created: true,
      role: this.normalizeRoleMcpPayload(created || payload),
      createdAt: new Date().toISOString(),
    };
  }
  async updateAgentRoleByMcp(params: {
    roleId?: string;
    id?: string;
    code?: string;
    name?: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: string;
    tier?: string;
  }): Promise<any> {
    const roleId = String(params?.roleId || params?.id || '').trim();
    if (!roleId) {
      throw new Error('agent_role_master_update_role requires roleId');
    }

    const status = String(params?.status || '').trim().toLowerCase();
    if (status && status !== 'active' && status !== 'inactive') {
      throw new Error('agent_role_master_update_role invalid status, expected active|inactive');
    }

    const updates: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(params || {}, 'code')) {
      updates.code = String(params?.code || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'name')) {
      updates.name = String(params?.name || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'description')) {
      updates.description = String(params?.description || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'capabilities')) {
      updates.capabilities = normalizeStringArray(params?.capabilities);
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'tools')) {
      updates.tools = normalizeStringArray(params?.tools);
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'promptTemplate')) {
      updates.promptTemplate = String(params?.promptTemplate || '').trim();
    }
    if (status) {
      updates.status = status;
    }
    if (Object.prototype.hasOwnProperty.call(params || {}, 'tier')) {
      updates.tier = String(params?.tier || '').trim();
    }
    if (!Object.keys(updates).length) {
      throw new Error('agent_role_master_update_role requires at least one update field');
    }

    const updated = await this.internalApiClient.callAgentsApi('PUT', `/agents/roles/${roleId}`, updates);
    return {
      action: 'update_role',
      updated: true,
      roleId,
      role: this.normalizeRoleMcpPayload(updated || { id: roleId, ...updates }),
      updatedAt: new Date().toISOString(),
    };
  }
  async deleteAgentRoleByMcp(params: { roleId?: string; id?: string }): Promise<any> {
    const roleId = String(params?.roleId || params?.id || '').trim();
    if (!roleId) {
      throw new Error('agent_role_master_delete_role requires roleId');
    }

    const deleted = await this.internalApiClient.callAgentsApi('DELETE', `/agents/roles/${roleId}`);
    return {
      action: 'delete_role',
      roleId,
      deleted: deleted?.deleted === true,
      deletedAt: new Date().toISOString(),
    };
  }}
