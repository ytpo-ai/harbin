import { z } from 'zod';

export const RuntimeActorTypeSchema = z.enum(['employee', 'system', 'agent']);

export const RuntimeControlBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
  actorId: z.string().min(1).max(120).optional(),
  actorType: RuntimeActorTypeSchema.optional(),
});

export const RuntimeReplayBodySchema = z.object({
  eventTypes: z.array(z.string().min(1)).max(50).optional(),
  fromSequence: z.number().int().nonnegative().optional(),
  toSequence: z.number().int().nonnegative().optional(),
  channel: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

export const RuntimeDeadLetterQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  organizationId: z.string().min(1).max(120).optional(),
  runId: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
});

export const RuntimeDeadLetterRequeueBodySchema = z.object({
  eventIds: z.array(z.string().min(1).max(120)).min(1).max(500).optional(),
  organizationId: z.string().min(1).max(120).optional(),
  runId: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

export type RuntimeDeadLetterQuery = z.infer<typeof RuntimeDeadLetterQuerySchema>;
export type RuntimeDeadLetterRequeueBody = z.infer<typeof RuntimeDeadLetterRequeueBodySchema>;

export type RuntimeControlBody = z.infer<typeof RuntimeControlBodySchema>;
export type RuntimeReplayBody = z.infer<typeof RuntimeReplayBodySchema>;
