import { z } from 'zod';

export const RuntimeEventTypeSchema = z.enum([
  'run.started',
  'run.step.started',
  'llm.delta',
  'tool.pending',
  'tool.running',
  'tool.completed',
  'tool.failed',
  'run.compacted',
  'run.paused',
  'run.resumed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'permission.asked',
  'permission.replied',
  'permission.denied',
]);

export const RuntimeEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: RuntimeEventTypeSchema,
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  partId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  traceId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;
