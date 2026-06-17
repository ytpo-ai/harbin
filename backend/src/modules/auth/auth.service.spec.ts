import { HttpStatus, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const originalRedirectTtl = process.env.LIFE_SCRIPT_REDIRECT_TOKEN_TTL_SECONDS;
  const originalRedirectRateLimitWindow = process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_WINDOW_SECONDS;
  const originalRedirectRateLimitMax = process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_MAX;

  const createEmployeeModel = (employee: Record<string, unknown> | null) => ({
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(employee),
        }),
      }),
    }),
  });

  const createRedisService = (incrValue = 1) => ({
    incr: jest.fn().mockResolvedValue(incrValue),
    expire: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_TTL_SECONDS = '30';
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_WINDOW_SECONDS = '60';
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_MAX = '10';
  });

  afterEach(() => {
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_TTL_SECONDS = originalRedirectTtl;
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_WINDOW_SECONDS = originalRedirectRateLimitWindow;
    process.env.LIFE_SCRIPT_REDIRECT_TOKEN_RATE_LIMIT_MAX = originalRedirectRateLimitMax;
  });

  it('issues life-script redirect token and stores payload in redis', async () => {
    const employeeModel = createEmployeeModel({
      id: 'emp-001',
      email: 'emp@test.local',
      name: 'Emp One',
      role: 'admin',
    });
    const redisService = createRedisService(1);
    const service = new AuthService(employeeModel as any, {} as any, redisService as any);

    const result = await service.generateLifeScriptRedirectToken('emp-001');

    expect(result).toEqual({
      redirectToken: expect.any(String),
      expiresIn: 30,
    });
    expect(redisService.expire).toHaveBeenCalledWith('redirect:rate:emp-001', 60);
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^redirect:life-script:[a-f0-9]{64}$/),
      expect.any(String),
      30,
    );

    const [, payload] = redisService.set.mock.calls[0] as [string, string, number];
    expect(JSON.parse(payload)).toMatchObject({
      employeeId: 'emp-001',
      email: 'emp@test.local',
      name: 'Emp One',
      role: 'admin',
      issuedAt: expect.any(Number),
    });
  });

  it('throws 429 when redirect token issue rate limit is exceeded', async () => {
    const employeeModel = createEmployeeModel({
      id: 'emp-001',
      email: 'emp@test.local',
      name: 'Emp One',
      role: 'admin',
    });
    const redisService = createRedisService(11);
    const service = new AuthService(employeeModel as any, {} as any, redisService as any);

    await expect(service.generateLifeScriptRedirectToken('emp-001')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('throws when employee does not exist', async () => {
    const employeeModel = createEmployeeModel(null);
    const redisService = createRedisService(1);
    const service = new AuthService(employeeModel as any, {} as any, redisService as any);

    await expect(service.generateLifeScriptRedirectToken('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
