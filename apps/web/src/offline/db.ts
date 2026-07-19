/* Durable local store (IndexedDB via Dexie) — the offline half of the sync
 * design in docs/ARCHITECTURE.md §6. Set ops + outbox are never evicted. */
import Dexie, { type EntityTable } from 'dexie';
import type { SessionUpsert, SetOp } from '@gym/sync';

export interface LocalSession extends SessionUpsert {
  gymId: string;
  /** local bookkeeping */
  planDayName?: string | null;
  updatedAt: number;
}

export interface OutboxSetOp extends SetOp {
  gymId: string;
}

export interface OutboxState {
  id: string; // 'singleton'
  pendingOps: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface CachedPlan {
  assignmentId: string;
  gymId: string;
  fetchedAt: number;
  plan: unknown;
}

const db = new Dexie('gym-offline') as Dexie & {
  sessions: EntityTable<LocalSession, 'id'>;
  ops: EntityTable<OutboxSetOp, 'opId'>;          // append-only local op log
  outboxOps: EntityTable<{ opId: string }, 'opId'>; // ids not yet acked by the server
  outboxSessions: EntityTable<{ id: string }, 'id'>;
  plans: EntityTable<CachedPlan, 'assignmentId'>;
  meta: EntityTable<{ key: string; value: string }, 'key'>;
};

db.version(1).stores({
  sessions: 'id, gymId, status, updatedAt',
  ops: 'opId, sessionId, gymId, clientSeq',
  outboxOps: 'opId',
  outboxSessions: 'id',
  plans: 'assignmentId, gymId',
  meta: 'key',
});

export { db };

export async function getDeviceId(): Promise<string> {
  const existing = await db.meta.get('deviceId');
  if (existing) return existing.value;
  const id = `web-${crypto.randomUUID().slice(0, 18)}`;
  await db.meta.put({ key: 'deviceId', value: id });
  return id;
}

export async function nextClientSeq(): Promise<number> {
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get('clientSeq');
    const next = (row ? Number(row.value) : 0) + 1;
    await db.meta.put({ key: 'clientSeq', value: String(next) });
    return next;
  });
}
