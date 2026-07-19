import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { authedProcedure, publicProcedure, router } from '../trpc.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { SESSION_COOKIE, createSession, revokeSession, setActiveGym } from '../auth/sessions.js';

const SESSION_MAX_AGE_S = 30 * 86400;

export const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { user: null, gym: null, roles: [], memberId: null, gyms: [] };

    const userId = ctx.user.id;
    const gyms = await ctx.bundle.withTenant({ gymId: null, userId }, async (tx) => {
      const staffRows = await tx
        .select({ gymId: schema.gymStaff.gymId, role: schema.gymStaff.role })
        .from(schema.gymStaff)
        .where(and(eq(schema.gymStaff.userId, userId), eq(schema.gymStaff.status, 'active')));
      const memberRows = await tx
        .select({ gymId: schema.members.gymId })
        .from(schema.members)
        .where(and(eq(schema.members.userId, userId), isNull(schema.members.archivedAt)));
      const ids = [...new Set([...staffRows.map((r) => r.gymId), ...memberRows.map((r) => r.gymId)])];
      if (ids.length === 0) return [];
      const gymRows = await tx
        .select({
          id: schema.gyms.id,
          name: schema.gyms.name,
          slug: schema.gyms.slug,
          brandPrimary: schema.gyms.brandPrimary,
        })
        .from(schema.gyms)
        .where(inArray(schema.gyms.id, ids));
      return gymRows.map((g) => ({
        ...g,
        roles: staffRows.filter((s) => s.gymId === g.id).map((s) => s.role),
        isMember: memberRows.some((m) => m.gymId === g.id),
      }));
    });

    return {
      user: ctx.user,
      gym: ctx.gym,
      roles: ctx.actor?.staffRoles ?? [],
      memberId: ctx.actor?.memberId ?? null,
      gyms,
    };
  }),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.bundle.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, input.email.toLowerCase()))
        .limit(1);
      const user = rows[0];
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      // Default the session to the user's only gym when unambiguous.
      const memberships = await ctx.bundle.withTenant({ gymId: null, userId: user.id }, async (tx) => {
        const staff = await tx
          .select({ gymId: schema.gymStaff.gymId })
          .from(schema.gymStaff)
          .where(and(eq(schema.gymStaff.userId, user.id), eq(schema.gymStaff.status, 'active')));
        const mem = await tx
          .select({ gymId: schema.members.gymId })
          .from(schema.members)
          .where(and(eq(schema.members.userId, user.id), isNull(schema.members.archivedAt)));
        return [...new Set([...staff.map((s) => s.gymId), ...mem.map((m) => m.gymId)])];
      });
      const activeGymId = memberships.length >= 1 ? memberships[0]! : null;

      const { token } = await createSession(ctx.bundle, user.id, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        activeGymId,
      });
      ctx.setCookie(SESSION_COOKIE, token, SESSION_MAX_AGE_S);
      return { ok: true };
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    await revokeSession(ctx.bundle, ctx.session.id);
    ctx.clearCookie(SESSION_COOKIE);
    return { ok: true };
  }),

  switchGym: authedProcedure
    .input(z.object({ gymId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const allowed = await ctx.bundle.withTenant({ gymId: null, userId }, async (tx) => {
        const staff = await tx
          .select({ id: schema.gymStaff.id })
          .from(schema.gymStaff)
          .where(
            and(
              eq(schema.gymStaff.userId, userId),
              eq(schema.gymStaff.gymId, input.gymId),
              eq(schema.gymStaff.status, 'active'),
            ),
          )
          .limit(1);
        if (staff.length > 0) return true;
        const mem = await tx
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.userId, userId),
              eq(schema.members.gymId, input.gymId),
              isNull(schema.members.archivedAt),
            ),
          )
          .limit(1);
        return mem.length > 0;
      });
      if (!allowed) throw new TRPCError({ code: 'NOT_FOUND' });
      await setActiveGym(ctx.bundle, ctx.session.id, input.gymId);
      return { ok: true };
    }),

  /** Invite acceptance: the token is the capability. Creates/links the user,
   *  attaches the role or member profile, opens a session. */
  acceptInvite: publicProcedure
    .input(
      z.object({
        token: z.string().min(20),
        password: z.string().min(10).max(200).optional(),
        displayName: z.string().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenHash = createHash('sha256').update(input.token).digest('hex');
      const inviteRows = await ctx.bundle.db
        .select()
        .from(schema.invites)
        .where(eq(schema.invites.tokenHash, tokenHash))
        .limit(1);
      const invite = inviteRows[0];
      if (!invite || invite.acceptedAt || new Date(invite.expiresAt).getTime() < Date.now()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite is invalid or expired' });
      }

      const email = invite.email.toLowerCase();
      const existing = await ctx.bundle.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      let userId = existing[0]?.id;
      if (!userId) {
        if (!input.password) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password required to create your account' });
        }
        userId = uuidv7();
        await ctx.bundle.db.insert(schema.users).values({
          id: userId,
          email,
          passwordHash: await hashPassword(input.password),
          displayName: input.displayName?.trim() || email.split('@')[0]!,
        });
      }

      await ctx.bundle.withTenant({ gymId: invite.gymId, userId }, async (tx) => {
        if (invite.kind === 'staff') {
          const role = (invite.role ?? 'trainer') as schema.StaffRole;
          await tx
            .insert(schema.gymStaff)
            .values({ id: uuidv7(), gymId: invite.gymId, userId: userId!, role })
            .onConflictDoNothing();
          if (role === 'trainer') {
            await tx
              .insert(schema.trainerProfiles)
              .values({ id: uuidv7(), gymId: invite.gymId, userId: userId! })
              .onConflictDoNothing();
          }
        } else if (invite.memberId) {
          await tx
            .update(schema.members)
            .set({ userId })
            .where(and(eq(schema.members.id, invite.memberId), isNull(schema.members.userId)));
        } else {
          await tx.insert(schema.members).values({
            id: uuidv7(),
            gymId: invite.gymId,
            userId,
            firstName: input.displayName?.split(' ')[0] ?? email.split('@')[0]!,
            lastName: input.displayName?.split(' ').slice(1).join(' ') || '—',
            email,
          });
        }
      });

      await ctx.bundle.db
        .update(schema.invites)
        .set({ acceptedAt: new Date().toISOString() })
        .where(eq(schema.invites.id, invite.id));

      const { token } = await createSession(ctx.bundle, userId, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        activeGymId: invite.gymId,
      });
      ctx.setCookie(SESSION_COOKIE, token, SESSION_MAX_AGE_S);
      return { ok: true };
    }),
});
