import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, uuidv7, type DbBundle } from '@gym/db';

export const SESSION_COOKIE = 'gym_session';
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionRecord {
  id: string;
  userId: string;
  activeGymId: string | null;
}

/** Sessions/users are global (documented RLS exceptions) — plain queries are fine. */
export async function createSession(
  bundle: DbBundle,
  userId: string,
  meta: { ip?: string; userAgent?: string; activeGymId?: string | null },
): Promise<{ token: string; session: SessionRecord }> {
  const token = randomBytes(32).toString('base64url');
  const id = uuidv7();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await bundle.db.insert(schema.sessions).values({
    id,
    userId,
    tokenHash: hashToken(token),
    activeGymId: meta.activeGymId ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
    expiresAt,
  });
  return { token, session: { id, userId, activeGymId: meta.activeGymId ?? null } };
}

export async function lookupSession(bundle: DbBundle, token: string): Promise<SessionRecord | null> {
  if (!token) return null;
  const rows = await bundle.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  const s = rows[0];
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) {
    await bundle.db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
    return null;
  }
  // Rolling touch, throttled to once a minute to avoid a write per request.
  if (Date.now() - new Date(s.lastSeenAt).getTime() > 60_000) {
    await bundle.db
      .update(schema.sessions)
      .set({ lastSeenAt: sql`now()`, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() })
      .where(eq(schema.sessions.id, s.id));
  }
  return { id: s.id, userId: s.userId, activeGymId: s.activeGymId };
}

export async function revokeSession(bundle: DbBundle, sessionId: string): Promise<void> {
  await bundle.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function setActiveGym(bundle: DbBundle, sessionId: string, gymId: string | null): Promise<void> {
  await bundle.db.update(schema.sessions).set({ activeGymId: gymId }).where(eq(schema.sessions.id, sessionId));
}
