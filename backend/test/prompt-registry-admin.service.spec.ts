import { PromptRegistryAdminService } from '../apps/agents/src/modules/prompt-registry/prompt-registry-admin.service';

describe('PromptRegistryAdminService', () => {
  const createService = () => {
    const latestExec = jest.fn();
    const latestSort = jest.fn().mockReturnValue({ exec: latestExec });

    const promptTemplateModel = {
      findOne: jest.fn().mockReturnValue({ sort: latestSort, exec: latestExec, lean: () => ({ exec: latestExec }) }),
      create: jest.fn(),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    } as any;

    const promptTemplateAuditModel = {
      create: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) }) }),
    } as any;

    const promptResolverService = {
      resolve: jest.fn(),
      refreshPublishedCache: jest.fn().mockResolvedValue(undefined),
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
      operatorId: 'u1',
    });

    expect(promptTemplateModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'meeting',
        role: 'meeting-execution-policy',
        version: 4,
        status: 'draft',
      }),
    );
    expect(result.version).toBe(4);
  });

  it('publishes target version and refreshes cache', async () => {
    const { service, promptTemplateModel, promptResolverService } = createService();
    const save = jest.fn().mockResolvedValue(undefined);
    promptTemplateModel.findOne
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ version: 5, status: 'draft', save }) })
      .mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });

    await service.publish({
      scene: 'meeting',
      role: 'meeting-execution-policy',
      version: 5,
      operatorId: 'u1',
    });

    expect(promptTemplateModel.updateMany).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(promptResolverService.refreshPublishedCache).toHaveBeenCalledWith('meeting', 'meeting-execution-policy');
  });
});
