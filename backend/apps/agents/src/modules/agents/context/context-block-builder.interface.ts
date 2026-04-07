import { AgentSession } from '@agent/schemas/agent-session.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { ChatMessage, Task } from '../../../../../../src/shared/types';
import { AgentContext, EnabledAgentSkillContext } from '../agent.types';

export type ScenarioType = 'orchestration' | 'meeting' | 'inner-message' | 'chat';

export type ContextLayer = 'identity' | 'toolset' | 'domain' | 'collaboration' | 'task' | 'deduction' | 'memory';

export type MessageScope = 'run' | 'session';

export type BlockStability = 'static' | 'semi-static' | 'dynamic';

export interface ContextBlockMeta {
  scope: MessageScope;
  stability: BlockStability;
}

export interface AssembledContextBlockMeta extends ContextBlockMeta {
  layer: ContextLayer;
  messageCount: number;
  systemMessageCount: number;
}

export interface AssembledContext {
  messages: ChatMessage[];
  systemBlockCount: number;
  blockMetas: AssembledContextBlockMeta[];
}

export interface ContextBuildInput {
  agent: Agent;
  task: Task;
  context: AgentContext;
  enabledSkills: EnabledAgentSkillContext[];
  scenarioType: ScenarioType;
  contextScope: string;
  identityMemos: Array<{ title?: string; content?: string; payload?: { topic?: string } }>;
  shared: {
    allowedToolIds: string[];
    assignedTools: Array<{ id?: string; canonicalId?: string; name?: string; description?: string; prompt?: string }>;
    skillContents: Map<string, string>;
  };
  persistedContext?: {
    domainContext?: AgentSession['domainContext'];
    collaborationContext?: AgentSession['collaborationContext'];
    runSummaries?: AgentSession['runSummaries'];
  };
  /** 跳过 fingerprint 去重，始终注入完整系统消息。
   *  当没有 session 缓存保底时（如 meeting 场景无 sessionId）应设为 true，
   *  避免 fingerprint 命中后返回 null 导致系统提示丢失。 */
  skipDedup?: boolean;
}

export interface ContextBlockBuilder {
  readonly layer: ContextLayer;
  readonly meta: ContextBlockMeta;
  shouldInject(input: ContextBuildInput): boolean;
  build(input: ContextBuildInput): Promise<ChatMessage[]>;
}
