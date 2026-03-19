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
  emptyMeetingResponseFallback: staticPrompt(
    'EMPTY_MEETING_RESPONSE_FALLBACK',
    'meeting empty response fallback',
    'meeting',
    'empty-response-fallback',
    '操作进行中，1 分钟内补充回执。',
  ),

  defaultMeetingExecutionPolicyPrompt: staticPrompt(
    'DEFAULT_MEETING_EXECUTION_POLICY_PROMPT',
    'meeting execution policy',
    'meeting',
    'meeting-execution-policy',
    '会议执行规则：\n' +
      '1) 一次确认后自动执行：用户已明确同意时，直接执行，不再二次确认语气或文案。\n',
  ),

  createAgentDefaultSystemPrompt: {
    symbol: 'CREATE_AGENT_DEFAULT_SYSTEM_PROMPT',
    context: 'createAgent system prompt fallback',
    scene: 'agent-management',
    role: 'create-agent-default-system-prompt',
    buildDefaultContent: ({ agentName }: { agentName: string }) => `You are ${agentName}, a helpful AI assistant.`,
  } as AgentPromptTemplate<{ agentName: string }>,

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

  toolInjectionInstruction: {
    symbol: 'TOOL_INJECTION_INSTRUCTION_PROMPT',
    context: 'tool injection instruction',
    scene: 'agent-runtime',
    role: 'tool-injection-instruction',
    buildDefaultContent: ({ toolSpecs }: { toolSpecs: string[] }) =>
      `工作时，你需要优先考虑使用已有工具来解决问题，并遵守以下规则：\n` +
      `1. 确认工具权限：当你发现没有工具权限你可以询问是否可以给添加工具。\n` +
      `2. 参数错误处理：当返回结果提示参数错误错误时，修改参数重试工具调用。\n` +
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

  generationErrorRetryInstruction: staticPrompt(
    'GENERATION_ERROR_RETRY_PROMPT',
    'generation error retry',
    'meeting',
    'generation-error-retry',
    '上一轮生成异常，请立即重试并直接给出可执行回执；不要重复提问。',
  ),

  modelManagementGroundingInstruction: staticPrompt(
    'MODEL_MANAGEMENT_GROUNDING_PROMPT',
    'model management force tool grounding',
    'model-management',
    'force-tool-grounding',
    '你正在处理模型管理请求。禁止在未调用并拿到工具结果时声称“已添加成功/已完成添加”。请立即调用 builtin.sys-mg.mcp.model-admin.add-model 执行写入，并调用 builtin.sys-mg.mcp.model-admin.list-models 验证后再回答。若工具失败，请明确说明失败原因。',
  ),

  emptyResponseRetryInstruction: staticPrompt(
    'EMPTY_RESPONSE_RETRY_PROMPT',
    'empty response retry',
    'meeting',
    'empty-response-retry',
    '你的上一轮回复为空。请立即返回最小可用回执，至少包含：已分配、已通知、下一检查点。',
  ),

  toolDeniedInstruction: {
    symbol: 'TOOL_DENIED_PROMPT',
    context: 'tool denied instruction',
    scene: 'agent-runtime',
    role: 'tool-denied',
    buildDefaultContent: ({ normalizedToolId }: { normalizedToolId: string }) =>
      `工具调用被拒绝: agent 未分配工具 ${normalizedToolId}。请在已授权工具内重新尝试，或直接给出不依赖该工具的回答。`,
  } as AgentPromptTemplate<{ normalizedToolId: string }>,

  toolFailedInstruction: {
    symbol: 'TOOL_FAILED_PROMPT',
    context: 'tool failed instruction',
    scene: 'agent-runtime',
    role: 'tool-failed',
    buildDefaultContent: ({ normalizedToolId, message }: { normalizedToolId: string; message: string }) =>
      `工具 ${normalizedToolId} 调用失败: ${message}。请根据现有信息继续回答。`,
  } as AgentPromptTemplate<{ normalizedToolId: string; message: string }>,

  toolRoundLimitMessage: staticPrompt(
    'TOOL_ROUND_LIMIT_MESSAGE',
    'tool round limit',
    'agent-runtime',
    'tool-round-limit',
    '工具调用轮次已达上限，请精简调用后重试。',
  ),
} as const;
