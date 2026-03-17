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

describe('AgentService OpenCode runtime resolution', () => {
  it('prefers agent config endpoint over runtime endpoint', () => {
    const service = Object.create(AgentService.prototype);
    const result = service['resolveOpenCodeRuntimeOptions'](
      {
        endpoint: 'http://config-endpoint:4098',
        endpointRef: 'http://config-endpoint-ref:4098',
        authEnable: true,
      },
      {
        endpoint: 'http://runtime-endpoint:4098',
        endpointRef: 'http://runtime-endpoint-ref:4098',
        authEnable: false,
      },
    );

    expect(result).toEqual({
      baseUrl: 'http://config-endpoint:4098',
      authEnable: true,
      source: 'agent_config_endpoint',
    });
  });

  it('falls back to env default when no endpoint is provided', () => {
    const service = Object.create(AgentService.prototype);
    const result = service['resolveOpenCodeRuntimeOptions'](
      {
        authEnable: false,
      },
      {
        authEnable: true,
      },
    );

    expect(result).toEqual({
      baseUrl: undefined,
      authEnable: false,
      source: 'env_default',
    });
  });
});

describe('AgentService agent lookup query', () => {
  it('uses id lookup for non-ObjectId identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('executive-lead');

    expect(query).toEqual({ id: 'executive-lead' });
  });

  it('supports both _id and id for ObjectId-like identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('507f1f77bcf86cd799439011');

    expect(query).toEqual({
      $or: [
        { _id: '507f1f77bcf86cd799439011' },
        { id: '507f1f77bcf86cd799439011' },
      ],
    });
  });
});

describe('AgentService meeting response guard', () => {
  it('detects empty or dash-only responses as meaningless', () => {
    const service = Object.create(AgentService.prototype);

    expect(service['isMeaninglessAssistantResponse']('')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('   ')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('-')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('—')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('...')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('已完成分配并通知')).toBe(false);
  });

  it('builds task info delta when key fields changed', () => {
    const service = Object.create(AgentService.prototype);
    const delta = service['buildTaskInfoDelta'](
      {
        title: '旧标题',
        description: '旧描述',
        type: 'meeting',
        priority: 'medium',
      },
      {
        title: '新标题',
        description: '新描述',
        type: 'planning',
        priority: 'high',
      },
    );

    expect(delta).toContain('标题');
    expect(delta).toContain('描述');
    expect(delta).toContain('类型');
    expect(delta).toContain('优先级');
  });
});
