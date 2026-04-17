import { CollaborationContext } from '@libs/contracts';

export interface ToolExecutionContext {
  collaborationContext?: CollaborationContext | Record<string, any>;
  taskType?: string;
  teamId?: string;
  taskId?: string;
  idempotencyKey?: string;
  auth?: {
    mode?: 'jwt' | 'internal-context' | 'legacy';
    scopes?: string[];
    permissions?: string[];
    jti?: string;
  };
  originSessionId?: string;
  actor?: {
    employeeId?: string;
    role?: string;
  };
  assignedToolIds?: string[];
  /**
   * Project ID from orchestration plan (plan.projectId).
   * NOTE: This is typically an IncubationProject._id, NOT the local RdProject._id.
   * For the local RdProject ID, use collaborationContext.projectBinding.localProjectId.
   */
  projectId?: string;
  /** Local filesystem path of the bound project. */
  localProjectPath?: string;
}
