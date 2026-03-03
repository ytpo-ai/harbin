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

export type RuntimeControlBody = z.infer<typeof RuntimeControlBodySchema>;
export type RuntimeReplayBody = z.infer<typeof RuntimeReplayBodySchema>;
