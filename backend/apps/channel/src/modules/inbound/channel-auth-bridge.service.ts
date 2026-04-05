import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument } from '../../../../../src/shared/schemas/employee.schema';

@Injectable()
export class ChannelAuthBridgeService {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly employeeCacheTtlMs = 30 * 1000;
  private readonly employeeCache = new Map<string, { role?: string; email?: string; expiresAt: number }>();

  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async buildSignedHeaders(
    employeeId: string,
    extra?: Record<string, string>,
    contextHint?: { role?: string; email?: string },
  ): Promise<Record<string, string>> {
    const normalizedEmployeeId = String(employeeId || '').trim();
    const now = Date.now();

    const cached = this.employeeCache.get(normalizedEmployeeId);
    let role = String(contextHint?.role || '').trim() || undefined;
    let email = String(contextHint?.email || '').trim() || undefined;

    if (!role && !email && cached && cached.expiresAt > now) {
      role = cached.role;
      email = cached.email;
    }

    if (!role && !email) {
      const employee = await this.employeeModel
        .findOne({ id: normalizedEmployeeId })
        .select({ id: 1, email: 1, role: 1 })
        .exec();
      role = employee?.role;
      email = employee?.email;
      this.employeeCache.set(normalizedEmployeeId, {
        role,
        email,
        expiresAt: now + this.employeeCacheTtlMs,
      });
    }

    const context: GatewayUserContext = {
      employeeId: normalizedEmployeeId,
      email,
      role,
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };

    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);

    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'x-channel-source': 'feishu',
      ...(extra || {}),
    };
  }
}
