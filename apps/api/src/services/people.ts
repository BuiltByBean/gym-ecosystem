import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { env, schema, uuidv7, type Tx } from '@gym/db';
import type { Resource } from '@gym/authz';

/** Load the facts authorize() needs for member-scoped decisions. */
export async function memberFacts(
  tx: Tx,
  memberId: string,
): Promise<{ member: typeof schema.members.$inferSelect | null; resource: Resource }> {
  const rows = await tx.select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1);
  const member = rows[0] ?? null;
  if (!member) return { member: null, resource: { type: 'member', memberId } };

  const assigned = await tx
    .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
    .from(schema.trainerAssignments)
    .where(and(eq(schema.trainerAssignments.memberId, memberId), isNull(schema.trainerAssignments.endedAt)));
  const grants = await tx
    .select({ trainerUserId: schema.memberTrainerGrants.trainerUserId, scope: schema.memberTrainerGrants.scope })
    .from(schema.memberTrainerGrants)
    .where(and(eq(schema.memberTrainerGrants.memberId, memberId), isNull(schema.memberTrainerGrants.revokedAt)));

  return {
    member,
    resource: {
      type: 'member',
      memberId,
      assignedTrainerUserIds: assigned.map((a) => a.trainerUserId),
      grantedUserIds: grants.filter((g) => g.scope === 'health').map((g) => g.trainerUserId),
    },
  };
}

/** Members list scope for a pure trainer: only their assigned clients. */
export async function assignedMemberIds(tx: Tx, trainerUserId: string): Promise<string[]> {
  const rows = await tx
    .select({ memberId: schema.trainerAssignments.memberId })
    .from(schema.trainerAssignments)
    .where(and(eq(schema.trainerAssignments.trainerUserId, trainerUserId), isNull(schema.trainerAssignments.endedAt)));
  return rows.map((r) => r.memberId);
}

export interface InviteResult {
  inviteId: string;
  inviteUrl: string;
}

export async function createInvite(
  tx: Tx,
  opts: {
    gymId: string;
    email: string;
    kind: 'staff' | 'member';
    role?: schema.StaffRole;
    memberId?: string;
    invitedBy: string;
  },
): Promise<InviteResult> {
  const token = randomBytes(24).toString('base64url');
  const id = uuidv7();
  await tx.insert(schema.invites).values({
    id,
    gymId: opts.gymId,
    email: opts.email.toLowerCase(),
    kind: opts.kind,
    role: opts.role ?? null,
    memberId: opts.memberId ?? null,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    invitedBy: opts.invitedBy,
    expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
  });
  // Dev email adapter == console + copyable link in the UI.
  const inviteUrl = `${env.WEB_ORIGIN}/invite/${token}`;
  console.log(`[invite] ${opts.kind} invite for ${opts.email}: ${inviteUrl}`);
  return { inviteId: id, inviteUrl };
}

export async function notifyUsers(
  tx: Tx,
  gymId: string,
  userIds: string[],
  notif: { kind: string; title: string; body?: string; data?: Record<string, unknown> },
): Promise<void> {
  if (userIds.length === 0) return;
  await tx.insert(schema.notifications).values(
    userIds.map((userId) => ({
      id: uuidv7(),
      gymId,
      userId,
      kind: notif.kind,
      title: notif.title,
      body: notif.body ?? null,
      data: notif.data ?? {},
    })),
  );
}

/** Field projection for front-desk viewers: contact info only, never notes/health/DOB. */
export function frontDeskMemberView<T extends Record<string, unknown>>(m: T): Partial<T> {
  const { goalsNote: _g, dateOfBirth: _d, preferredTimes: _p, ...rest } = m as Record<string, unknown>;
  return rest as Partial<T>;
}
