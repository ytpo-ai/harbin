export interface AgentPromptTemplate<TPayload = void> {
  symbol: string;
  context: string;
  scene: string;
  role: string;
  buildDefaultContent: [TPayload] extends [void] ? () => string : (payload: TPayload) => string;
}

const staticPrompt = (
  symbol: string,
  context: string,
  scene: string,
  role: string,
  defaultContent: string,
): AgentPromptTemplate<void> => ({
  symbol,
  context,
  scene,
  role,
  buildDefaultContent: () => defaultContent,
});

export const AGENT_PROMPTS = {
  agentWorkingGuideline: staticPrompt(
    'AGENT_WORKING_GUIDELINE_PROMPT',
    'agent working guideline',
    'agent-runtime',
    'agent-working-guideline',
    '请遵循已激活技能中的工作准则。若无相关技能，执行最小默认原则：先理解目标，再调用已授权工具落地。',
  ),

  defaultMeetingExecutionPolicyPrompt: staticPrompt(
    'DEFAULT_MEETING_EXECUTION_POLICY_PROMPT',
    'meeting execution policy',
    'meeting',
    'meeting-execution-policy',
    '会议执行策略请优先遵循已激活技能 `meeting-sensitive-planner` 与 `meeting-resilience`。\n' +
      '若未激活对应技能，遵循最小原则：用户明确同意后直接执行，不做重复确认。',
  ),

  createAgentDefaultSystemPrompt: {
    symbol: 'CREATE_AGENT_DEFAULT_SYSTEM_PROMPT',
    context: 'createAgent system prompt fallback',
    scene: 'agent-management',
    role: 'create-agent-default-system-prompt',
    buildDefaultContent: ({ agentName }: { agentName: string }) => `You are ${agentName}, a helpful AI assistant.`,
  } as AgentPromptTemplate<{ agentName: string }>,

  toolInjectionInstruction: {
    symbol: 'TOOL_INJECTION_INSTRUCTION_PROMPT',
    context: 'tool injection instruction',
    scene: 'agent-runtime',
    role: 'tool-injection-instruction',
    buildDefaultContent: ({ toolSpecs }: { toolSpecs: string[] }) =>
      `你可以调用以下工具（仅限这些）:\n${toolSpecs.join('\n')}\n\n当你需要调用工具时，必须只输出以下格式，不要添加任何额外文本:\n` +
      `<tool_call>{"tool":"tool_id","parameters":{}}</tool_call>\n\n，工具结果收到后继续完成最终回答。`,
  } as AgentPromptTemplate<{ toolSpecs: string[] }>,

  toolStrategyWrapper: {
    symbol: 'TOOL_STRATEGY_WRAPPER_PROMPT',
    context: 'tool strategy wrapper',
    scene: 'agent-runtime',
    role: 'tool-strategy-wrapper',
    buildDefaultContent: ({ toolPromptMessages }: { toolPromptMessages: string[] }) =>
      `工具使用策略（按工具聚合）:\n\n${toolPromptMessages.join('\n\n')}`,
  } as AgentPromptTemplate<{ toolPromptMessages: string[] }>,

  emptyMeetingResponseFallback: staticPrompt(
    'EMPTY_MEETING_RESPONSE_FALLBACK',
    'meeting empty response fallback',
    'meeting',
    'empty-response-fallback',
    '操作进行中，1 分钟内补充回执。',
  ),

  generationErrorRetryInstruction: staticPrompt(
    'GENERATION_ERROR_RETRY_PROMPT',
    'generation error retry',
    'meeting',
    'generation-error-retry',
    '会议异常处理请优先遵循已激活技能 `meeting-resilience`。若未激活，立即重试并直接给出可执行回执。',
  ),

  emptyResponseRetryInstruction: staticPrompt(
    'EMPTY_RESPONSE_RETRY_PROMPT',
    'empty response retry',
    'meeting',
    'empty-response-retry',
    '会议空回复处理请优先遵循已激活技能 `meeting-resilience`。若未激活，请立即返回最小可用回执。',
  ),

  forcedToolCallInstruction: {
    symbol: 'FORCED_TOOL_CALL_PROMPT',
    context: 'forced tool call instruction',
    scene: 'agent-runtime',
    role: 'forced-tool-call',
    buildDefaultContent: ({
      tool,
      parametersJson,
    }: {
      tool: string;
      parametersJson: string;
    }) =>
      `执行前优化建议：你已确认用户存在明确意图。请立即调用 <tool_call>{"tool":"${tool}","parameters":${parametersJson}}</tool_call> 并等待工具结果后再回复。`,
  } as AgentPromptTemplate<{ tool: string; parametersJson: string }>,

  toolDeniedInstruction: {
    symbol: 'TOOL_DENIED_PROMPT',
    context: 'tool denied instruction',
    scene: 'agent-runtime',
    role: 'tool-denied',
    buildDefaultContent: ({ normalizedToolId }: { normalizedToolId: string }) =>
      `工具调用被拒绝: agent 未分配工具 ${normalizedToolId}。请在已授权工具内重试；降级处理请遵循已激活的 runtime 基线技能。`,
  } as AgentPromptTemplate<{ normalizedToolId: string }>,

  toolFailedInstruction: {
    symbol: 'TOOL_FAILED_PROMPT',
    context: 'tool failed instruction',
    scene: 'agent-runtime',
    role: 'tool-failed',
    buildDefaultContent: ({ normalizedToolId, message }: { normalizedToolId: string; message: string }) =>
      `工具 ${normalizedToolId} 调用失败: ${message}。请根据现有信息继续；降级策略请遵循已激活的 runtime 基线技能。`,
  } as AgentPromptTemplate<{ normalizedToolId: string; message: string }>,

  toolRoundLimitMessage: staticPrompt(
    'TOOL_ROUND_LIMIT_MESSAGE',
    'tool round limit',
    'agent-runtime',
    'tool-round-limit',
    '工具调用轮次已达上限，请停止继续试探并按已激活的 runtime 基线技能执行降级。',
  ),

   testConnectionDefaultSystemPrompt: staticPrompt(
    'TEST_CONNECTION_DEFAULT_SYSTEM_PROMPT',
    'testConnection system prompt fallback',
    'agent-test-connection',
    'system-prompt',
    'You are a helpful AI assistant.',
  ),

  testConnectionUserMessage: staticPrompt(
    'TEST_CONNECTION_USER_MESSAGE',
    'testConnection user message',
    'agent-test-connection',
    'verification-user-message',
    '请回复: Agent Connected to AI Model Successfully',
  ),

} as const;
