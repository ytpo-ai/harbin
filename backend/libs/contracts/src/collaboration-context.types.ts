export type ResponseDirective = 'json-only' | 'json-preferred' | 'text';

export type ScenarioMode = 'meeting' | 'orchestration' | 'inner-message' | 'chat';

export interface CollaborationContextBase {
  scenarioMode: ScenarioMode;
  responseDirective: ResponseDirective;
  [key: string]: unknown;
}

export interface MeetingCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'meeting';
  meetingId: string;
  meetingTitle?: string;
  meetingDescription?: string;
  meetingType?: string;
  agenda?: string;
  participants?: Array<{
    id: string;
    name?: string;
    type?: 'employee' | 'agent';
    role?: 'host' | 'participant';
  }>;
  participantProfiles?: unknown[];
  commandPriority?: {
    highestAuthority: string;
    exclusiveAssistantOverride: boolean;
  };
  collaborationMode?: 'meeting';
  initiatorId?: string;
}

export interface OrchestrationCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'orchestration';
  responseDirective: ResponseDirective;
  planId: string;
  roleInPlan: 'planner' | 'planner_initialize' | 'executor' | 'planner_pre_execution' | 'planner_post_execution';
  agentTier?: 'leadership' | 'operations' | 'temporary';
  collaborators?: Array<{
    agentId: string;
    name?: string;
    tier?: string;
    roleInPlan?: string;
    relationship?: 'upstream' | 'downstream' | 'parallel';
  }>;
  delegationRules?: {
    canDelegateTo?: string[];
    cannotDelegateTo?: string[];
  };
  currentTaskId?: string;
  currentTaskTitle?: string;
  executorAgentId?: string;
  dependencies?: unknown;
  upstreamOutputs?: unknown;
  domainType?: 'general' | 'development' | 'research';
  phase?: 'initialize' | 'generating' | 'pre_execute' | 'executing' | 'post_execute' | 'idle';
  taskType?: string;
  skillActivation?: { mode: 'standard' | 'precise' };
  format?: 'json';
  mode?: 'planning' | 'orchestration';
}

export interface InnerMessageCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'inner-message';
  responseDirective: 'json-only' | 'text';
  messageId?: string;
  eventType?: string;
  senderAgentId?: string;
  triggerSource?: string;
  meetingId?: string;
  planId?: string;
  scheduleId?: string;
  runtimeTaskType?: 'internal_message' | 'scheduled_task';
}

export interface ChatCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'chat';
  responseDirective: 'text';
  initiator?: {
    id: string;
    name: string;
    type: 'employee' | 'agent';
  };
}

export type CollaborationContext =
  | MeetingCollaborationContext
  | OrchestrationCollaborationContext
  | InnerMessageCollaborationContext
  | ChatCollaborationContext;

export function isMeetingContext(ctx: CollaborationContext): ctx is MeetingCollaborationContext {
  return ctx.scenarioMode === 'meeting';
}

export function isOrchestrationContext(ctx: CollaborationContext): ctx is OrchestrationCollaborationContext {
  return ctx.scenarioMode === 'orchestration';
}

export function isInnerMessageContext(ctx: CollaborationContext): ctx is InnerMessageCollaborationContext {
  return ctx.scenarioMode === 'inner-message';
}

export function isChatContext(ctx: CollaborationContext): ctx is ChatCollaborationContext {
  return ctx.scenarioMode === 'chat';
}

export function isJsonOutputRequired(ctx: CollaborationContext): boolean {
  return ctx.responseDirective === 'json-only';
}
