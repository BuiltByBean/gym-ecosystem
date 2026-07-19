import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { notifyUsers } from '../services/people.js';
import { computeSlots, findRedeemablePurchase, resolveRate } from '../services/scheduling.js';

const EXCLUSION_VIOLATION = '23P01';

export const schedulingRouter = router({
  sessionTypes: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('booking.read', { type: 'session_type' });
    return ctx.tenant((tx) =>
      tx.select().from(schema.sessionTypes).where(eq(schema.sessionTypes.gymId, ctx.gym.id)).orderBy(asc(schema.sessionTypes.name)),
    );
  }),

  sessionTypeSave: tenantProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        durationMin: z.number().int().min(15).max(240),
        capacity: z.number().int().min(1).max(50).default(1),
        requiresPackage: z.boolean().default(false),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('session_type.manage');
      const id = input.id ?? uuidv7();
      await ctx.tenant(async (tx) => {
        if (input.id) {
          const { id: _, ...patch } = input;
          await tx.update(schema.sessionTypes).set(patch).where(eq(schema.sessionTypes.id, input.id));
        } else {
          await tx.insert(schema.sessionTypes).values({ ...input, id, gymId: ctx.gym.id });
        }
      });
      return { id };
    }),

  myAvailability: tenantProcedure
    .input(z.object({ trainerUserId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const trainerUserId = input.trainerUserId ?? ctx.user.id;
      await ctx.allow('availability.read', { type: 'availability', trainerUserId });
      return ctx.tenant(async (tx) => ({
        templates: await tx
          .select()
          .from(schema.availabilityTemplates)
          .where(
            and(
              eq(schema.availabilityTemplates.gymId, ctx.gym.id),
              eq(schema.availabilityTemplates.trainerUserId, trainerUserId),
            ),
          )
          .orderBy(asc(schema.availabilityTemplates.weekday), asc(schema.availabilityTemplates.startMin)),
        exceptions: await tx
          .select()
          .from(schema.availabilityExceptions)
          .where(
            and(
              eq(schema.availabilityExceptions.gymId, ctx.gym.id),
              eq(schema.availabilityExceptions.trainerUserId, trainerUserId),
              gte(schema.availabilityExceptions.date, new Date().toISOString().slice(0, 10)),
            ),
          )
          .orderBy(asc(schema.availabilityExceptions.date)),
      }));
    }),

  /** Replace the weekly template wholesale (the editor sends all rows). */
  availabilitySetTemplate: tenantProcedure
    .input(
      z.object({
        trainerUserId: z.string().uuid().optional(),
        rows: z
          .array(
            z.object({
              weekday: z.number().int().min(0).max(6),
              startMin: z.number().int().min(0).max(1439),
              endMin: z.number().int().min(1).max(1440),
            }),
          )
          .max(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trainerUserId = input.trainerUserId ?? ctx.user.id;
      await ctx.allow('availability.manage', { type: 'availability', trainerUserId });
      for (const r of input.rows) {
        if (r.endMin <= r.startMin) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Window end must be after start' });
      }
      await ctx.tenant(async (tx) => {
        await tx
          .delete(schema.availabilityTemplates)
          .where(
            and(
              eq(schema.availabilityTemplates.gymId, ctx.gym.id),
              eq(schema.availabilityTemplates.trainerUserId, trainerUserId),
            ),
          );
        if (input.rows.length) {
          await tx.insert(schema.availabilityTemplates).values(
            input.rows.map((r) => ({ id: uuidv7(), gymId: ctx.gym.id, trainerUserId, ...r })),
          );
        }
      });
      return { ok: true };
    }),

  availabilityAddException: tenantProcedure
    .input(
      z.object({
        trainerUserId: z.string().uuid().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kind: z.enum(['open', 'blocked', 'time_off']),
        startMin: z.number().int().min(0).max(1439).nullish(),
        endMin: z.number().int().min(1).max(1440).nullish(),
        note: z.string().max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trainerUserId = input.trainerUserId ?? ctx.user.id;
      await ctx.allow('availability.manage', { type: 'availability', trainerUserId });
      const id = uuidv7();
      await ctx.tenant((tx) =>
        tx.insert(schema.availabilityExceptions).values({
          id,
          gymId: ctx.gym.id,
          trainerUserId,
          date: input.date,
          kind: input.kind,
          startMin: input.startMin ?? null,
          endMin: input.endMin ?? null,
          note: input.note ?? null,
        }),
      );
      return { id };
    }),

  trainers: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('availability.read');
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select({
          userId: schema.gymStaff.userId,
          displayName: schema.users.displayName,
        })
        .from(schema.gymStaff)
        .innerJoin(schema.users, eq(schema.users.id, schema.gymStaff.userId))
        .where(
          and(
            eq(schema.gymStaff.gymId, ctx.gym.id),
            eq(schema.gymStaff.role, 'trainer'),
            eq(schema.gymStaff.status, 'active'),
          ),
        );
      const profiles = await tx.select().from(schema.trainerProfiles).where(eq(schema.trainerProfiles.gymId, ctx.gym.id));
      return rows.map((r) => ({ ...r, profile: profiles.find((p) => p.userId === r.userId) ?? null }));
    });
  }),

  slots: tenantProcedure
    .input(
      z.object({
        trainerUserId: z.string().uuid(),
        sessionTypeId: z.string().uuid(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        days: z.number().int().min(1).max(14).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ctx.allow('availability.read');
      return ctx.tenant(async (tx) => {
        const stRows = await tx.select().from(schema.sessionTypes).where(eq(schema.sessionTypes.id, input.sessionTypeId)).limit(1);
        const st = stRows[0];
        if (!st) throw new TRPCError({ code: 'NOT_FOUND' });
        return computeSlots(tx, {
          gymId: ctx.gym.id,
          trainerUserId: input.trainerUserId,
          durationMin: st.durationMin,
          timeZone: ctx.gym.timezone,
          fromDate: input.fromDate,
          days: input.days,
        });
      });
    }),

  book: tenantProcedure
    .input(
      z.object({
        trainerUserId: z.string().uuid(),
        sessionTypeId: z.string().uuid(),
        startsAt: z.string().datetime(),
        memberId: z.string().uuid().optional(), // staff booking for a member
        notes: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No member for this booking' });
      const isSelf = memberId === ctx.actor.memberId;
      await ctx.allow('booking.create', {
        type: 'booking',
        memberId: isSelf ? memberId : undefined,
        trainerUserId: input.trainerUserId,
      });

      return ctx.tenant(async (tx) => {
        // the trainer must actually be active staff at THIS gym
        const trainerRows = await tx
          .select({ id: schema.gymStaff.id })
          .from(schema.gymStaff)
          .where(
            and(
              eq(schema.gymStaff.gymId, ctx.gym.id),
              eq(schema.gymStaff.userId, input.trainerUserId),
              eq(schema.gymStaff.role, 'trainer'),
              eq(schema.gymStaff.status, 'active'),
            ),
          )
          .limit(1);
        if (!trainerRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such trainer at this gym' });
        const stRows = await tx.select().from(schema.sessionTypes).where(eq(schema.sessionTypes.id, input.sessionTypeId)).limit(1);
        const st = stRows[0];
        if (!st || !st.active) throw new TRPCError({ code: 'NOT_FOUND' });
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(startsAt.getTime() + st.durationMin * 60_000);
        if (startsAt.getTime() < Date.now()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That time is in the past' });

        // Members self-book strictly inside published availability.
        if (isSelf && !ctx.actor.staffRoles.length) {
          const slots = await computeSlots(tx, {
            gymId: ctx.gym.id,
            trainerUserId: input.trainerUserId,
            durationMin: st.durationMin,
            timeZone: ctx.gym.timezone,
            fromDate: input.startsAt.slice(0, 10),
            days: 1,
          });
          if (!slots.some((s) => s.startsAt === startsAt.toISOString())) {
            throw new TRPCError({ code: 'CONFLICT', message: 'That slot is not available' });
          }
        }

        let packagePurchaseId: string | null = null;
        if (st.requiresPackage) {
          const redeemable = await findRedeemablePurchase(tx, { memberId, sessionTypeId: st.id });
          if (!redeemable) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No session package with remaining credits for this session type' });
          }
          packagePurchaseId = redeemable.purchaseId;
        }

        const rate = await resolveRate(tx, {
          gymId: ctx.gym.id,
          trainerUserId: input.trainerUserId,
          sessionTypeId: st.id,
          at: startsAt.toISOString(),
        });

        const id = uuidv7();
        try {
          await tx.insert(schema.bookings).values({
            id,
            gymId: ctx.gym.id,
            trainerUserId: input.trainerUserId,
            sessionTypeId: st.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            bookedBy: ctx.user.id,
            rateCardId: rate?.rateCardId ?? null,
            rateAppliedCents: rate?.amountCents ?? null,
            packagePurchaseId,
            notes: input.notes ?? null,
          });
        } catch (err) {
          if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
            throw new TRPCError({ code: 'CONFLICT', message: 'The trainer was just booked for that time' });
          }
          throw err;
        }
        await tx.insert(schema.bookingAttendees).values({ id: uuidv7(), gymId: ctx.gym.id, bookingId: id, memberId });
        await notifyUsers(tx, ctx.gym.id, [input.trainerUserId], {
          kind: 'booking_created',
          title: 'New session booked',
          data: { bookingId: id },
        });
        return { id, rateAppliedCents: rate?.amountCents ?? null };
      });
    }),

  list: tenantProcedure
    .input(
      z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        trainerUserId: z.string().uuid().optional(),
        memberId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const conds = [
          eq(schema.bookings.gymId, ctx.gym.id),
          gte(schema.bookings.startsAt, input.from),
          lte(schema.bookings.startsAt, input.to),
        ];
        const roles = ctx.actor.staffRoles;
        const isStaffWide = roles.some((r) => r === 'owner' || r === 'admin' || r === 'front_desk');
        if (isStaffWide) {
          await ctx.allow('booking.read', { type: 'booking' });
          if (input.trainerUserId) conds.push(eq(schema.bookings.trainerUserId, input.trainerUserId));
        } else if (roles.includes('trainer')) {
          await ctx.allow('booking.read', { type: 'booking', trainerUserId: ctx.user.id });
          conds.push(eq(schema.bookings.trainerUserId, ctx.user.id));
        } else {
          const memberId = ctx.actor.memberId;
          if (!memberId) return [];
          await ctx.allow('booking.read', { type: 'booking', memberId });
        }

        const rows = await tx
          .select({
            booking: schema.bookings,
            sessionTypeName: schema.sessionTypes.name,
            trainerName: schema.users.displayName,
          })
          .from(schema.bookings)
          .innerJoin(schema.sessionTypes, eq(schema.sessionTypes.id, schema.bookings.sessionTypeId))
          .innerJoin(schema.users, eq(schema.users.id, schema.bookings.trainerUserId))
          .where(and(...conds))
          .orderBy(asc(schema.bookings.startsAt))
          .limit(500);

        const bookingIds = rows.map((r) => r.booking.id);
        const attendees = bookingIds.length
          ? await tx
              .select({
                bookingId: schema.bookingAttendees.bookingId,
                memberId: schema.bookingAttendees.memberId,
                status: schema.bookingAttendees.status,
                firstName: schema.members.firstName,
                lastName: schema.members.lastName,
              })
              .from(schema.bookingAttendees)
              .innerJoin(schema.members, eq(schema.members.id, schema.bookingAttendees.memberId))
              .where(inArray(schema.bookingAttendees.bookingId, bookingIds))
          : [];

        let result = rows.map((r) => ({
          ...r.booking,
          sessionTypeName: r.sessionTypeName,
          trainerName: r.trainerName,
          attendees: attendees.filter((a) => a.bookingId === r.booking.id),
        }));
        // members see only their own bookings
        if (!isStaffWide && !roles.includes('trainer')) {
          result = result.filter((b) => b.attendees.some((a) => a.memberId === ctx.actor.memberId));
        }
        // front desk / trainers don't need frozen rates hidden — but members shouldn't see trainer rates? Members see the price they'd pay. Keep.
        return result;
      });
    }),

  cancel: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const rows = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId)).limit(1);
        const booking = rows[0];
        if (!booking || booking.status !== 'booked') throw new TRPCError({ code: 'NOT_FOUND' });
        const attendees = await tx
          .select()
          .from(schema.bookingAttendees)
          .where(eq(schema.bookingAttendees.bookingId, booking.id));
        const isOwnBooking = attendees.some((a) => a.memberId === ctx.actor.memberId);
        await ctx.allow('booking.cancel', {
          type: 'booking',
          memberId: isOwnBooking ? ctx.actor.memberId : undefined,
          trainerUserId: booking.trainerUserId,
        });

        const windowHours = ctx.gym.settings.cancellationWindowHours ?? 24;
        const isLate = new Date(booking.startsAt).getTime() - Date.now() < windowHours * 3600_000;
        const memberCancelling = isOwnBooking && !ctx.actor.staffRoles.length;
        const status = memberCancelling && isLate ? 'late_cancelled' : 'cancelled';

        await tx
          .update(schema.bookings)
          .set({ status, cancelledAt: new Date().toISOString() })
          .where(eq(schema.bookings.id, booking.id));

        if (status === 'late_cancelled') {
          const fee = ctx.gym.settings.lateCancelFeeCents ?? 0;
          for (const a of attendees) {
            await tx.insert(schema.policyIncidents).values({
              id: uuidv7(),
              gymId: ctx.gym.id,
              bookingId: booking.id,
              memberId: a.memberId,
              kind: 'late_cancel',
              feeCents: fee,
            });
          }
        }
        await notifyUsers(tx, ctx.gym.id, [booking.trainerUserId], {
          kind: 'booking_cancelled',
          title: `Session ${status === 'late_cancelled' ? 'late-' : ''}cancelled`,
          data: { bookingId: booking.id },
        });
        return { status };
      });
    }),

  /** Trainer/admin closes out a session; package credit redeems here. */
  complete: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid(), noShowMemberIds: z.array(z.string().uuid()).default([]) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const rows = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId)).limit(1);
        const booking = rows[0];
        if (!booking || booking.status !== 'booked') throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('booking.complete', { type: 'booking', trainerUserId: booking.trainerUserId });

        const attendees = await tx
          .select()
          .from(schema.bookingAttendees)
          .where(eq(schema.bookingAttendees.bookingId, booking.id));
        const noShows = new Set(input.noShowMemberIds);
        const anyAttended = attendees.some((a) => !noShows.has(a.memberId));

        await tx
          .update(schema.bookings)
          .set({ status: anyAttended ? 'completed' : 'no_show' })
          .where(eq(schema.bookings.id, booking.id));

        for (const a of attendees) {
          if (noShows.has(a.memberId)) {
            await tx
              .update(schema.bookingAttendees)
              .set({ status: 'no_show' })
              .where(eq(schema.bookingAttendees.id, a.id));
            await tx.insert(schema.policyIncidents).values({
              id: uuidv7(),
              gymId: ctx.gym.id,
              bookingId: booking.id,
              memberId: a.memberId,
              kind: 'no_show',
              feeCents: ctx.gym.settings.noShowFeeCents ?? 0,
            });
          }
        }

        // Redeem one package credit per attending member on the attached purchase.
        if (booking.packagePurchaseId && anyAttended) {
          const attending = attendees.filter((a) => !noShows.has(a.memberId));
          for (const a of attending) {
            await tx.insert(schema.packageLedger).values({
              id: uuidv7(),
              gymId: ctx.gym.id,
              purchaseId: booking.packagePurchaseId,
              memberId: a.memberId,
              delta: -1,
              kind: 'redemption',
              bookingId: booking.id,
              createdBy: ctx.user.id,
            });
          }
        }
        return { ok: true };
      });
    }),

  checkin: tenantProcedure
    .input(z.object({ memberId: z.string().uuid(), bookingId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const isSelf = input.memberId === ctx.actor.memberId;
      await ctx.allow('checkin.create', { type: 'checkin', memberId: isSelf ? input.memberId : undefined });
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.checkins).values({
          id: uuidv7(),
          gymId: ctx.gym.id,
          memberId: input.memberId,
          source: isSelf ? 'app' : 'front_desk',
          byUserId: ctx.user.id,
        });
        if (input.bookingId) {
          await tx
            .update(schema.bookingAttendees)
            .set({ status: 'checked_in', checkedInAt: new Date().toISOString() })
            .where(
              and(
                eq(schema.bookingAttendees.bookingId, input.bookingId),
                eq(schema.bookingAttendees.memberId, input.memberId),
              ),
            );
        }
      });
      return { ok: true };
    }),

  recentCheckins: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('checkin.create', { type: 'checkin' });
    return ctx.tenant((tx) =>
      tx
        .select({
          id: schema.checkins.id,
          memberId: schema.checkins.memberId,
          source: schema.checkins.source,
          createdAt: schema.checkins.createdAt,
          firstName: schema.members.firstName,
          lastName: schema.members.lastName,
        })
        .from(schema.checkins)
        .innerJoin(schema.members, eq(schema.members.id, schema.checkins.memberId))
        .where(eq(schema.checkins.gymId, ctx.gym.id))
        .orderBy(desc(schema.checkins.createdAt))
        .limit(30),
    );
  }),

  incidents: tenantProcedure
    .input(z.object({ status: z.enum(['posted', 'waived', 'collected']).optional() }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('incident.manage');
      return ctx.tenant(async (tx) => {
        const conds = [eq(schema.policyIncidents.gymId, ctx.gym.id)];
        if (input.status) conds.push(eq(schema.policyIncidents.status, input.status));
        return tx
          .select({
            incident: schema.policyIncidents,
            firstName: schema.members.firstName,
            lastName: schema.members.lastName,
            startsAt: schema.bookings.startsAt,
          })
          .from(schema.policyIncidents)
          .innerJoin(schema.members, eq(schema.members.id, schema.policyIncidents.memberId))
          .innerJoin(schema.bookings, eq(schema.bookings.id, schema.policyIncidents.bookingId))
          .where(and(...conds))
          .orderBy(desc(schema.policyIncidents.createdAt))
          .limit(100);
      });
    }),

  incidentResolve: tenantProcedure
    .input(z.object({ incidentId: z.string().uuid(), status: z.enum(['waived', 'collected']) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('incident.manage');
      await ctx.tenant((tx) =>
        tx
          .update(schema.policyIncidents)
          .set({ status: input.status, resolvedBy: ctx.user.id })
          .where(eq(schema.policyIncidents.id, input.incidentId)),
      );
      await ctx.audit('incident.resolve', 'policy_incident', input.incidentId, { status: input.status });
      return { ok: true };
    }),
});
