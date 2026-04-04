import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument } from '../../../../../src/shared/schemas/employee.schema';

@Injectable()
export class ChannelAuthBridgeService {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async buildSignedHeaders(employeeId: string, extra?: Record<string, string>): Promise<Record<string, string>> {
    const normalizedEmployeeId = String(employeeId || '').trim();
    const now = Date.now();

    const employee = await this.employeeModel
      .findOne({ id: normalizedEmployeeId })
      .select({ id: 1, email: 1, role: 1 })
      .exec();

    const context: GatewayUserContext = {
      employeeId: normalizedEmployeeId,
      email: employee?.email,
      role: employee?.role,
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
