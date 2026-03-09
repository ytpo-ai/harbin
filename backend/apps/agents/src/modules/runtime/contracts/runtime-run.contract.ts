import { z } from 'zod';

export const RuntimeStartRunInputSchema = z.object({
  agentId: z.string().min(1),
  agentName: z.string().min(1),
  taskId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  taskTitle: z.string().min(1),
  taskDescription: z.string().default(''),
  userContent: z.string().default(''),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RuntimeToolEventInputSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  toolId: z.string().min(1),
  toolCallId: z.string().min(1),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RuntimeCompleteRunInputSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  assistantContent: z.string().default(''),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RuntimeFailRunInputSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  error: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RuntimeStartRunInput = z.infer<typeof RuntimeStartRunInputSchema>;
export type RuntimeToolEventInput = z.infer<typeof RuntimeToolEventInputSchema>;
export type RuntimeCompleteRunInput = z.infer<typeof RuntimeCompleteRunInputSchema>;
export type RuntimeFailRunInput = z.infer<typeof RuntimeFailRunInputSchema>;
