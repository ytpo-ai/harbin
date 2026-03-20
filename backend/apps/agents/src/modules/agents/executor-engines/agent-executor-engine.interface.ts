import { AgentExecutionChannel, AgentExecutionMode, AgentExecutorEngineInput, AgentExecutorEngineResult } from './agent-executor-engine.types';

export interface AgentExecutorEngine {
  readonly mode: AgentExecutionMode;
  readonly channel: AgentExecutionChannel;
  execute(input: AgentExecutorEngineInput): Promise<AgentExecutorEngineResult>;
}
