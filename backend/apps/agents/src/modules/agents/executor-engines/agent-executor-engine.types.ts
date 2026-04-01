import { Agent } from '@agent/schemas/agent.schema';
import { AIModel, ChatMessage, Task } from '@legacy/shared/types';

import { RuntimeRunContext } from '@agent/modules/runtime/runtime-orchestrator.service';

import { AgentContext } from '../agent.types';
import { OpenCodeExecutionConfig } from '../agent-opencode-policy.service';

export type AgentExecutionChannel = 'native' | 'opencode';

export type AgentExecutionMode = 'detailed' | 'streaming';

export type { OpenCodeExecutionConfig };

export interface ResolvedOpenCodeRuntime {
  baseUrl?: string;
  authEnable: boolean;
  source: 'agent_config_endpoint' | 'agent_config_endpoint_ref' | 'runtime_endpoint' | 'runtime_endpoint_ref' | 'env_default';
}

export interface NativeToolExecutionContext {
  collaborationContext?: Record<string, unknown>;
  actor?: {
    employeeId?: string;
    role?: string;
  };
  taskType?: string;
  teamId?: string;
  preactivatedToolIds?: string[];
}

export interface AgentExecutorEngineInput {
  mode: AgentExecutionMode;
  channel: AgentExecutionChannel;
  agent: Agent;
  runtimeAgentId: string;
  task: Task;
  taskId: string;
  messages: ChatMessage[];
  runtimeContext: RuntimeRunContext;
  modelConfig: AIModel;
  context?: Partial<AgentContext>;
  openCodeExecutionConfig?: OpenCodeExecutionConfig;
  onToken?: (token: string) => void;
  resolveCustomApiKey: (logPrefix: 'task' | 'stream_task') => Promise<string | undefined>;
  executeWithToolCalling: (
    agent: Agent,
    task: Task,
    initialMessages: ChatMessage[],
    modelConfig: AIModel,
    runtimeContext?: RuntimeRunContext,
    executionContext?: NativeToolExecutionContext,
  ) => Promise<string>;
  logResolvedOpenCodeRuntime: (taskId: string, mode: AgentExecutionMode, runtime: ResolvedOpenCodeRuntime) => void;
}

export interface AgentExecutorEngineResult {
  response: string;
  tokenChunks?: number;
}
