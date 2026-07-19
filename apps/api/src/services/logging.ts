import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { schema, uuidv7, type Tx } from '@gym/db';
import {
  epleyE1rm,
  foldOps,
  workingSets,
  setOpSchema,
  type PushBatch,
  type PushResult,
  type SetOp,
} from '@gym/sync';

/** DB rows → typed ops for the shared fold. */
export function rowsToOps(rows: (typeof schema.setLog.$inferSelect)[]): SetOp[] {
  return rows.map((o) =>
    setOpSchema.parse({
      opId: o.opId,
      sessionId: o.sessionId,
      kind: o.kind,
      amends: o.amends,
      exerciseId: o.exerciseId,
      programItemId: o.programItemId,
      setNo: o.setNo,
      payload: o.payload,
      deviceId: o.deviceId,
      clientSeq: o.clientSeq,
      clientTs: o.clientTs,
      hlc: o.hlc,
    }),
  );
}

export interface NewPr {
  exerciseId: string;
  exerciseName: string;
  kind: 'weight' | 'e1rm';
  value: number;
  previous: number | null;
}

/**
 * Apply a push batch. Idempotent end to end:
 *  - sessions upsert with per-row LWW on fieldsHlc (stale writes rejected, reported)
 *  - ops insert ON CONFLICT DO NOTHING (dupes are harmless)
 *  - PR detection runs for sessions that just completed
 */
export async function applyPushBatch(
  tx: Tx,
  opts: { gymId: string; memberId: string; actorUserId: string; batch: PushBatch },
): Promise<PushResult & { newPrs: NewPr[] }> {
  const { gymId, memberId, actorUserId, batch } = opts;
  const result: PushResult & { newPrs: NewPr[] } = {
    accepted: [],
    duplicate: [],
    sessionsApplied: [],
    sessionsStale: [],
    newPrs: [],
  };

  const completedNow: string[] = [];

  for (const s of batch.sessions) {
    const existingRows = await tx
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, s.id))
      .limit(1);
    const existing = existingRows[0];
    if (existing && existing.memberId !== memberId) {
      result.sessionsStale.push(s.id); // not yours — refuse silently, never leak
      continue;
    }
    if (!existing) {
      await tx.insert(schema.workoutSessions).values({
        id: s.id,
        gymId,
        memberId,
        assignmentId: s.assignmentId ?? null,
        programVersionId: s.programVersionId ?? null,
        programDayId: s.programDayId ?? null,
        title: s.title ?? null,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? null,
        feltRating: s.feltRating ?? null,
        notes: s.notes ?? null,
        deviceId: s.deviceId,
        actorUserId,
        fieldsHlc: s.fieldsHlc,
      });
      result.sessionsApplied.push(s.id);
      if (s.status === 'completed') completedNow.push(s.id);
      continue;
    }
    // LWW: apply only if the incoming stamp is newer
    if (!existing.fieldsHlc || s.fieldsHlc > existing.fieldsHlc) {
      await tx
        .update(schema.workoutSessions)
        .set({
          title: s.title ?? null,
          status: s.status,
          endedAt: s.endedAt ?? null,
          feltRating: s.feltRating ?? null,
          notes: s.notes ?? null,
          fieldsHlc: s.fieldsHlc,
        })
        .where(eq(schema.workoutSessions.id, s.id));
      result.sessionsApplied.push(s.id);
      if (s.status === 'completed' && existing.status !== 'completed') completedNow.push(s.id);
    } else {
      result.sessionsStale.push(s.id);
    }
  }

  // Ops may reference sessions from this batch or ones that already exist.
  const sessionIds = [...new Set(batch.ops.map((o) => o.sessionId))];
  const ownedSessions = sessionIds.length
    ? await tx
        .select({ id: schema.workoutSessions.id })
        .from(schema.workoutSessions)
        .where(and(inArray(schema.workoutSessions.id, sessionIds), eq(schema.workoutSessions.memberId, memberId)))
    : [];
  const owned = new Set(ownedSessions.map((s) => s.id));

  for (const op of batch.ops) {
    if (!owned.has(op.sessionId)) {
      result.duplicate.push(op.opId); // unknown/foreign session — do not store
      continue;
    }
    const inserted = await tx
      .insert(schema.setLog)
      .values({
        opId: op.opId,
        gymId,
        sessionId: op.sessionId,
        kind: op.kind,
        amends: op.amends ?? null,
        exerciseId: op.exerciseId ?? null,
        programItemId: op.programItemId ?? null,
        setNo: op.setNo ?? null,
        payload: op.payload,
        actorUserId,
        deviceId: op.deviceId,
        clientSeq: op.clientSeq,
        clientTs: op.clientTs,
        hlc: op.hlc,
      })
      // any conflict (op_id replay OR a device_seq collision from a client bug)
      // degrades to "duplicate" — a bad op must never fail the whole batch
      .onConflictDoNothing()
      .returning({ opId: schema.setLog.opId });
    if (inserted.length > 0) result.accepted.push(op.opId);
    else result.duplicate.push(op.opId);
  }

  for (const sessionId of completedNow) {
    result.newPrs.push(...(await detectPrs(tx, { gymId, memberId, sessionId })));
  }

  return result;
}

/** Weight + estimated-1RM PRs for a completed session (celebration moment, spec §4.8). */
export async function detectPrs(
  tx: Tx,
  opts: { gymId: string; memberId: string; sessionId: string },
): Promise<NewPr[]> {
  const ops = rowsToOps(
    await tx.select().from(schema.setLog).where(eq(schema.setLog.sessionId, opts.sessionId)),
  );
  const sets = workingSets(foldOps(ops));
  if (sets.length === 0) return [];

  const byExercise = new Map<string, typeof sets>();
  for (const s of sets) {
    if (!s.exerciseId) continue;
    const list = byExercise.get(s.exerciseId) ?? [];
    list.push(s);
    byExercise.set(s.exerciseId, list);
  }

  const newPrs: NewPr[] = [];
  for (const [exerciseId, exSets] of byExercise) {
    const bestWeightSet = exSets.reduce(
      (best, s) => ((s.payload.weightKg ?? 0) > (best?.payload.weightKg ?? 0) ? s : best),
      null as (typeof exSets)[number] | null,
    );
    const bestE1rmSet = exSets.reduce(
      (best, s) => {
        const e = epleyE1rm(s.payload.weightKg, s.payload.reps) ?? 0;
        const bestE = best ? epleyE1rm(best.payload.weightKg, best.payload.reps) ?? 0 : 0;
        return e > bestE ? s : best;
      },
      null as (typeof exSets)[number] | null,
    );

    const nameRows = await tx
      .select({ name: schema.exercises.name })
      .from(schema.exercises)
      .where(eq(schema.exercises.id, exerciseId))
      .limit(1);
    const exerciseName = nameRows[0]?.name ?? 'Exercise';

    const candidates: { kind: 'weight' | 'e1rm'; value: number; opId: string }[] = [];
    if (bestWeightSet?.payload.weightKg) {
      candidates.push({ kind: 'weight', value: bestWeightSet.payload.weightKg, opId: bestWeightSet.opId });
    }
    const e1rm = bestE1rmSet ? epleyE1rm(bestE1rmSet.payload.weightKg, bestE1rmSet.payload.reps) : null;
    if (e1rm && bestE1rmSet) candidates.push({ kind: 'e1rm', value: e1rm, opId: bestE1rmSet.opId });

    for (const c of candidates) {
      const prior = await tx
        .select({ v: sql<string>`max(value)` })
        .from(schema.personalRecords)
        .where(
          and(
            eq(schema.personalRecords.memberId, opts.memberId),
            eq(schema.personalRecords.exerciseId, exerciseId),
            eq(schema.personalRecords.kind, c.kind),
          ),
        );
      const priorVal = prior[0]?.v != null ? Number(prior[0].v) : null;
      if (priorVal == null || c.value > priorVal) {
        await tx.insert(schema.personalRecords).values({
          id: uuidv7(),
          gymId: opts.gymId,
          memberId: opts.memberId,
          exerciseId,
          kind: c.kind,
          value: String(c.value),
          setOpId: c.opId,
        });
        newPrs.push({ exerciseId, exerciseName, kind: c.kind, value: c.value, previous: priorVal });
      }
    }
  }
  return newPrs;
}

/** Consecutive-week streak from completed session dates (newest week may be in progress). */
export function computeStreakWeeks(dates: Date[], now = new Date()): { current: number; best: number } {
  if (dates.length === 0) return { current: 0, best: 0 };
  const weekKey = (d: Date) => {
    // ISO week bucketing
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return t.getUTCFullYear() * 100 + week;
  };
  const weeks = [...new Set(dates.map(weekKey))].sort((a, b) => a - b);
  const nowKey = weekKey(now);
  const prevKey = weekKey(new Date(now.getTime() - 7 * 86400000));

  let best = 1;
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    // consecutive if the numeric keys are adjacent (handles year wrap loosely via date math)
    const isConsecutive = weeks[i]! - weeks[i - 1]! === 1 || (weeks[i]! % 100 === 1 && weeks[i - 1]! % 100 >= 52);
    run = isConsecutive ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const latest = weeks[weeks.length - 1]!;
  const current = latest === nowKey || latest === prevKey ? run : 0;
  return { current, best };
}
