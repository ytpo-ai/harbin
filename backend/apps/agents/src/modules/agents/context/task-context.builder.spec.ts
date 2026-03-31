import { TaskContextBuilder } from './task-context.builder';

describe('TaskContextBuilder', () => {
  function createBuilder() {
    const contextPromptService = {
      resolvePromptTemplate: jest.fn(),
    } as any;
    const contextFingerprintService = {
      resolveSystemContextBlockContent: jest
        .fn()
        .mockImplementation(async ({ fullContent }: { fullContent: string }) => fullContent),
      buildTaskInfoDelta: jest.fn().mockReturnValue(''),
      hashFingerprint: jest.fn().mockReturnValue('hash'),
    } as any;

    return {
      builder: new TaskContextBuilder(contextPromptService, contextFingerprintService),
      contextFingerprintService,
    };
  }

  it('suppresses task description when description is used as primary user prompt', async () => {
    const { builder } = createBuilder();
    const result = await builder.build({
      scenarioType: 'orchestration',
      contextScope: 'scope:test',
      task: {
        title: 'Incremental planning: generate next task',
        description: '[SYSTEM OVERRIDE] very long planner prompt body',
        type: 'planning',
        priority: 'high',
        messages: [],
      },
      context: {
        previousMessages: [],
      },
    } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
    expect(String(result[0].content)).toContain('任务信息:');
    expect(String(result[0].content)).not.toContain('描述:');
  });

  it('keeps a short description summary when user prompt already exists in history', async () => {
    const { builder } = createBuilder();
    const longDescription = 'a'.repeat(140);
    const result = await builder.build({
      scenarioType: 'orchestration',
      contextScope: 'scope:test',
      task: {
        title: 'Follow-up task',
        description: longDescription,
        type: 'general',
        priority: 'medium',
        messages: [],
      },
      context: {
        previousMessages: [{ role: 'user', content: 'previous user prompt' }],
      },
    } as any);

    expect(result).toHaveLength(1);
    expect(String(result[0].content)).toContain('描述:');
    expect(String(result[0].content)).toContain(`${'a'.repeat(120)}...`);
  });
});
