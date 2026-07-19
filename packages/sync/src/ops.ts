import { z } from 'zod';

/** What actually happened in one set. All fields optional — a bodyweight AMRAP
 *  has reps only; a plank has timeS only. */
export const setPayloadSchema = z.object({
  weightKg: z.number().nonnegative().nullish(),
  reps: z.number().int().nonnegative().nullish(),
  rpe: z.number().min(1).max(10).nullish(),
  timeS: z.number().nonnegative().nullish(),
  isWarmup: z.boolean().optional(),
  note: z.string().max(2000).optional(),
  /** substitution ops: what was swapped */
  fromExerciseId: z.string().uuid().optional(),
  toExerciseId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});
export type SetPayload = z.infer<typeof setPayloadSchema>;

export const setOpSchema = z.object({
  opId: z.string().length(26),
  sessionId: z.string().uuid(),
  kind: z.enum(['set_logged', 'set_amended', 'set_voided', 'substitution']),
  amends: z.string().length(26).nullish(),
  exerciseId: z.string().uuid().nullish(),
  programItemId: z.string().uuid().nullish(),
  setNo: z.number().int().positive().nullish(),
  payload: setPayloadSchema.default({}),
  deviceId: z.string().min(8).max(64),
  clientSeq: z.number().int().nonnegative(),
  clientTs: z.string(),   // ISO
  hlc: z.string().min(18),
});
export type SetOp = z.infer<typeof setOpSchema>;

/** LWW session fields travel separately from the append-only op log. */
export const sessionUpsertSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid().nullish(),
  programVersionId: z.string().uuid().nullish(),
  programDayId: z.string().uuid().nullish(),
  title: z.string().max(200).nullish(),
  status: z.enum(['active', 'completed', 'discarded']),
  startedAt: z.string(),
  endedAt: z.string().nullish(),
  feltRating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().max(5000).nullish(),
  deviceId: z.string().min(8).max(64),
  fieldsHlc: z.string().min(18),
});
export type SessionUpsert = z.infer<typeof sessionUpsertSchema>;

export const pushBatchSchema = z.object({
  batchId: z.string().length(26),
  deviceId: z.string().min(8).max(64),
  sessions: z.array(sessionUpsertSchema).max(50),
  ops: z.array(setOpSchema).max(500),
});
export type PushBatch = z.infer<typeof pushBatchSchema>;

export interface PushResult {
  accepted: string[];   // opIds now durable server-side
  duplicate: string[];  // already had them (harmless retry)
  sessionsApplied: string[];
  sessionsStale: string[]; // LWW rejected: server copy newer
}
