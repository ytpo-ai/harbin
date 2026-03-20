import { Injectable } from '@nestjs/common';

import { AgentExecutorEngine } from './agent-executor-engine.interface';
import { AgentExecutionChannel, AgentExecutionMode } from './agent-executor-engine.types';
import { NativeAgentExecutorEngine } from './native-agent-executor.engine';
import { NativeStreamingAgentExecutorEngine } from './native-streaming-agent-executor.engine';
import { OpencodeAgentExecutorEngine } from './opencode-agent-executor.engine';
import { OpencodeStreamingAgentExecutorEngine } from './opencode-streaming-agent-executor.engine';

@Injectable()
export class AgentExecutorEngineRouter {
  private readonly engines: AgentExecutorEngine[];

  constructor(
    nativeAgentExecutorEngine: NativeAgentExecutorEngine,
    nativeStreamingAgentExecutorEngine: NativeStreamingAgentExecutorEngine,
    opencodeAgentExecutorEngine: OpencodeAgentExecutorEngine,
    opencodeStreamingAgentExecutorEngine: OpencodeStreamingAgentExecutorEngine,
  ) {
    this.engines = [
      nativeAgentExecutorEngine,
      nativeStreamingAgentExecutorEngine,
      opencodeAgentExecutorEngine,
      opencodeStreamingAgentExecutorEngine,
    ];
  }

  resolve(mode: AgentExecutionMode, channel: AgentExecutionChannel): AgentExecutorEngine {
    const engine = this.engines.find((item) => item.mode === mode && item.channel === channel);
    if (!engine) {
      throw new Error(`Agent executor engine not found for mode=${mode} channel=${channel}`);
    }
    return engine;
  }
}
