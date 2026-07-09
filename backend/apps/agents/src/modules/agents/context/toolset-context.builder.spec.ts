import { ToolsetContextBuilder } from './toolset-context.builder';

describe('ToolsetContextBuilder', () => {
  it('splits long skill content into multiple system messages without truncation marker', async () => {
    const builder = new ToolsetContextBuilder(
      {
        resolvePromptContent: jest.fn().mockResolvedValue(''),
      } as any,
      {
        shouldActivateSkillContent: jest.fn().mockReturnValue(true),
        buildToolPromptMessages: jest.fn().mockReturnValue([]),
      } as any,
      {
        resolveSystemContextBlockContent: jest.fn().mockResolvedValue(''),
      } as any,
    );

    const longContent = `A${'B'.repeat(4205)}`;
    const messages = await builder.build({
      agent: { id: 'agent-1' },
      task: { id: 'task-1', title: 't', description: 'd', type: 'engineering', priority: 'high' },
      context: {
        collaborationContext: { domainType: 'development', taskType: 'engineering', phase: 'generate' },
      },
      enabledSkills: [
        {
          id: 'skill-1',
          name: 'Long Skill',
          description: 'desc',
          proficiencyLevel: 'advanced',
          tags: [],
        },
      ],
      scenarioType: 'chat',
      contextScope: 'session:test',
      identityMemos: [],
      shared: {
        allowedToolIds: [],
        assignedTools: [],
        skillContents: new Map([['skill-1', longContent]]),
      },
    } as any);

    const skillMessages = messages.filter((message) => String(message.content || '').includes('【enabled skill - Long Skill'));
    expect(skillMessages.length).toBeGreaterThan(1);
    expect(skillMessages.some((message) => String(message.content || '').includes('内容已截断'))).toBe(false);
    expect(skillMessages[0]?.content).toContain('part 1/');
  });
});
