import { Agent } from '@legacy/shared/schemas/agent.schema';
import { AIModel, ChatMessage, Task } from '@legacy/shared/types';
import { MessageFilter } from '@agent/modules/runtime/hooks/lifecycle-hook.types';

export type AgentExecutorStepContext = {
  agent: Agent;
  task: Task;
  messages: ChatMessage[];
  modelConfig: AIModel;
  round: number;
  maxRounds: number;
  assignedToolIds: string[];
  executedToolIds: string[];
};

export type AgentExecutorBeforeStepHookResult = {
  appendSystemMessages: string[];
  forcedToolCall?: {
    tool: string;
    parameters: Record<string, unknown>;
    reason: string;
  };
  decision?: string;
  /** 消息过滤规则：在消息发送给模型前过滤/替换 */
  messageFilters?: MessageFilter[];
  /** 控制指令：请求暂停 run */
  pauseRequested?: boolean;
  pauseReason?: string;
  /** 控制指令：请求取消 task/run */
  cancelRequested?: boolean;
  cancelReason?: string;
};

export type AgentExecutorAfterStepHookResult = {
  appendSystemMessages: string[];
  decision: 'accept' | 'inject_instruction';
  /** 控制指令：请求暂停 run */
  pauseRequested?: boolean;
  pauseReason?: string;
  /** 控制指令：请求取消 task/run */
  cancelRequested?: boolean;
  cancelReason?: string;
  /** 控制指令：请求重试当前 step */
  retryRequested?: boolean;
};

export interface AgentBeforeStepHook {
  matches(context: AgentExecutorStepContext): boolean | Promise<boolean>;
  run(context: AgentExecutorStepContext): Promise<AgentExecutorBeforeStepHookResult>;
}

export interface AgentAfterStepHook {
  matches(context: AgentExecutorStepContext, response: string): boolean | Promise<boolean>;
  run(context: AgentExecutorStepContext, response: string): Promise<AgentExecutorAfterStepHookResult>;
}
