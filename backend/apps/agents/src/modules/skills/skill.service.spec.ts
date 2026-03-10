import { NotFoundException } from '@nestjs/common';
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
    const agentSkillModel = {
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteMany: jest.fn(),
    };
    const suggestionModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    };
    const agentModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
    };
    const skillDocSyncService = {
      syncSkill: jest.fn(),
      removeSkill: jest.fn(),
      syncSuggestion: jest.fn(),
      rebuildIndex: jest.fn(),
      reportSyncError: jest.fn(),
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
      agentSkillModel as any,
      suggestionModel as any,
      agentModel as any,
      skillDocSyncService as any,
      memoEventBus as any,
      redisService as any,
    );

    return { service, skillModel, agentSkillModel, suggestionModel, agentModel, skillDocSyncService, memoEventBus, redisService };
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

  it('ranks suggestions by capability overlap', async () => {
    const { service, skillModel, agentSkillModel, suggestionModel, agentModel } = createService();

    agentModel.findById.mockReturnValue(queryResult({
      id: 'a1',
      capabilities: ['security', 'typescript'],
      tools: ['websearch'],
    }));

    agentSkillModel.find.mockReturnValue(queryResult([]));

    const skills = [
      {
        id: 's1',
        name: 'Security Audit',
        description: 'security checks for code',
        category: 'engineering',
        tags: ['security', 'review'],
        status: 'active',
        confidenceScore: 75,
      },
      {
        id: 's2',
        name: 'Creative Writing',
        description: 'marketing copy',
        category: 'content',
        tags: ['copywriting'],
        status: 'active',
        confidenceScore: 75,
      },
    ];

    skillModel.find.mockImplementation((query: any) => {
      if (query?.id?.$nin) return queryResult(skills);
      return queryResult([]);
    });

    suggestionModel.findOne.mockReturnValue(queryResult(null));
    suggestionModel.create.mockResolvedValue({ id: 'new-suggestion' });
    suggestionModel.find.mockReturnValue(queryResult([]));

    const result = await service.suggestSkillsForAgent({
      agentId: 'a1',
      contextTags: ['code-review'],
      topK: 2,
    });

    expect(result).toHaveLength(2);
    expect(result[0].skill.id).toBe('s1');
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(suggestionModel.create).toHaveBeenCalled();
  });

  it('throws not found for missing agent', async () => {
    const { service, agentModel } = createService();
    agentModel.findById.mockReturnValue(queryResult(null));
    agentModel.findOne.mockReturnValue(queryResult(null));

    await expect(
      service.suggestSkillsForAgent({ agentId: 'missing-agent' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies suggestion by assigning skill to agent', async () => {
    const { service, suggestionModel, skillModel } = createService();
    const suggestionDoc = {
      id: 'sug-1',
      agentId: 'a1',
      skillId: 's1',
      status: 'pending',
      reason: 'fit',
      save: jest.fn().mockResolvedValue({
        id: 'sug-1',
        agentId: 'a1',
        skillId: 's1',
        status: 'applied',
        reason: 'fit',
      }),
    };

    suggestionModel.findOne.mockReturnValue(queryResult(suggestionDoc));
    skillModel.findOne.mockReturnValue(queryResult({ id: 's1', name: 'Security Audit' }));
    skillModel.find.mockReturnValue(queryResult([]));
    suggestionModel.find.mockReturnValue(queryResult([]));

    const assignSpy = jest.spyOn(service as any, 'assignSkillToAgent').mockResolvedValue({});

    const result = await service.reviewSuggestion('sug-1', { status: 'applied' });

    expect(assignSpy).toHaveBeenCalledWith('a1', 's1', {
      assignedBy: 'AgentSkillManager',
      proficiencyLevel: 'beginner',
    });
    expect(result.status).toBe('applied');
  });
});
