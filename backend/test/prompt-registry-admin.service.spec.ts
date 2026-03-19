import { PromptRegistryAdminService } from '../apps/agents/src/modules/prompt-registry/prompt-registry-admin.service';

describe('PromptRegistryAdminService', () => {
  const createService = () => {
    const latestExec = jest.fn();
    const latestSort = jest.fn().mockReturnValue({ exec: latestExec });

    const promptTemplateModel = {
      findOne: jest.fn().mockReturnValue({ sort: latestSort, exec: latestExec, lean: () => ({ exec: latestExec }) }),
      findById: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      distinct: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    } as any;

    const promptTemplateAuditModel = {
      create: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) }) }),
    } as any;

    const promptResolverService = {
      resolve: jest.fn(),
      refreshPublishedCache: jest.fn().mockResolvedValue(undefined),
      cachePublishedTemplate: jest.fn().mockResolvedValue(undefined),
      clearPublishedCache: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new PromptRegistryAdminService(promptTemplateModel, promptTemplateAuditModel, promptResolverService);
    return { service, promptTemplateModel, promptTemplateAuditModel, promptResolverService, latestExec };
  };

  it('creates draft with incremented version', async () => {
    const { service, promptTemplateModel, latestExec } = createService();
    latestExec.mockResolvedValue({ version: 3 });
    promptTemplateModel.create.mockResolvedValue({ version: 4 });

    const result = await service.saveDraft({
      scene: 'meeting',
      role: 'meeting-execution-policy',
      content: 'content',
      description: 'desc',
      operatorId: 'u1',
    });

    expect(promptTemplateModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'meeting',
        role: 'meeting-execution-policy',
        version: 4,
        status: 'draft',
        description: 'desc',
      }),
    );
    expect(result.version).toBe(4);
  });

  it('publishes target version and writes cache', async () => {
    const { service, promptTemplateModel, promptResolverService } = createService();
    const save = jest.fn().mockResolvedValue(undefined);
    promptTemplateModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          version: 5,
          status: 'draft',
          content: 'published-content',
          updatedAt: new Date('2026-03-19T10:00:00.000Z'),
          save,
        }),
      })
      .mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });

    await service.publish({
      scene: 'meeting',
      role: 'meeting-execution-policy',
      version: 5,
      operatorId: 'u1',
    });

    expect(promptTemplateModel.updateMany).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(promptResolverService.cachePublishedTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'meeting',
        role: 'meeting-execution-policy',
        content: 'published-content',
        version: 5,
      }),
    );
  });

  it('unpublishes published version and clears cache', async () => {
    const { service, promptTemplateModel, promptResolverService } = createService();
    const save = jest.fn().mockResolvedValue(undefined);
    promptTemplateModel.findOne
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ version: 6, status: 'published', save }) })
      .mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });

    await service.unpublish({
      scene: 'meeting',
      role: 'meeting-execution-policy',
      version: 6,
      operatorId: 'u1',
    });

    expect(save).toHaveBeenCalled();
    expect(promptResolverService.clearPublishedCache).toHaveBeenCalledWith('meeting', 'meeting-execution-policy');
  });

  it('returns filter options from existing templates', async () => {
    const { service, promptTemplateModel } = createService();
    promptTemplateModel.aggregate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue([
        { _id: { scene: 'meeting', role: 'meeting-execution-policy' } },
        { _id: { scene: 'orchestration', role: 'planner-task-decomposition' } },
      ]),
    });
    promptTemplateModel.distinct.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(['draft', 'published']),
    });

    const result = await service.listTemplateFilters();

    expect(result.scenes).toEqual(['meeting', 'orchestration']);
    expect(result.sceneRoleMap.meeting).toEqual(['meeting-execution-policy']);
    expect(result.sceneRoleMap.orchestration).toEqual(['planner-task-decomposition']);
    expect(result.statuses).toEqual(['draft', 'published']);
  });

  it('gets template by id', async () => {
    const { service, promptTemplateModel } = createService();
    promptTemplateModel.findById.mockReturnValueOnce({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 't3', scene: 'meeting', role: 'meeting-execution-policy' }) }),
    });

    const result = await service.getTemplateById('t3');

    expect(result?._id).toBe('t3');
  });

  it('deletes non-published template', async () => {
    const { service, promptTemplateModel } = createService();
    promptTemplateModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({
        _id: 't1',
        scene: 'meeting',
        role: 'meeting-execution-policy',
        version: 2,
        status: 'draft',
      }),
    });

    const result = await service.deleteTemplate({ templateId: 't1' });

    expect(promptTemplateModel.deleteOne).toHaveBeenCalledWith({ _id: 't1' });
    expect(result.deleted).toBe(true);
  });

  it('rejects deleting published template', async () => {
    const { service, promptTemplateModel } = createService();
    promptTemplateModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue({
        _id: 't2',
        scene: 'meeting',
        role: 'meeting-execution-policy',
        version: 5,
        status: 'published',
      }),
    });

    await expect(service.deleteTemplate({ templateId: 't2' })).rejects.toThrow('published template cannot be deleted');
  });
});
