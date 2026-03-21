import { AgentSession } from '@agent/schemas/agent-session.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { ChatMessage, Task } from '../../../../../../src/shared/types';
import { AgentContext, EnabledAgentSkillContext, IdentityMemoSnapshotItem, TaskInfoSnapshot } from '../agent.types';

export type ScenarioType = 'orchestration' | 'meeting' | 'chat';

export type ContextLayer = 'identity' | 'toolset' | 'domain' | 'collaboration' | 'task' | 'memory';

export interface ContextHelpers {
  resolvePromptContent: (template: any, payload?: unknown) => Promise<string>;
  resolvePromptTemplate: (template: any, payload?: unknown) => Promise<{ content: string; source: string; version?: number }>;
  resolveSystemContextBlockContent: (options: {
    scope: string;
    blockType: string;
    fullContent: string;
    snapshot: unknown;
    buildDelta?: (previous: unknown, current: unknown) => string;
    deltaPrefix?: string;
  }) => Promise<string | null>;
  hashFingerprint: (input: string) => string;
  buildTaskInfoDelta: (previous: TaskInfoSnapshot, current: TaskInfoSnapshot) => string;
  buildIdentityMemoDelta: (previous: IdentityMemoSnapshotItem[], current: IdentityMemoSnapshotItem[]) => string;
  shouldActivateSkillContent: (skill: EnabledAgentSkillContext, task: Task, context?: AgentContext) => boolean;
  buildToolPromptMessages: (assignedTools: Array<{ id?: string; canonicalId?: string; prompt?: string }>) => string[];
}

export interface ContextBuildInput {
  agent: Agent;
  task: Task;
  context: AgentContext;
  enabledSkills: EnabledAgentSkillContext[];
  scenarioType: ScenarioType;
  contextScope: string;
  identityMemos: Array<{ title?: string; content?: string; payload?: { topic?: string } }>;
  helpers: ContextHelpers;
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
