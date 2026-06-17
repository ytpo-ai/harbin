import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GatewayAuthGuard } from './gateway-auth.guard';

jest.mock('@libs/auth', () => ({
  verifyEmployeeToken: jest.fn(),
}));

const { verifyEmployeeToken } = jest.requireMock('@libs/auth') as {
  verifyEmployeeToken: jest.Mock;
};

describe('GatewayAuthGuard', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalLsJwtSecret = process.env.LS_JWT_SECRET;

  const createContext = (req: any): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as ExecutionContext);

  const createEmployeeModel = (role = 'admin') => ({
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ role }),
        }),
      }),
    }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'gateway-jwt-secret';
    process.env.LS_JWT_SECRET = 'life-script-secret';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    process.env.LS_JWT_SECRET = originalLsJwtSecret;
  });

  it('allows public path without token', async () => {
    const guard = new GatewayAuthGuard(createEmployeeModel() as any);
    const req = {
      originalUrl: '/api/auth/verify',
      headers: {},
    };

    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
  });

  it('throws when bearer token is missing', async () => {
    const guard = new GatewayAuthGuard(createEmployeeModel() as any);
    const req = {
      originalUrl: '/api/agents',
      headers: {},
    };

    await expect(guard.canActivate(createContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('hydrates role from employee profile', async () => {
    verifyEmployeeToken.mockReturnValue({
      employeeId: 'emp-1',
      email: 'coder-van@test.local',
      exp: Date.now() + 60_000,
    });
    const guard = new GatewayAuthGuard(createEmployeeModel('admin') as any);
    const req: any = {
      originalUrl: '/api/agents/runtime/runs/run-1',
      headers: {
        authorization: 'Bearer test-token',
      },
    };

    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect(req.userContext).toMatchObject({
      employeeId: 'emp-1',
      email: 'coder-van@test.local',
      role: 'admin',
    });
  });

  it('allows life-script exchange path without token', async () => {
    const guard = new GatewayAuthGuard(createEmployeeModel() as any);
    const req = {
      method: 'POST',
      originalUrl: '/api/life-script/auth/exchange',
      headers: {},
    };

    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
  });

  it('uses LS_JWT_SECRET for protected life-script paths', async () => {
    verifyEmployeeToken.mockReturnValue({
      employeeId: 'ls-user-1',
      email: 'ls-user@test.local',
      role: 'operator',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });
    const guard = new GatewayAuthGuard(createEmployeeModel('ignored') as any);
    const req: any = {
      method: 'GET',
      originalUrl: '/api/life-script/admin/dashboard/stats',
      headers: {
        authorization: 'Bearer life-script-token',
      },
    };

    await expect(guard.canActivate(createContext(req))).resolves.toBe(true);
    expect(verifyEmployeeToken).toHaveBeenCalledWith('life-script-token', 'life-script-secret');
    expect(req.userContext).toMatchObject({
      employeeId: 'ls-user-1',
      email: 'ls-user@test.local',
      role: 'operator',
      expiresAt: expect.any(Number),
    });
  });
});
