import { AgentSession } from '@agent/schemas/agent-session.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { ChatMessage, Task } from '../../../../../../src/shared/types';
import { AgentContext, EnabledAgentSkillContext } from '../agent.types';

export type ScenarioType = 'orchestration' | 'meeting' | 'chat';

export type ContextLayer = 'identity' | 'toolset' | 'domain' | 'collaboration' | 'task' | 'memory';

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
}

export interface ContextBlockBuilder {
  readonly layer: ContextLayer;
  shouldInject(input: ContextBuildInput): boolean;
  build(input: ContextBuildInput): Promise<ChatMessage[]>;
}
