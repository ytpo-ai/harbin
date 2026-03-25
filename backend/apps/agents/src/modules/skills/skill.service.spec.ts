import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkillService } from './skill.service';

declare const describe: any;
declare const it: any;
declare const expect: any;
declare const jest: any;

const queryResult = <T>(value: T) => {
  const chain: any = {
    exec: jest.fn().mockResolvedValue(value),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
  };
  return chain;
};

describe('SkillService', () => {
  const createService = () => {
    const skillModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
    };
    const agentModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
    };
    const skillDocLoaderService = {
      loadDocs: jest.fn().mockResolvedValue([]),
    };
    const memoEventBus = {
      emit: jest.fn(),
    };
    const redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };

    const service = new SkillService(
      skillModel as any,
      agentModel as any,
      skillDocLoaderService as any,
      memoEventBus as any,
      redisService as any,
    );

    return { service, skillModel, agentModel, skillDocLoaderService, memoEventBus, redisService };
  };

  it('stores content hash metadata when creating skill', async () => {
    const { service, skillModel, redisService } = createService();
    skillModel.create.mockImplementation(async (payload: any) => ({ ...payload }));

    const created = await service.createSkill({
      name: 'UI Guidelines',
      description: 'Web review checklist',
      content: '# title\ncontent',
    });

    expect(created.content).toBe('# title\ncontent');
    expect(created.contentType).toBe('text/markdown');
    expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.contentSize).toBeGreaterThan(0);
    expect(redisService.set).toHaveBeenCalled();
  });

  it('loads skill detail without content by default', async () => {
    const { service, skillModel, redisService } = createService();
    redisService.get.mockResolvedValueOnce(null);
    skillModel.findOne.mockReturnValue(
      queryResult({ id: 's1', name: 'Skill', description: 'desc', content: 'hidden' }),
    );

    await service.getSkillById('s1');

    expect(skillModel.findOne).toHaveBeenCalledWith({ id: 's1' }, { content: 0 });
  });

  it('returns skill content from redis cache first', async () => {
    const { service, redisService, skillModel } = createService();
    redisService.get
      .mockResolvedValueOnce('hash-1')
      .mockResolvedValueOnce(
        JSON.stringify({
          content: '# cached',
          contentType: 'text/markdown',
          contentHash: 'hash-1',
          contentSize: 8,
        }),
      );

    const result = await service.getSkillContentById('s1');

    expect(result.content).toBe('# cached');
    expect(skillModel.findOne).not.toHaveBeenCalled();
  });

  it('syncs skill docs from markdown into db', async () => {
    const { service, skillModel, skillDocLoaderService } = createService();
    skillDocLoaderService.loadDocs.mockResolvedValueOnce([
      {
        filePath: '/tmp/docs/skill/runtime.md',
        name: 'Agent Runtime Baseline',
        slug: 'agent-runtime-baseline',
        description: 'Runtime baseline skill',
        category: 'general',
        tags: ['runtime'],
        metadata: { author: 'test' },
        content: '# Runtime',
        contentType: 'text/markdown',
        contentHash: 'hash-1',
        contentSize: 9,
      },
    ]);
    skillModel.findOne.mockReturnValue(queryResult(null));
    skillModel.create.mockImplementation(async (payload: any) => ({ ...payload }));

    const result = await service.syncSkillDocsToDb();

    expect(result.scanned).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(skillModel.create).toHaveBeenCalled();
  });

  it('assigns skill by writing into agent.skills', async () => {
    const { service, agentModel, skillModel, memoEventBus } = createService();
    agentModel.findById.mockReturnValue(queryResult({ _id: 'mongo-a1', id: 'a1', skills: [] }));
    skillModel.findOne.mockReturnValue(queryResult({ id: 's1', name: 'Security Audit' }));
    agentModel.findOneAndUpdate.mockReturnValue(queryResult({ id: 'a1', skills: ['s1'] }));
    skillModel.find.mockReturnValue(queryResult([]));

    const result = await service.assignSkillToAgent('a1', 's1');

    expect(agentModel.findOneAndUpdate).toHaveBeenCalled();
    expect(result.enabled).toBe(true);
    expect(result.skills).toEqual(['s1']);
    expect(memoEventBus.emit).toHaveBeenCalled();
  });

  it('throws not found when assigning to missing agent', async () => {
    const { service, agentModel } = createService();
    agentModel.findById.mockReturnValue(queryResult(null));
    agentModel.findOne.mockReturnValue(queryResult(null));

    await expect(service.assignSkillToAgent('missing-agent', 's1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SkillService prompt template ref normalization', () => {
  it('normalizes valid promptTemplateRef', () => {
    const service = Object.create(SkillService.prototype) as SkillService;
    const normalized = service['normalizePromptTemplateRef']({
      scene: ' technical ',
      role: ' engineering:backend-developer ',
    });

    expect(normalized).toEqual({
      scene: 'technical',
      role: 'engineering:backend-developer',
    });
  });

  it('returns undefined when promptTemplateRef is undefined', () => {
    const service = Object.create(SkillService.prototype) as SkillService;
    expect(service['normalizePromptTemplateRef'](undefined)).toBeUndefined();
  });

  it('throws when promptTemplateRef is invalid', () => {
    const service = Object.create(SkillService.prototype) as SkillService;
    expect(() => service['normalizePromptTemplateRef']({ scene: '', role: 'engineering:backend-developer' })).toThrow(
      BadRequestException,
    );
  });
});
