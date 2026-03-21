import { ContextAssemblerService } from './context-assembler.service';

describe('ContextAssemblerService', () => {
  it('drops system messages from previous history and keeps non-system history', async () => {
    const identityBuilder = {
      layer: 'identity',
      meta: { scope: 'run', stability: 'static' },
      shouldInject: () => true,
      build: jest.fn().mockResolvedValue([{ role: 'system', content: 'identity-system' }]),
    } as any;
    const passthroughBuilder = {
      layer: 'toolset',
      meta: { scope: 'run', stability: 'dynamic' },
      shouldInject: () => true,
      build: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new ContextAssemblerService(
      identityBuilder,
      passthroughBuilder,
      passthroughBuilder,
      passthroughBuilder,
      passthroughBuilder,
      passthroughBuilder,
    );

    const result = await service.assemble({
      agent: { id: 'agent-1', systemPrompt: 'sp' },
      task: { id: 'task-1', title: 't', description: 'd', type: 'chat', priority: 'low' },
      context: {
        task: { id: 'task-1', title: 't', description: 'd', type: 'chat', priority: 'low' },
        previousMessages: [
          { role: 'system', content: 'legacy-system' },
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'world' },
        ],
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

    expect(result.messages.some((message) => message.role === 'system' && message.content === 'legacy-system')).toBe(false);
    expect(result.messages.some((message) => message.role === 'user' && message.content === 'hello')).toBe(true);
    expect(result.messages.some((message) => message.role === 'assistant' && message.content === 'world')).toBe(true);
    expect(result.systemBlockCount).toBe(1);
    expect(result.blockMetas[0]).toMatchObject({
      layer: 'identity',
      scope: 'run',
      stability: 'static',
      systemMessageCount: 1,
    });
  });
});
