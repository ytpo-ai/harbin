import { AgentService } from './agent.service';

describe('AgentService tool prompt messages', () => {
  it('collects and sorts non-empty tool prompts', () => {
    const service = Object.create(AgentService.prototype);
    const result = service['buildToolPromptMessages']([
      { canonicalId: 'builtin.z', prompt: 'prompt z' },
      { canonicalId: 'builtin.a', prompt: 'prompt a' },
      { canonicalId: 'builtin.empty', prompt: '   ' },
    ]);

    expect(result).toEqual([
      '工具使用策略（builtin.a）:\nprompt a',
      '工具使用策略（builtin.z）:\nprompt z',
    ]);
  });

  it('deduplicates identical tool prompt messages', () => {
    const service = Object.create(AgentService.prototype);
    const result = service['buildToolPromptMessages']([
      { id: 'builtin.same', prompt: 'same prompt' },
      { canonicalId: 'builtin.same', prompt: 'same prompt' },
    ]);

    expect(result).toEqual(['工具使用策略（builtin.same）:\nsame prompt']);
  });
});
