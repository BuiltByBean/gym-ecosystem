/* Local workout controller: every write lands in IndexedDB BEFORE the UI
 * confirms; the sync engine drains the outbox opportunistically. Fully usable
 * with no connection — that is the whole point (spec §4.7). */
import { createHlcClock, foldOps, ulid, type SetOp, type SetPayload } from '@gym/sync';
import { db, getDeviceId, nextClientSeq, type LocalSession } from './db';

let clockPromise: Promise<{ deviceId: string; clock: ReturnType<typeof createHlcClock> }> | null = null;
async function deviceClock() {
  clockPromise ??= getDeviceId().then((deviceId) => ({ deviceId, clock: createHlcClock(deviceId) }));
  return clockPromise;
}

export async function startSession(opts: {
  gymId: string;
  assignmentId?: string | null;
  programVersionId?: string | null;
  programDayId?: string | null;
  title?: string | null;
  planDayName?: string | null;
}): Promise<LocalSession> {
  const { deviceId, clock } = await deviceClock();
  const session: LocalSession = {
    id: crypto.randomUUID(),
    gymId: opts.gymId,
    assignmentId: opts.assignmentId ?? null,
    programVersionId: opts.programVersionId ?? null,
    programDayId: opts.programDayId ?? null,
    title: opts.title ?? null,
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    feltRating: null,
    notes: null,
    deviceId,
    fieldsHlc: clock.tick(),
    planDayName: opts.planDayName ?? null,
    updatedAt: Date.now(),
  };
  await db.transaction('rw', db.sessions, db.outboxSessions, async () => {
    await db.sessions.put(session);
    await db.outboxSessions.put({ id: session.id });
  });
  return session;
}

export async function activeSession(gymId: string): Promise<LocalSession | undefined> {
  const all = await db.sessions.where('gymId').equals(gymId).and((s) => s.status === 'active').toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function updateSessionFields(
  sessionId: string,
  patch: Partial<Pick<LocalSession, 'status' | 'endedAt' | 'feltRating' | 'notes' | 'title'>>,
): Promise<void> {
  const { clock } = await deviceClock();
  await db.transaction('rw', db.sessions, db.outboxSessions, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) return;
    Object.assign(s, patch, { fieldsHlc: clock.tick(), updatedAt: Date.now() });
    await db.sessions.put(s);
    await db.outboxSessions.put({ id: sessionId });
  });
}

async function appendOp(
  op: Omit<SetOp, 'opId' | 'deviceId' | 'clientSeq' | 'clientTs' | 'hlc'>,
  gymId: string,
): Promise<SetOp> {
  const { deviceId, clock } = await deviceClock();
  const full: SetOp = {
    ...op,
    opId: ulid(),
    deviceId,
    clientSeq: await nextClientSeq(),
    clientTs: new Date().toISOString(),
    hlc: clock.tick(),
  };
  // durable BEFORE the UI shows the set as logged
  await db.transaction('rw', db.ops, db.outboxOps, async () => {
    await db.ops.put({ ...full, gymId });
    await db.outboxOps.put({ opId: full.opId });
  });
  return full;
}

export function logSet(opts: {
  gymId: string;
  sessionId: string;
  exerciseId: string;
  programItemId?: string | null;
  setNo: number;
  payload: SetPayload;
}): Promise<SetOp> {
  return appendOp(
    {
      sessionId: opts.sessionId,
      kind: 'set_logged',
      amends: null,
      exerciseId: opts.exerciseId,
      programItemId: opts.programItemId ?? null,
      setNo: opts.setNo,
      payload: opts.payload,
    },
    opts.gymId,
  );
}

export function amendSet(opts: { gymId: string; sessionId: string; amends: string; payload: SetPayload }): Promise<SetOp> {
  return appendOp(
    { sessionId: opts.sessionId, kind: 'set_amended', amends: opts.amends, exerciseId: null, programItemId: null, setNo: null, payload: opts.payload },
    opts.gymId,
  );
}

export function voidSet(opts: { gymId: string; sessionId: string; amends: string }): Promise<SetOp> {
  return appendOp(
    { sessionId: opts.sessionId, kind: 'set_voided', amends: opts.amends, exerciseId: null, programItemId: null, setNo: null, payload: {} },
    opts.gymId,
  );
}

export function logSubstitution(opts: {
  gymId: string;
  sessionId: string;
  fromExerciseId: string;
  toExerciseId: string;
  reason?: string;
}): Promise<SetOp> {
  return appendOp(
    {
      sessionId: opts.sessionId,
      kind: 'substitution',
      amends: null,
      exerciseId: opts.toExerciseId,
      programItemId: null,
      setNo: null,
      payload: { fromExerciseId: opts.fromExerciseId, toExerciseId: opts.toExerciseId, reason: opts.reason },
    },
    opts.gymId,
  );
}

/** Folded current view of a local session — same fold the server runs. */
export async function foldSession(sessionId: string) {
  const ops = await db.ops.where('sessionId').equals(sessionId).toArray();
  return foldOps(ops);
}
