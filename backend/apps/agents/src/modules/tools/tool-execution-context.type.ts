export interface ToolExecutionContext {
  collaborationContext?: Record<string, any>;
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
}
