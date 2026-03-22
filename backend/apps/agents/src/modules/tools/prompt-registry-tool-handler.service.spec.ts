import { PromptRegistryToolHandler } from './prompt-registry-tool-handler.service';

describe('PromptRegistryToolHandler', () => {
  it('saves single template as draft', async () => {
    const promptRegistryAdminService = {
      saveDraft: jest.fn().mockResolvedValue({
        scene: 'engineering',
        role: 'frontend-developer',
        version: 1,
        category: 'engineering',
        tags: ['frontend'],
        source: { type: 'github', repo: 'https://github.com/example/repo' },
      }),
      publish: jest.fn(),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      scene: 'engineering',
      role: 'frontend-developer',
      content: 'You are frontend expert',
      category: 'engineering',
      tags: ['frontend', 'frontend'],
      source: { type: 'github', repo: 'https://github.com/example/repo' },
    });

    expect(promptRegistryAdminService.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'engineering',
        role: 'frontend-developer',
        category: 'engineering',
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
        scene: 'engineering',
        role: 'backend-developer',
        version: 2,
      }),
      publish: jest.fn().mockResolvedValue({}),
    } as any;

    const handler = new PromptRegistryToolHandler(promptRegistryAdminService);
    const result = await handler.savePromptTemplate({
      autoPublish: true,
      templates: [{ scene: 'engineering', role: 'backend-developer', content: 'You are backend expert' }],
    });

    expect(promptRegistryAdminService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: 'engineering',
        role: 'backend-developer',
        version: 2,
      }),
    );
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
  });
});
