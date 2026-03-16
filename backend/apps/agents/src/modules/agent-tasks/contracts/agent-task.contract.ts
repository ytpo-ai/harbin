import { z } from 'zod';

export const AGENT_TASK_EVENT_TYPES = [
  'status',
  'progress',
  'token',
  'tool',
  'result',
  'error',
  'heartbeat',
] as const;

export const AgentTaskEventTypeSchema = z.enum(AGENT_TASK_EVENT_TYPES);

export type AgentTaskEventType = z.infer<typeof AgentTaskEventTypeSchema>;

export const AgentTaskEventSchema = z.object({
  id: z.string().min(1),
  type: AgentTaskEventTypeSchema,
  taskId: z.string().min(1),
  runId: z.string().min(1).optional(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AgentTaskEvent = z.infer<typeof AgentTaskEventSchema>;

export const CreateAgentTaskBodySchema = z.object({
  agentId: z.string().min(1),
  task: z.string().min(1),
  sessionContext: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type CreateAgentTaskBody = z.infer<typeof CreateAgentTaskBodySchema>;

export const CancelAgentTaskBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export type CancelAgentTaskBody = z.infer<typeof CancelAgentTaskBodySchema>;

export const AgentTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;
