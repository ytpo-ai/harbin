import { AgentExecutorService } from './agent-executor.service';
import {
  buildToolInputRepairInstruction,
  getToolInputPreflightError,
  isMeaninglessAssistantResponse,
  isToolInputErrorMessage,
  resolveOpenCodeRuntimeOptions,
} from './agent-executor.helpers';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';

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
    const result = resolveOpenCodeRuntimeOptions(
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
    const result = resolveOpenCodeRuntimeOptions(
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
    expect(isMeaninglessAssistantResponse('')).toBe(true);
    expect(isMeaninglessAssistantResponse('   ')).toBe(true);
    expect(isMeaninglessAssistantResponse('-')).toBe(true);
    expect(isMeaninglessAssistantResponse('—')).toBe(true);
    expect(isMeaninglessAssistantResponse('...')).toBe(true);
    expect(isMeaninglessAssistantResponse('已完成分配并通知')).toBe(false);
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

describe('AgentExecutorService system prompt ordering', () => {
  it('injects agent working guideline as first system prompt', async () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    service.memoService = {
      getIdentityMemos: jest.fn().mockResolvedValue([]),
    };
    service.redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    service.agentRoleService = {
      getAllowedToolIds: jest.fn().mockResolvedValue([]),
    };
    service.toolService = {
      getToolsByIds: jest.fn().mockResolvedValue([]),
    };
    service.resolveAgentPromptContent = jest.fn().mockImplementation((template: any, payload?: any) => {
      if (payload) {
        return template.buildDefaultContent(payload);
      }
      return template.buildDefaultContent();
    });

    const messages = await service.buildMessages(
      {
        id: 'agent-1',
        systemPrompt: '你是一个专注交付结果的工程 Agent。',
      },
      {
        id: 'task-1',
        title: '实现接口',
        description: '新增 agent runtime 接口',
        type: 'engineering',
        priority: 'high',
      },
      {
        task: {
          id: 'task-1',
          title: '实现接口',
          description: '新增 agent runtime 接口',
          type: 'engineering',
          priority: 'high',
        },
        previousMessages: [],
        workingMemory: new Map(),
      },
      [],
    );

    expect(messages[0]).toMatchObject({
      role: 'system',
      content: AGENT_PROMPTS.agentWorkingGuideline.buildDefaultContent(),
    });
    expect(messages[1]).toMatchObject({
      role: 'system',
      content: '你是一个专注交付结果的工程 Agent。',
    });
  });

  it('does not retain legacy system prompts from previous history', async () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    service.memoService = {
      getIdentityMemos: jest.fn().mockResolvedValue([]),
    };
    service.redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    service.agentRoleService = {
      getAllowedToolIds: jest.fn().mockResolvedValue([]),
    };
    service.toolService = {
      getToolsByIds: jest.fn().mockResolvedValue([]),
    };
    service.contextStrategyService = {
      shouldActivateSkillContent: jest.fn().mockReturnValue(false),
    };
    service.skillModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => null }) }),
    };
    service.contextFingerprintService = {
      resolveSystemContextScope: jest.fn().mockReturnValue('scope:test'),
    };
    service.debugTiming = jest.fn();

    const workingGuideline = AGENT_PROMPTS.agentWorkingGuideline.buildDefaultContent();
    const baseSystemPrompt = '你是一个专注交付结果的工程 Agent。';
    service.contextAssembler = {
      assemble: jest.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: workingGuideline },
          { role: 'system', content: baseSystemPrompt },
          { role: 'user', content: 'hello' },
        ],
        systemBlockCount: 2,
        blockMetas: [],
      }),
    };

    const messages = await service.buildMessages(
      {
        id: 'agent-1',
        systemPrompt: baseSystemPrompt,
      },
      {
        id: 'task-1',
        title: '实现接口',
        description: '新增 agent runtime 接口',
        type: 'engineering',
        priority: 'high',
      },
      {
        task: {
          id: 'task-1',
          title: '实现接口',
          description: '新增 agent runtime 接口',
          type: 'engineering',
          priority: 'high',
        },
        previousMessages: [
          { role: 'system', content: workingGuideline },
          { role: 'system', content: baseSystemPrompt },
          { role: 'system', content: '历史保留系统提示' },
        ],
        workingMemory: new Map(),
      },
      [],
    );

    const systemContents = messages
      .filter((message: any) => message.role === 'system')
      .map((message: any) => String(message.content));

    expect(systemContents.filter((content) => content === workingGuideline)).toHaveLength(1);
    expect(systemContents.filter((content) => content === baseSystemPrompt)).toHaveLength(1);
    expect(systemContents.filter((content) => content === '历史保留系统提示')).toHaveLength(0);
  });

  it('uses change-driven system blocks across repeated rounds', async () => {
    const service = Object.create(AgentExecutorService.prototype) as any;
    service.memoService = {
      getIdentityMemos: jest.fn().mockResolvedValue([]),
    };
    service.redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    service.agentRoleService = {
      getAllowedToolIds: jest.fn().mockResolvedValue([]),
    };
    service.toolService = {
      getToolsByIds: jest.fn().mockResolvedValue([]),
    };
    service.contextStrategyService = {
      shouldActivateSkillContent: jest.fn().mockReturnValue(false),
    };
    service.skillModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => null }) }),
    };
    service.contextFingerprintService = {
      resolveSystemContextScope: jest.fn().mockReturnValue('scope:test'),
    };
    service.debugTiming = jest.fn();

    const agent = {
      id: 'agent-1',
      systemPrompt: '你是一个专注交付结果的工程 Agent。',
    };
    const task = {
      id: 'task-1',
      title: '实现接口',
      description: '新增 agent runtime 接口',
      type: 'engineering',
      priority: 'high',
    };
    const guideline = AGENT_PROMPTS.agentWorkingGuideline.buildDefaultContent();
    service.contextAssembler = {
      assemble: jest
        .fn()
        .mockResolvedValueOnce({
          messages: [
            { role: 'system', content: guideline },
            { role: 'system', content: agent.systemPrompt },
            { role: 'user', content: 'hello' },
          ],
          systemBlockCount: 2,
          blockMetas: [],
        })
        .mockResolvedValueOnce({
          messages: [{ role: 'user', content: 'follow-up' }],
          systemBlockCount: 0,
          blockMetas: [],
        }),
    };

    const firstRoundMessages = await service.buildMessages(
      agent,
      task,
      {
        task,
        previousMessages: [],
        workingMemory: new Map(),
      },
      [],
    );

    const secondRoundMessages = await service.buildMessages(
      agent,
      task,
      {
        task,
        previousMessages: firstRoundMessages,
        workingMemory: new Map(),
      },
      [],
    );

    const round2SystemContents = secondRoundMessages
      .filter((message: any) => message.role === 'system')
      .map((message: any) => String(message.content));

    expect(round2SystemContents.filter((content) => content === guideline)).toHaveLength(0);
    expect(round2SystemContents.filter((content) => content === agent.systemPrompt)).toHaveLength(0);
  });
});

describe('AgentExecutorService tool input repair helpers', () => {
  it('detects parameter-related tool errors', () => {
    expect(isToolInputErrorMessage('Invalid tool parameters: missing required field')).toBe(true);
    expect(isToolInputErrorMessage('send_internal_message requires title and content')).toBe(true);
    expect(isToolInputErrorMessage('network timeout')).toBe(false);
  });

  it('builds concise tool input repair instruction', () => {
    const content = buildToolInputRepairInstruction(
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
      "missing required field 'title'",
    );

    expect(content).toContain('错误原因：');
    expect(content).toContain('inputSchema=');
    expect(content).toContain('lastParameters=');
    expect(content).toContain('<tool_call>');
    expect(content).toContain('send-internal-message');
  });

  it('detects preflight required-field and unknown-field errors', () => {
    const schema = {
      type: 'object',
      required: ['receiverAgentId', 'title', 'content'],
      additionalProperties: false,
      properties: {
        receiverAgentId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
      },
    };

    expect(getToolInputPreflightError(schema, { receiverAgentId: 'a1' })).toContain("missing required field 'title'");
    expect(
      getToolInputPreflightError(schema, {
        receiverAgentId: 'a1',
        title: 'hello',
        content: 'world',
        toAgentId: 'legacy',
      }),
    ).toContain('unknown fields');
    expect(
      getToolInputPreflightError(schema, {
        receiverAgentId: 'a1',
        title: 'hello',
        content: 'world',
      }),
    ).toBeNull();
  });
});
