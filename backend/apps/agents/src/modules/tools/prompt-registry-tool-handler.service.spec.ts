import { PromptRegistryToolHandler } from './prompt-registry-tool-handler.service';

describe('PromptRegistryToolHandler', () => {
  it('lists templates without content field', async () => {
    const promptRegistryAdminService = {
      listTemplates: jest.fn().mockResolvedValue([
        {
          _id: 'template-1',
          scene: 'technical',
          role: 'engineering:frontend-developer',
          version: 3,
          status: 'published',
          category: 'recruitment',
          description: 'frontend prompt',
          content: 'should not be returned',
          updatedAt: new Date('2026-03-24T00:00:00.000Z'),
        },
      ]),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.listPromptTemplates({ scene: 'technical' });

    expect(promptRegistryAdminService.listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ scene: 'technical', status: 'published' }),
    );
    expect(result.total).toBe(1);
    expect(result.templates[0]).toEqual(
      expect.objectContaining({
        _id: 'template-1',
        scene: 'technical',
        role: 'engineering:frontend-developer',
        version: 3,
        status: 'published',
      }),
    );
    expect(result.templates[0]).not.toHaveProperty('content');
  });

  it('gets effective template by scene and role', async () => {
    const promptRegistryAdminService = {
      getEffectiveTemplate: jest.fn().mockResolvedValue({
        content: 'effective prompt',
        version: 5,
        updatedAt: '2026-03-24T01:00:00.000Z',
      }),
      listTemplates: jest.fn().mockResolvedValue([
        {
          _id: 'template-5',
          scene: 'technical',
          role: 'engineering:frontend-developer',
          version: 5,
          status: 'published',
          category: 'recruitment',
          description: 'published template',
        },
      ]),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.getPromptTemplate({
      scene: 'technical',
      role: 'engineering:frontend-developer',
    });

    expect(promptRegistryAdminService.getEffectiveTemplate).toHaveBeenCalledWith({
      scene: 'technical',
      role: 'engineering:frontend-developer',
    });
    expect(result).toEqual(
      expect.objectContaining({
        _id: 'template-5',
        scene: 'technical',
        role: 'engineering:frontend-developer',
        version: 5,
        status: 'published',
        content: 'effective prompt',
      }),
    );
  });

  it('gets template by templateId', async () => {
    const promptRegistryAdminService = {
      getTemplateById: jest.fn().mockResolvedValue({
        _id: 'template-9',
        scene: 'meeting',
        role: 'facilitator',
        version: 9,
        status: 'published',
        content: 'meeting facilitator prompt',
      }),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.getPromptTemplate({ templateId: 'template-9' });

    expect(promptRegistryAdminService.getTemplateById).toHaveBeenCalledWith('template-9');
    expect(result.content).toBe('meeting facilitator prompt');
    expect(result.scene).toBe('meeting');
    expect(result.role).toBe('facilitator');
  });

  it('throws when getPromptTemplate has no templateId and no scene role', async () => {
    const handler = new PromptRegistryToolHandler({} as any);
    await expect(handler.getPromptTemplate({})).rejects.toThrow(
      'get_prompt_template requires templateId or scene + role',
    );
  });

  it('throws when effective template content is missing', async () => {
    const promptRegistryAdminService = {
      getEffectiveTemplate: jest.fn().mockResolvedValue({ content: '' }),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    await expect(
      handler.getPromptTemplate({
        scene: 'technical',
        role: 'engineering:frontend-developer',
      }),
    ).rejects.toThrow('prompt template not found for technical/engineering:frontend-developer');
  });

  it('filters by role prefix for listPromptTemplates', async () => {
    const promptRegistryAdminService = {
      listTemplates: jest.fn().mockResolvedValue([
        {
          _id: 'template-1',
          scene: 'technical',
          role: 'engineering:frontend-developer',
          version: 1,
          status: 'published',
          category: 'recruitment',
        },
        {
          _id: 'template-2',
          scene: 'technical',
          role: 'design:ux-designer',
          version: 1,
          status: 'published',
          category: 'recruitment',
        },
      ]),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.listPromptTemplates({
      scene: 'technical',
      role: 'engineering:*',
      category: 'recruitment',
    });

    expect(promptRegistryAdminService.listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'technical',
        role: undefined,
        category: 'recruitment',
      }),
    );
    expect(result.total).toBe(1);
    expect(result.templates[0].role).toBe('engineering:frontend-developer');
  });

  it('wraps templateId lookup errors with friendly message', async () => {
    const promptRegistryAdminService = {
      getTemplateById: jest.fn().mockRejectedValue(new Error('Cast to ObjectId failed')),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    await expect(handler.getPromptTemplate({ templateId: 'invalid-id' })).rejects.toThrow(
      'prompt template lookup failed for templateId invalid-id: Cast to ObjectId failed',
    );
  });

  it('saves single template as draft', async () => {
    const promptRegistryAdminService = {
      saveDraft: jest.fn().mockResolvedValue({
        scene: 'technical',
        role: 'engineering:frontend-developer',
        version: 1,
        category: 'recruitment',
        tags: ['frontend'],
        source: { type: 'github', repo: 'https://github.com/example/repo' },
      }),
      publish: jest.fn(),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      scene: 'technical',
      role: 'engineering:frontend-developer',
      content: 'You are frontend expert',
      category: 'recruitment',
      tags: ['frontend', 'frontend'],
      source: { type: 'github', repo: 'https://github.com/example/repo' },
    });

    expect(promptRegistryAdminService.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'technical',
        role: 'engineering:frontend-developer',
        category: 'recruitment',
        tags: ['frontend'],
      }),
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('supports auto publish and marks updated when version > 1', async () => {
    const promptRegistryAdminService = {
      saveDraft: jest.fn().mockResolvedValue({
        scene: 'technical',
        role: 'engineering:backend-developer',
        version: 2,
      }),
      publish: jest.fn().mockResolvedValue({}),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      autoPublish: true,
      templates: [{ scene: 'technical', role: 'engineering:backend-developer', category: 'recruitment', content: 'You are backend expert' }],
    });

    expect(promptRegistryAdminService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'technical',
        role: 'engineering:backend-developer',
        version: 2,
      }),
    );
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rejects invalid category and marks item as failed', async () => {
    const promptRegistryAdminService = {
      saveDraft: jest.fn(),
      publish: jest.fn(),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      scene: 'technical',
      role: 'engineering:backend-developer',
      category: 'engineering',
      content: 'invalid category',
    });

    expect(promptRegistryAdminService.saveDraft).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toContain('category must be system | recruitment');
  });

  it('rejects invalid recruitment role format', async () => {
    const promptRegistryAdminService = {
      saveDraft: jest.fn(),
      publish: jest.fn(),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      scene: 'technical',
      role: 'engineering-backend-developer',
      category: 'recruitment',
      content: 'invalid role format',
    });

    expect(promptRegistryAdminService.saveDraft).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toContain('recruitment role must match');
  });
});
