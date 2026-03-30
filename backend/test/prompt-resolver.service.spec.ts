import { PromptResolverService } from '../apps/agents/src/modules/prompt-registry/prompt-resolver.service';

describe('PromptResolverService', () => {
  const createService = () => {
    const findOneExec = jest.fn();
    const findOneSort = jest.fn().mockReturnValue({ exec: findOneExec });
    const promptTemplateModel = {
      findOne: jest.fn().mockReturnValue({ sort: findOneSort }),
    } as any;

    const redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    } as any;

    const service = new PromptResolverService(promptTemplateModel, redisService);
    return { service, promptTemplateModel, findOneExec, redisService };
  };

  it('uses session override first', async () => {
    const { service, promptTemplateModel, redisService } = createService();
    const result = await service.resolve({
      scene: 'meeting',
      role: 'execution-policy',
      defaultContent: 'default',
      sessionOverride: 'session-content',
    });

    expect(result).toEqual({ content: 'session-content', source: 'session_override' });
    expect(promptTemplateModel.findOne).not.toHaveBeenCalled();
    expect(redisService.get).not.toHaveBeenCalled();
  });

  it('uses published db template before redis cache', async () => {
    const { service, findOneExec, redisService } = createService();
    findOneExec.mockResolvedValue({
      content: 'db-content',
      version: 3,
      updatedAt: new Date('2026-03-18T10:00:00.000Z'),
    });

    const result = await service.resolve({
      scene: 'meeting',
      role: 'execution-policy',
      defaultContent: 'default',
    });

    expect(result.source).toBe('db_published');
    expect(result.content).toBe('db-content');
    expect(redisService.get).toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalled();
  });

  it('falls back to db when redis misses and db has published template', async () => {
    const { service, findOneExec, redisService } = createService();
    redisService.get.mockResolvedValue(null);
    findOneExec.mockResolvedValue({
      content: 'db-content-on-miss',
      version: 9,
      updatedAt: new Date('2026-03-18T10:00:00.000Z'),
    });

    const result = await service.resolve({
      scene: 'meeting',
      role: 'execution-policy',
      defaultContent: 'default',
    });

    expect(result).toEqual({
      content: 'db-content-on-miss',
      source: 'db_published',
      version: 9,
      updatedAt: '2026-03-18T10:00:00.000Z',
    });
  });

  it('uses redis cache before db lookup', async () => {
    const { service, promptTemplateModel, redisService, findOneExec } = createService();
    redisService.get.mockResolvedValue(
      JSON.stringify({
        content: 'cache-only-content',
        version: 5,
        updatedAt: '2026-03-18T11:00:00.000Z',
      }),
    );

    const result = await service.resolve({
      scene: 'meeting',
      role: 'execution-policy',
      defaultContent: 'default',
    });

    expect(result).toEqual({
      content: 'cache-only-content',
      source: 'redis_cache',
      version: 5,
      updatedAt: '2026-03-18T11:00:00.000Z',
    });
    expect(findOneExec).not.toHaveBeenCalled();
    expect(promptTemplateModel.findOne).not.toHaveBeenCalled();
  });

  it('returns default when redis/db both miss', async () => {
    const { service, promptTemplateModel, findOneExec, redisService } = createService();
    redisService.get.mockResolvedValue(null);
    findOneExec.mockResolvedValue(null);

    const result = await service.resolve({
      scene: 'meeting',
      role: 'execution-policy',
      defaultContent: 'default',
    });

    expect(result).toEqual({ content: 'default', source: 'code_default' });
    expect(promptTemplateModel.findOne).toHaveBeenCalled();
  });
});
