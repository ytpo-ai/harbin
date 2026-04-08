import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { decodeUserContext, verifyEmployeeToken, verifyEncodedContext } from '@libs/auth';
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
  private readonly logger = new Logger(GatewayAuthGuard.name);
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

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

    // 内部服务签名认证（x-user-context + x-user-signature）
    const encodedContext = req.headers['x-user-context'] as string | undefined;
    const contextSignature = req.headers['x-user-signature'] as string | undefined;
    if (encodedContext && contextSignature) {
      return this.authenticateByInternalSignature(req, encodedContext, contextSignature);
    }

    // 外部 JWT Bearer 认证
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

  private authenticateByInternalSignature(
    req: any,
    encodedContext: string,
    signature: string,
  ): boolean {
    if (!verifyEncodedContext(encodedContext, signature, this.contextSecret)) {
      this.logger.warn('Internal context signature verification failed');
      throw new UnauthorizedException('Invalid internal context signature');
    }

    const userContext = decodeUserContext(encodedContext);
    if (!userContext.employeeId) {
      throw new UnauthorizedException('Internal context missing employeeId');
    }

    if (userContext.expiresAt && userContext.expiresAt < Date.now()) {
      throw new UnauthorizedException('Internal context expired');
    }

    req.userContext = userContext;
    return true;
  }
}
