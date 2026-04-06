import { UnauthorizedException } from '@nestjs/common';
import { AgentToolAuthService } from './agent-tool-auth.service';

class FakeCredentialModel {
  static items: any[] = [];

  id!: string;
  agentId!: string;
  keyId!: string;
  secretHash!: string;
  status!: 'active' | 'revoked' | 'expired';
  scopeTemplate!: string[];
  label?: string;
  createdBy?: string;
  rotatedAt?: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;

  constructor(payload: any) {
    Object.assign(this, payload);
  }

  async save() {
    const index = FakeCredentialModel.items.findIndex((item) => item.id === this.id);
    if (index >= 0) {
      FakeCredentialModel.items[index] = this;
    } else {
      FakeCredentialModel.items.push(this);
    }
    return this;
  }

  static findOne(query: Record<string, unknown>) {
    const item = FakeCredentialModel.items.find((row) =>
      Object.entries(query).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? '')),
    );
    return {
      exec: async () => item || null,
    };
  }

  static updateOne(query: Record<string, unknown>, update: Record<string, any>, options?: { upsert?: boolean }) {
    const item = FakeCredentialModel.items.find((row) =>
      Object.entries(query).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? '')),
    );
    if (item) {
      Object.assign(item, update.$set || {});
    } else if (options?.upsert) {
      FakeCredentialModel.items.push(update.$set || {});
    }
    return {
      exec: async () => ({ acknowledged: true }),
    };
  }
}

class FakeRevocationModel {
  static items: any[] = [];

  static findOne(query: Record<string, unknown>) {
    const item = FakeRevocationModel.items.find((row) =>
      Object.entries(query).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? '')),
    );
    return {
      select: () => ({
        lean: () => ({
          exec: async () => item || null,
        }),
      }),
      lean: () => ({
        exec: async () => item || null,
      }),
      exec: async () => item || null,
    };
  }

  static updateOne(query: Record<string, unknown>, update: Record<string, any>, options?: { upsert?: boolean }) {
    const item = FakeRevocationModel.items.find((row) =>
      Object.entries(query).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? '')),
    );
    if (item) {
      Object.assign(item, update.$set || {});
    } else if (options?.upsert) {
      FakeRevocationModel.items.push(update.$set || {});
    }
    return {
      exec: async () => ({ acknowledged: true }),
    };
  }
}

class FakeAgentModel {
  static items: any[] = [];

  static findOne(query: Record<string, unknown>) {
    const queryOr = Array.isArray((query as any).$or) ? ((query as any).$or as Record<string, unknown>[]) : null;
    const item = FakeAgentModel.items.find((row) => {
      if (queryOr?.length) {
        return queryOr.some((cond) =>
          Object.entries(cond).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? '')),
        );
      }
      return Object.entries(query).every(([key, value]) => String((row as any)[key] ?? '') === String(value ?? ''));
    });
    return {
      lean: () => ({
        exec: async () => item || null,
      }),
      exec: async () => item || null,
    };
  }
}

describe('AgentToolAuthService', () => {
  let service: AgentToolAuthService;

  beforeEach(() => {
    process.env.AGENT_TOOLS_JWT_SECRET = 'test-agent-tools-secret';
    process.env.AGENT_TOOLS_CREDENTIAL_PEPPER = 'test-pepper';
    process.env.AGENT_TOOLS_JWT_TTL_SECONDS = '600';

    FakeCredentialModel.items = [];
    FakeRevocationModel.items = [];
    FakeAgentModel.items = [
      {
        id: 'agent-1',
        isActive: true,
        tools: ['builtin.sys-mg.mcp.agent.list'],
        permissions: ['agent_registry_read'],
      },
      {
        _id: '699f40ad709a628508681e4d',
        name: 'CEO助理-小武',
        isActive: true,
        tools: ['builtin.sys-mg.mcp.agent.list'],
        permissions: ['agent_registry_read'],
      },
    ];

    service = new AgentToolAuthService(
      FakeCredentialModel as any,
      FakeRevocationModel as any,
      FakeAgentModel as any,
    );
  });

  it('creates credential and issues verifiable token', async () => {
    const credential = await service.createCredential({
      agentId: 'agent-1',
      scopeTemplate: ['tool:execute:*'],
    });

    const token = await service.issueToken({
      agentKeyId: credential.keyId,
      agentSecret: credential.agentSecret,
      requestedScopes: ['tool:execute:builtin.sys-mg.mcp.agent.list'],
    });

    const claims = await service.verifyToken(token.accessToken);
    expect(claims.agentId).toBe('agent-1');
    expect(claims.toolScopes).toContain('tool:execute:builtin.sys-mg.mcp.agent.list');
  });

  it('rejects revoked token', async () => {
    const credential = await service.createCredential({
      agentId: 'agent-1',
      scopeTemplate: ['tool:execute:*'],
    });
    const token = await service.issueToken({
      agentKeyId: credential.keyId,
      agentSecret: credential.agentSecret,
    });

    const revoked = await service.revokeToken({ token: token.accessToken, reason: 'security-incident' });
    expect(revoked.revoked).toBe(true);

    await expect(service.verifyToken(token.accessToken)).rejects.toThrow('token revoked');
  });

  it('rotates credential and blocks old secret', async () => {
    const credential = await service.createCredential({
      agentId: 'agent-1',
      scopeTemplate: ['tool:execute:*'],
    });

    const rotated = await service.rotateCredential({ keyId: credential.keyId });

    await expect(
      service.issueToken({
        agentKeyId: credential.keyId,
        agentSecret: credential.agentSecret,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.issueToken({
        agentKeyId: rotated.keyId,
        agentSecret: rotated.agentSecret,
      }),
    ).resolves.toEqual(expect.objectContaining({ tokenType: 'Bearer' }));
  });

  it('supports mongo objectId style agentId for credential and token', async () => {
    const credential = await service.createCredential({
      agentId: '699f40ad709a628508681e4d',
      scopeTemplate: ['tool:execute:*'],
    });

    const token = await service.issueToken({
      agentKeyId: credential.keyId,
      agentSecret: credential.agentSecret,
      requestedScopes: ['tool:execute:builtin.sys-mg.mcp.agent.list'],
    });

    const claims = await service.verifyToken(token.accessToken);
    expect(claims.agentId).toBe('699f40ad709a628508681e4d');
  });
});
