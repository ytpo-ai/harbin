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

type PublicRouteRule = {
  path: string;
  method?: string;
};

type LifeScriptJwtPayload = {
  employeeId: string;
  email?: string;
  role?: string;
  iat?: number;
  exp: number;
};

const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/verify',
  '/api/auth/refresh',
  '/api/invitations/validate',
  '/api/invitations/accept',
  '/api/health',
]);

const PUBLIC_ROUTE_RULES: PublicRouteRule[] = [
  { path: '/api/life-script/auth/exchange' },
  { path: '/api/life-script/upload' },
  { path: '/api/life-script/submissions', method: 'POST' },
];

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
    const method = String(req.method || 'GET').toUpperCase();

    if (this.isPublicPath(path, method)) {
      return true;
    }

    // 内部服务签名认证（x-user-context + x-user-signature）
    const encodedContext = req.headers['x-user-context'] as string | undefined;
    const contextSignature = req.headers['x-user-signature'] as string | undefined;
    if (encodedContext && contextSignature) {
      return this.authenticateByInternalSignature(req, encodedContext, contextSignature);
    }

    // 外部 JWT Bearer 认证（支持 header 或 query param，后者用于 SSE/EventSource）
    const token = this.extractBearerToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    if (path.startsWith('/api/life-script')) {
      return this.authenticateLifeScriptToken(req, token);
    }

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

  private isPublicPath(path: string, method: string): boolean {
    if (PUBLIC_PATHS.has(path)) {
      return true;
    }

    return PUBLIC_ROUTE_RULES.some((rule) => {
      if (rule.path !== path) {
        return false;
      }
      if (!rule.method) {
        return true;
      }
      return rule.method === method;
    });
  }

  private extractBearerToken(req: any): string {
    const authHeader = req.headers.authorization as string | undefined;
    const queryToken = String(req.query?.access_token || '').trim();

    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return queryToken;
  }

  private authenticateLifeScriptToken(req: any, token: string): boolean {
    const secret = process.env.LS_JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('LS_JWT_SECRET not configured');
    }

    const payload = verifyEmployeeToken(token, secret) as LifeScriptJwtPayload | null;
    if (!payload?.employeeId) {
      throw new UnauthorizedException('Invalid or expired LifeScript token');
    }

    const userContext: GatewayUserContext = {
      employeeId: payload.employeeId,
      email: payload.email || '',
      role: String(payload.role || ''),
      issuedAt: payload.iat || Date.now(),
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
