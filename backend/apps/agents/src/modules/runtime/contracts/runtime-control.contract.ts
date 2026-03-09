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
}).refine((value) => {
  if (typeof value.fromSequence !== 'number' || typeof value.toSequence !== 'number') {
    return true;
  }
  return value.fromSequence <= value.toSequence;
}, {
  message: 'fromSequence must be less than or equal to toSequence',
  path: ['toSequence'],
});

export const RuntimeDeadLetterQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  runId: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
});

export const RuntimeDeadLetterRequeueBodySchema = z.object({
  eventIds: z.array(z.string().min(1).max(120)).min(1).max(500).optional(),
  runId: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  dryRun: z.boolean().optional(),
});

export const RuntimePurgeLegacyBodySchema = z.object({
  confirm: z.literal('DELETE_LEGACY_RUNTIME_DATA'),
  collections: z.array(z.string().min(1).max(120)).max(20).optional(),
  dryRun: z.boolean().optional(),
});

export const RuntimeMaintenanceAuditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  action: z.enum(['dead_letter_requeue', 'purge_legacy']).optional(),
  batchId: z.string().min(1).max(120).optional(),
});

export type RuntimeDeadLetterQuery = z.infer<typeof RuntimeDeadLetterQuerySchema>;
export type RuntimeDeadLetterRequeueBody = z.infer<typeof RuntimeDeadLetterRequeueBodySchema>;
export type RuntimePurgeLegacyBody = z.infer<typeof RuntimePurgeLegacyBodySchema>;
export type RuntimeMaintenanceAuditQuery = z.infer<typeof RuntimeMaintenanceAuditQuerySchema>;

export type RuntimeControlBody = z.infer<typeof RuntimeControlBodySchema>;
export type RuntimeReplayBody = z.infer<typeof RuntimeReplayBodySchema>;
