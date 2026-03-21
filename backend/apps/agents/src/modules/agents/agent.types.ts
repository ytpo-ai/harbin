import { ChatMessage, Task } from '../../../../../src/shared/types';

export interface AgentContext {
  task: Task;
  collaborationContext?: Record<string, unknown>;
  sessionContext?: Record<string, unknown>;
  opencodeRuntime?: {
    endpoint?: string;
    endpointRef?: string;
    authEnable?: boolean;
  };
  runtimeRouting?: {
    taskType?: string;
    preferredChannel?: 'native' | 'opencode';
    source?: string;
  };
  runtimeLifecycle?: {
    onStarted?: (input: { runId: string; sessionId?: string; traceId: string }) => void | Promise<void>;
    onOpenCodeSession?: (input: { sessionId: string; endpoint?: string; authEnable: boolean }) => void | Promise<void>;
  };
  actor?: {
    employeeId?: string;
    role?: string;
  };
  approval?: {
    approved?: boolean;
    approvalId?: string;
    approverId?: string;
    reason?: string;
  };
  previousMessages: ChatMessage[];
  workingMemory: Map<string, any>;
}

export interface ExecuteTaskResult {
  response: string;
  runId: string;
  sessionId?: string;
}

export interface AgentMcpToolSummary {
  id: string;
  name: string;
  description: string;
  type?: string;
  category?: string;
}

export interface AgentMcpProfile {
  id: string;
  name: string;
  description: string;
  roleId?: string;
  role: string;
  capabilitySet: string[];
  toolSet: AgentMcpToolSummary[];
  exposed: boolean;
  mapKey: string;
}

export interface AgentBusinessRole {
  id: string;
  code: string;
  name: string;
  tier: 'leadership' | 'operations' | 'temporary';
  description?: string;
  status: 'active' | 'inactive';
  capabilities?: string[];
  tools?: string[];
  promptTemplate?: string;
}

export interface AgentToolPermissionSet {
  roleId?: string;
  roleCode: string;
  roleName: string;
  roleStatus: 'active' | 'inactive' | 'unknown';
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

export interface AgentMcpMapProfile {
  role: string;
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

export interface EnabledAgentSkillContext {
  id: string;
  name: string;
  description: string;
  tags: string[];
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

export interface SystemContextFingerprintRecord {
  fingerprint: string;
  snapshot?: Record<string, unknown>;
  updatedAt: string;
}

export interface TaskInfoSnapshot {
  title: string;
  description: string;
  type: string;
  priority: string;
}

export interface IdentityMemoSnapshotItem {
  title: string;
  topic: string;
  contentHash: string;
}
