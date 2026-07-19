import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { createInvite } from '../services/people.js';

export const gymRouter = router({
  get: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('gym.read');
    return ctx.tenant(async (tx) => {
      const locations = await tx
        .select()
        .from(schema.gymLocations)
        .where(eq(schema.gymLocations.gymId, ctx.gym.id));
      return { ...ctx.gym, locations };
    });
  }),

  update: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120).optional(),
        timezone: z.string().max(64).optional(),
        units: z.enum(['lb', 'kg']).optional(),
        brandPrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        settings: z
          .object({
            adminFinancials: z.boolean().optional(),
            cancellationWindowHours: z.number().int().min(0).max(168).optional(),
            lateCancelFeeCents: z.number().int().min(0).optional(),
            noShowFeeCents: z.number().int().min(0).optional(),
            minorAge: z.number().int().min(13).max(21).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('gym.update');
      await ctx.tenant(async (tx) => {
        const { settings, ...rest } = input;
        await tx
          .update(schema.gyms)
          .set({
            ...rest,
            ...(settings ? { settings: { ...ctx.gym.settings, ...settings } } : {}),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.gyms.id, ctx.gym.id));
      });
      await ctx.audit('gym.update', 'gym', ctx.gym.id, { fields: Object.keys(input) });
      return { ok: true };
    }),

  staffList: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('staff.list');
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select({
          id: schema.gymStaff.id,
          userId: schema.gymStaff.userId,
          role: schema.gymStaff.role,
          employmentType: schema.gymStaff.employmentType,
          status: schema.gymStaff.status,
          displayName: schema.users.displayName,
          email: schema.users.email,
        })
        .from(schema.gymStaff)
        .innerJoin(schema.users, eq(schema.users.id, schema.gymStaff.userId))
        .where(eq(schema.gymStaff.gymId, ctx.gym.id));
      const profiles = await tx
        .select()
        .from(schema.trainerProfiles)
        .where(eq(schema.trainerProfiles.gymId, ctx.gym.id));
      return rows.map((r) => ({
        ...r,
        profile: r.role === 'trainer' ? profiles.find((p) => p.userId === r.userId) ?? null : null,
      }));
    });
  }),

  staffInvite: tenantProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(['owner', 'admin', 'front_desk', 'trainer']),
        employmentType: z.enum(['employee', 'contractor']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('staff.invite');
      const result = await ctx.tenant((tx) =>
        createInvite(tx, {
          gymId: ctx.gym.id,
          email: input.email,
          kind: 'staff',
          role: input.role,
          invitedBy: ctx.user.id,
        }),
      );
      await ctx.audit('staff.invite', 'invite', result.inviteId, { email: input.email, role: input.role });
      return result;
    }),

  staffSetStatus: tenantProcedure
    .input(z.object({ staffId: z.string().uuid(), status: z.enum(['active', 'inactive']) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('staff.update');
      await ctx.tenant(async (tx) => {
        const rows = await tx
          .update(schema.gymStaff)
          .set({ status: input.status })
          .where(and(eq(schema.gymStaff.id, input.staffId), eq(schema.gymStaff.gymId, ctx.gym.id)))
          .returning({ id: schema.gymStaff.id });
        if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      });
      await ctx.audit('staff.update', 'gym_staff', input.staffId, { status: input.status });
      return { ok: true };
    }),

  trainerProfileUpdate: tenantProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        bio: z.string().max(2000).nullish(),
        specialties: z.array(z.string().max(60)).max(20).optional(),
        languages: z.array(z.string().max(40)).max(10).optional(),
        targetClientLoad: z.number().int().min(0).max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('trainer_profile.update', { type: 'trainer_profile', ownerUserId: input.userId });
      await ctx.tenant(async (tx) => {
        const { userId, ...patch } = input;
        await tx
          .insert(schema.trainerProfiles)
          .values({ id: uuidv7(), gymId: ctx.gym.id, userId, ...patch })
          .onConflictDoNothing();
        await tx
          .update(schema.trainerProfiles)
          .set(patch)
          .where(and(eq(schema.trainerProfiles.gymId, ctx.gym.id), eq(schema.trainerProfiles.userId, userId)));
      });
      return { ok: true };
    }),

  zones: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('equipment.read');
    return ctx.tenant((tx) => tx.select().from(schema.gymZones).where(eq(schema.gymZones.gymId, ctx.gym.id)));
  }),

  zoneCreate: tenantProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.manage');
      const id = uuidv7();
      await ctx.tenant((tx) => tx.insert(schema.gymZones).values({ id, gymId: ctx.gym.id, name: input.name }));
      return { id };
    }),

  notifications: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('notification.read');
    return ctx.tenant(async (tx) => {
      return tx
        .select()
        .from(schema.notifications)
        .where(and(eq(schema.notifications.gymId, ctx.gym.id), eq(schema.notifications.userId, ctx.user.id)))
        .orderBy(desc(schema.notifications.createdAt))
        .limit(50);
    });
  }),

  notificationsMarkRead: tenantProcedure.mutation(async ({ ctx }) => {
    await ctx.allow('notification.read');
    await ctx.tenant(async (tx) => {
      await tx
        .update(schema.notifications)
        .set({ readAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.notifications.gymId, ctx.gym.id),
            eq(schema.notifications.userId, ctx.user.id),
            isNull(schema.notifications.readAt),
          ),
        );
    });
    return { ok: true };
  }),

  auditLog: tenantProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('audit.read');
      return ctx.tenant(async (tx) => {
        const rows = await tx
          .select({
            id: schema.auditEvents.id,
            action: schema.auditEvents.action,
            resourceType: schema.auditEvents.resourceType,
            resourceId: schema.auditEvents.resourceId,
            metadata: schema.auditEvents.metadata,
            createdAt: schema.auditEvents.createdAt,
            actorName: schema.users.displayName,
          })
          .from(schema.auditEvents)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorUserId))
          .where(eq(schema.auditEvents.gymId, ctx.gym.id))
          .orderBy(desc(schema.auditEvents.createdAt))
          .limit(input.limit);
        return rows;
      });
    }),
});
