export interface ToolExecutionContext {
  teamContext?: Record<string, any>;
  taskType?: string;
  teamId?: string;
  taskId?: string;
  idempotencyKey?: string;
  actor?: {
    employeeId?: string;
    role?: string;
  };
}
