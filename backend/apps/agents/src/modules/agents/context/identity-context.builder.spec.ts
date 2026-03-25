import { IdentityContextBuilder } from './identity-context.builder';

describe('IdentityContextBuilder', () => {
  it('appends agent prompt template content after systemPrompt when promptTemplateRef exists', async () => {
    const contextPromptService = {
      resolvePromptContent: jest.fn().mockResolvedValue('agent-working-guideline'),
    } as any;
    const contextFingerprintService = {
      hashFingerprint: jest.fn().mockImplementation((value: string) => `hash:${value}`),
      resolveSystemContextBlockContent: jest.fn().mockResolvedValue('identity-base-content'),
      buildIdentityMemoDelta: jest.fn(),
    } as any;
    const promptResolverService = {
      resolve: jest.fn().mockResolvedValue({
        content: 'agent-template-content',
        source: 'redis_cache',
      }),
    } as any;

    const builder = new IdentityContextBuilder(
      contextPromptService,
      contextFingerprintService,
      promptResolverService,
    );

    const messages = await builder.build({
      agent: {
        id: 'agent-1',
        systemPrompt: 'base-system-prompt',
        promptTemplateRef: { scene: 'technical', role: 'engineering:frontend-developer' },
      },
      task: { id: 'task-1', title: 't', description: 'd', type: 'chat', priority: 'low' },
      context: {
        task: { id: 'task-1', title: 't', description: 'd', type: 'chat', priority: 'low' },
        previousMessages: [],
        workingMemory: new Map(),
      },
      enabledSkills: [],
      scenarioType: 'chat',
      contextScope: 'session:test',
      identityMemos: [],
      shared: {
        allowedToolIds: [],
        assignedTools: [],
        skillContents: new Map(),
      },
    } as any);

    expect(messages.map((message) => message.content)).toEqual([
      'agent-working-guideline',
      'base-system-prompt',
      'agent-template-content',
    ]);
    expect(promptResolverService.resolve).toHaveBeenCalledWith({
      scene: 'technical',
      role: 'engineering:frontend-developer',
      defaultContent: '',
      cacheOnly: true,
    });
  });
});
