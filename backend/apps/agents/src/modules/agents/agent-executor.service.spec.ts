import { AgentExecutorService } from './agent-executor.service';

describe('AgentExecutorService tool prompt messages', () => {
  it('collects and sorts non-empty tool prompts', () => {
    const service = Object.create(AgentExecutorService.prototype);
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
    const service = Object.create(AgentExecutorService.prototype);
    const result = service['buildToolPromptMessages']([
      { id: 'builtin.same', prompt: 'same prompt' },
      { canonicalId: 'builtin.same', prompt: 'same prompt' },
    ]);

    expect(result).toEqual(['工具使用策略（builtin.same）:\nsame prompt']);
  });
});

describe('AgentExecutorService OpenCode runtime resolution', () => {
  it('prefers agent config endpoint over runtime endpoint', () => {
    const service = Object.create(AgentExecutorService.prototype);
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
    const service = Object.create(AgentExecutorService.prototype);
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

describe('AgentExecutorService meeting response guard', () => {
  it('detects empty or dash-only responses as meaningless', () => {
    const service = Object.create(AgentExecutorService.prototype);

    expect(service['isMeaninglessAssistantResponse']('')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('   ')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('-')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('—')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('...')).toBe(true);
    expect(service['isMeaninglessAssistantResponse']('已完成分配并通知')).toBe(false);
  });

  it('builds task info delta when key fields changed', () => {
    const service = Object.create(AgentExecutorService.prototype);
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

describe('AgentExecutorService prompt resolve redis guard', () => {
  it('falls back to default when redis cache is missing', async () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    service.promptResolverService = {
      hasPublishedCache: jest.fn().mockResolvedValue(false),
      resolve: jest.fn(),
    };
    service.logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    };

    const result = await service['resolveAgentPromptTemplate'](
      {
        scene: 'meeting',
        role: 'meeting-execution-policy',
        buildDefaultContent: () => 'default-content',
      },
      undefined,
    );

    expect(result).toEqual({
      content: 'default-content',
      source: 'code_default',
    });
    expect(service.promptResolverService.resolve).not.toHaveBeenCalled();
  });

  it('resolves prompt from redis cache when cache exists', async () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    service.promptResolverService = {
      hasPublishedCache: jest.fn().mockResolvedValue(true),
      resolve: jest.fn().mockResolvedValue({
        content: 'cached-prompt',
        source: 'redis_cache',
        version: 3,
      }),
    };
    service.logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    };

    const result = await service['resolveAgentPromptTemplate'](
      {
        scene: 'meeting',
        role: 'meeting-execution-policy',
        buildDefaultContent: () => 'default-content',
      },
      undefined,
    );

    expect(service.promptResolverService.resolve).toHaveBeenCalledWith({
      scene: 'meeting',
      role: 'meeting-execution-policy',
      defaultContent: 'default-content',
      cacheOnly: true,
    });
    expect(result).toEqual({
      content: 'cached-prompt',
      source: 'redis_cache',
      version: 3,
    });
  });
});

describe('AgentExecutorService tool input repair helpers', () => {
  it('detects parameter-related tool errors', () => {
    const service = Object.create(AgentExecutorService.prototype) as any;

    expect(service['isToolInputErrorMessage']('Invalid tool parameters: missing required field')).toBe(true);
    expect(service['isToolInputErrorMessage']('send_internal_message requires title and content')).toBe(true);
    expect(service['isToolInputErrorMessage']('network timeout')).toBe(false);
  });

  it('builds concise tool input repair instruction', () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    const content = service['buildToolInputRepairInstruction'](
      'builtin.sys-mg.mcp.inner-message.send-internal-message',
      {
        type: 'object',
        required: ['receiverAgentId', 'title', 'content'],
        properties: {
          receiverAgentId: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
        },
      },
      {
        receiverAgentId: 'agent-1',
      },
    );

    expect(content).toContain('inputSchema=');
    expect(content).toContain('lastParameters=');
    expect(content).toContain('<tool_call>');
    expect(content).toContain('send-internal-message');
  });
});
