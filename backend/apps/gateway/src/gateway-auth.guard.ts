import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { verifyEmployeeToken } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument } from '../../../src/shared/schemas/employee.schema';

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/verify',
  '/api/auth/refresh',
  '/api/invitations/validate',
  '/api/invitations/accept',
  '/api/health',
]);

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path = req.originalUrl?.split('?')[0] || req.url;

    if (PUBLIC_PATHS.has(path)) {
      return true;
    }

    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const payload = verifyEmployeeToken(token, secret);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const employee = await this.employeeModel
      .findOne({ id: payload.employeeId })
      .select({ role: 1 })
      .lean()
      .exec();

    const userContext: GatewayUserContext = {
      employeeId: payload.employeeId,
      email: payload.email,
      role: String(employee?.role || ''),
      issuedAt: Date.now(),
      expiresAt: payload.exp,
    };

    req.userContext = userContext;
    return true;
  }
}
