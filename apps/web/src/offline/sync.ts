/* Outbox drain: pushes pending sessions + ops in idempotent batches whenever
 * connectivity allows. Retries are free (server dedups by op id). */
import { ulid } from '@gym/sync';
import { api } from '../api';
import { db, getDeviceId } from './db';

let running = false;
let listeners: (() => void)[] = [];

export interface SyncStatus {
  pending: number;
  online: boolean;
  lastError: string | null;
}

let lastError: string | null = null;

export function onSyncChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}
const notify = () => listeners.forEach((f) => f());

export async function pendingCount(): Promise<number> {
  const [ops, sessions] = await Promise.all([db.outboxOps.count(), db.outboxSessions.count()]);
  return ops + sessions;
}

export async function syncStatus(): Promise<SyncStatus> {
  return { pending: await pendingCount(), online: navigator.onLine, lastError };
}

export interface SyncResult {
  pushedOps: number;
  newPrs: { exerciseName: string; kind: string; value: number; previous: number | null }[];
}

/** Drain everything currently pending. Safe to call anytime; no-ops offline. */
export async function syncNow(): Promise<SyncResult> {
  if (running || !navigator.onLine) return { pushedOps: 0, newPrs: [] };
  running = true;
  const result: SyncResult = { pushedOps: 0, newPrs: [] };
  try {
    const deviceId = await getDeviceId();
    for (;;) {
      const opIds = await db.outboxOps.limit(200).toArray();
      const sessionIds = await db.outboxSessions.limit(50).toArray();
      if (opIds.length === 0 && sessionIds.length === 0) break;

      const sessions = (
        await Promise.all(sessionIds.map((s) => db.sessions.get(s.id)))
      ).filter((s): s is NonNullable<typeof s> => s != null);
      const ops = (
        await Promise.all(opIds.map((o) => db.ops.get(o.opId)))
      ).filter((o): o is NonNullable<typeof o> => o != null);

      const res = await api.logging.push.mutate({
        batchId: ulid(),
        deviceId,
        sessions: sessions.map(({ gymId: _g, planDayName: _p, updatedAt: _u, ...s }) => s),
        ops: ops.map(({ gymId: _g, ...o }) => o),
      });

      const acked = [...res.accepted, ...res.duplicate];
      await db.transaction('rw', db.outboxOps, db.outboxSessions, async () => {
        await db.outboxOps.bulkDelete(acked);
        // stale sessions stay queued only if the server rejected them for ownership;
        // LWW-stale means the server already has newer — drop from outbox either way
        await db.outboxSessions.bulkDelete([...res.sessionsApplied, ...res.sessionsStale]);
      });
      result.pushedOps += res.accepted.length;
      result.newPrs.push(...res.newPrs);
      lastError = null;
      if (acked.length === 0 && res.sessionsApplied.length === 0 && res.sessionsStale.length === 0) break; // avoid a hot loop on a server that accepts nothing
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'sync failed';
  } finally {
    running = false;
    notify();
  }
  return result;
}

let installed = false;
/** Install background triggers: online, visibility, interval. */
export function installSyncTriggers(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => void syncNow(), 30_000);
  void syncNow();
}
