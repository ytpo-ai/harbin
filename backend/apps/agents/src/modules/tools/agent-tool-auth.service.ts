import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import {
  AgentToolCredential,
  AgentToolCredentialDocument,
} from '../../schemas/agent-tool-credential.schema';
import {
  AgentToolTokenRevocation,
  AgentToolTokenRevocationDocument,
} from '../../schemas/agent-tool-token-revocation.schema';

type AuthMode = 'legacy' | 'hybrid' | 'jwt-strict';

export interface AgentToolTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  agentId: string;
  toolScopes: string[];
  permissions: string[];
  jti: string;
  iat: number;
  exp: number;
  originSessionId?: string;
}

@Injectable()
export class AgentToolAuthService {
  private readonly tokenSecret = String(process.env.AGENT_TOOLS_JWT_SECRET || '').trim();
  private readonly issuer = String(process.env.AGENT_TOOLS_JWT_ISSUER || 'harbin-agents-auth').trim();
  private readonly audience = String(process.env.AGENT_TOOLS_JWT_AUDIENCE || 'tools-api').trim();
  private readonly tokenTtlSeconds = Math.max(60, Math.min(3600, Number(process.env.AGENT_TOOLS_JWT_TTL_SECONDS || 600)));
  private readonly credentialPepper = String(process.env.AGENT_TOOLS_CREDENTIAL_PEPPER || '').trim();

  getAuthMode(): AuthMode {
    const raw = String(process.env.TOOLS_AUTH_MODE || 'legacy').trim().toLowerCase();
    if (raw === 'jwt-strict' || raw === 'hybrid') return raw;
    return 'legacy';
  }

  isStrictPermissionEnabled(): boolean {
    const raw = String(process.env.TOOLS_AUTH_STRICT_PERMISSIONS || 'false').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  constructor(
    @InjectModel(AgentToolCredential.name)
    private readonly credentialModel: Model<AgentToolCredentialDocument>,
    @InjectModel(AgentToolTokenRevocation.name)
    private readonly tokenRevocationModel: Model<AgentToolTokenRevocationDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
  ) {
    if (!this.tokenSecret) {
      throw new Error('AGENT_TOOLS_JWT_SECRET is required');
    }
  }

  private buildAgentLookupQuery(agentId: string): Record<string, unknown> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return { id: '' };
    }
    if (Types.ObjectId.isValid(normalizedAgentId)) {
      return {
        $or: [{ id: normalizedAgentId }, { _id: new Types.ObjectId(normalizedAgentId) }],
      };
    }
    return { id: normalizedAgentId };
  }

  async createCredential(input: {
    agentId: string;
    createdBy?: string;
    label?: string;
    scopeTemplate?: string[];
    expiresAt?: string;
  }): Promise<{
    credentialId: string;
    keyId: string;
    agentSecret: string;
    expiresAt?: string;
    scopeTemplate: string[];
  }> {
    const agentId = String(input.agentId || '').trim();
    if (!agentId) {
      throw new UnauthorizedException('agentId is required');
    }
    const agent = await this.agentModel.findOne(this.buildAgentLookupQuery(agentId)).lean().exec();
    if (!agent) {
      throw new UnauthorizedException(`agent not found: ${agentId}`);
    }

    const agentSecret = `as_live_${randomBytes(24).toString('hex')}`;
    const keyId = `ak_live_${randomBytes(8).toString('hex')}`;
    const now = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;

    const credential = new this.credentialModel({
      id: uuidv4(),
      agentId,
      keyId,
      secretHash: this.hashSecret(agentSecret),
      status: 'active',
      label: String(input.label || '').trim() || undefined,
      createdBy: String(input.createdBy || '').trim() || undefined,
      scopeTemplate: this.normalizeScopes(input.scopeTemplate),
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
      lastUsedAt: now,
    });
    await credential.save();

    return {
      credentialId: credential.id,
      keyId,
      agentSecret,
      expiresAt: credential.expiresAt ? credential.expiresAt.toISOString() : undefined,
      scopeTemplate: credential.scopeTemplate || [],
    };
  }

  async revokeCredential(input: { credentialId?: string; keyId?: string }): Promise<{ revoked: boolean }> {
    const credentialId = String(input.credentialId || '').trim();
    const keyId = String(input.keyId || '').trim();
    if (!credentialId && !keyId) {
      throw new UnauthorizedException('credentialId or keyId is required');
    }

    const credential = await this.credentialModel
      .findOne(credentialId ? { id: credentialId } : { keyId })
      .exec();
    if (!credential) {
      throw new UnauthorizedException('credential not found');
    }
    credential.status = 'revoked';
    await credential.save();
    return { revoked: true };
  }

  async rotateCredential(input: {
    credentialId?: string;
    keyId?: string;
    expiresAt?: string;
  }): Promise<{
    credentialId: string;
    keyId: string;
    agentSecret: string;
    expiresAt?: string;
    scopeTemplate: string[];
  }> {
    const credentialId = String(input.credentialId || '').trim();
    const keyId = String(input.keyId || '').trim();
    if (!credentialId && !keyId) {
      throw new UnauthorizedException('credentialId or keyId is required');
    }
    const credential = await this.credentialModel
      .findOne(credentialId ? { id: credentialId } : { keyId })
      .exec();
    if (!credential) {
      throw new UnauthorizedException('credential not found');
    }

    credential.status = 'revoked';
    credential.rotatedAt = new Date();
    await credential.save();

    return this.createCredential({
      agentId: credential.agentId,
      label: credential.label,
      createdBy: credential.createdBy,
      scopeTemplate: credential.scopeTemplate || [],
      expiresAt: input.expiresAt,
    });
  }

  async issueToken(input: {
    agentKeyId: string;
    agentSecret: string;
    requestedScopes?: string[];
    originSessionId?: string;
  }): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number; scope: string }> {
    const keyId = String(input.agentKeyId || '').trim();
    const secret = String(input.agentSecret || '').trim();
    if (!keyId || !secret) {
      throw new UnauthorizedException('agentKeyId and agentSecret are required');
    }

    const credential = await this.credentialModel.findOne({ keyId }).exec();
    if (!credential) {
      throw new UnauthorizedException('invalid agent credentials');
    }
    if (credential.status !== 'active') {
      throw new UnauthorizedException('agent credential is not active');
    }
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      credential.status = 'expired';
      await credential.save();
      throw new UnauthorizedException('agent credential expired');
    }

    if (!this.safeEqual(this.hashSecret(secret), String(credential.secretHash || ''))) {
      throw new UnauthorizedException('invalid agent credentials');
    }

    const agent = await this.agentModel.findOne(this.buildAgentLookupQuery(credential.agentId)).lean().exec();
    if (!agent || agent.isActive !== true) {
      throw new UnauthorizedException('agent not found or inactive');
    }

    const assignedScopes = this.normalizeScopes((agent.tools || []).map((toolId) => `tool:execute:${String(toolId || '').trim()}`));
    const allowedByCredential = this.normalizeScopes(credential.scopeTemplate || []);
    const requested = this.normalizeScopes(input.requestedScopes);
    const baseScopes = allowedByCredential.length ? this.intersectScopes(assignedScopes, allowedByCredential) : assignedScopes;
    const finalScopes = requested.length ? this.intersectScopes(baseScopes, requested) : baseScopes;
    if (!finalScopes.length) {
      throw new UnauthorizedException('no allowed tool scopes for this credential');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const claims: AgentToolTokenClaims = {
      iss: this.issuer,
      aud: this.audience,
      sub: `agent:${credential.agentId}`,
      agentId: credential.agentId,
      toolScopes: finalScopes,
      permissions: Array.from(new Set((agent.permissions || []).map((item) => String(item || '').trim()).filter(Boolean))),
      jti: uuidv4(),
      iat: nowSec,
      exp: nowSec + this.tokenTtlSeconds,
      originSessionId: String(input.originSessionId || '').trim() || undefined,
    };

    credential.lastUsedAt = new Date();
    await credential.save();

    return {
      accessToken: this.sign(claims),
      tokenType: 'Bearer',
      expiresIn: this.tokenTtlSeconds,
      scope: finalScopes.join(' '),
    };
  }

  async revokeToken(input: {
    token?: string;
    jti?: string;
    agentId?: string;
    reason?: string;
    expiresAt?: string;
  }): Promise<{ revoked: boolean; jti: string; agentId: string }> {
    const jti = String(input.jti || '').trim();
    const token = String(input.token || '').trim();
    let claims: AgentToolTokenClaims | null = null;
    if (!jti) {
      if (!token) {
        throw new UnauthorizedException('token or jti is required');
      }
      claims = await this.verifyToken(token);
    }

    const resolvedJti = jti || String(claims?.jti || '').trim();
    const resolvedAgentId = String(input.agentId || claims?.agentId || '').trim();
    const resolvedExp = input.expiresAt
      ? new Date(input.expiresAt)
      : claims?.exp
        ? new Date(claims.exp * 1000)
        : new Date(Date.now() + this.tokenTtlSeconds * 1000);

    if (!resolvedJti || !resolvedAgentId || Number.isNaN(resolvedExp.getTime())) {
      throw new UnauthorizedException('invalid token revocation payload');
    }

    await this.tokenRevocationModel
      .updateOne(
        { jti: resolvedJti },
        {
          $set: {
            jti: resolvedJti,
            agentId: resolvedAgentId,
            reason: String(input.reason || '').trim() || 'revoked',
            expiresAt: resolvedExp,
          },
        },
        { upsert: true },
      )
      .exec();

    return { revoked: true, jti: resolvedJti, agentId: resolvedAgentId };
  }

  async verifyToken(token: string): Promise<AgentToolTokenClaims> {
    const payload = this.verify(token);
    if (!payload || typeof payload !== 'object') {
      throw new UnauthorizedException('invalid token payload');
    }

    const claims = payload as unknown as AgentToolTokenClaims;
    if (claims.iss !== this.issuer) {
      throw new UnauthorizedException('invalid token issuer');
    }
    if (claims.aud !== this.audience) {
      throw new UnauthorizedException('invalid token audience');
    }
    if (!claims.agentId) {
      throw new UnauthorizedException('invalid token subject');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp <= nowSec) {
      throw new UnauthorizedException('token expired');
    }

    const revoked = await this.tokenRevocationModel.findOne({ jti: claims.jti }).select({ _id: 1 }).lean().exec();
    if (revoked) {
      throw new UnauthorizedException('token revoked');
    }

    claims.toolScopes = this.normalizeScopes(claims.toolScopes);
    claims.permissions = Array.from(new Set((claims.permissions || []).map((item) => String(item || '').trim()).filter(Boolean)));
    return claims;
  }

  private normalizeScopes(scopes?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(scopes) ? scopes : [])
          .map((scope) => String(scope || '').trim())
          .filter((scope) => scope.startsWith('tool:execute:') || scope === 'tool:execute:*'),
      ),
    );
  }

  private intersectScopes(base: string[], other: string[]): string[] {
    const baseSet = new Set(base);
    if (baseSet.has('tool:execute:*')) {
      return other.length ? other : ['tool:execute:*'];
    }
    const hasWildcard = other.includes('tool:execute:*');
    if (hasWildcard) {
      return base;
    }
    return other.filter((scope) => baseSet.has(scope));
  }

  private hashSecret(secret: string): string {
    return createHmac('sha256', this.credentialPepper).update(secret).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuffer = Buffer.from(String(a || ''), 'utf8');
    const bBuffer = Buffer.from(String(b || ''), 'utf8');
    if (aBuffer.length !== bBuffer.length) {
      return false;
    }
    return timingSafeEqual(aBuffer, bBuffer);
  }

  private sign(payload: AgentToolTokenClaims): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.tokenSecret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private verify(token: string): Record<string, unknown> {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('invalid token format');
    }
    const [encodedHeader, encodedPayload, signature] = parts;
    const expected = createHmac('sha256', this.tokenSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('invalid token signature');
    }

    try {
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        throw new UnauthorizedException('invalid token header');
      }
      return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('invalid token payload');
    }
  }
}
