import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { epleyE1rm, foldOps, pushBatchSchema, workingSets } from '@gym/sync';
import { router, tenantProcedure } from '../trpc.js';
import { applyPushBatch, computeStreakWeeks, rowsToOps } from '../services/logging.js';
import { memberFacts } from '../services/people.js';

async function workoutFacts(tx: Parameters<typeof memberFacts>[0], memberId: string) {
  const { member, resource } = await memberFacts(tx, memberId);
  if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
  return { member, resource: { ...resource, type: 'workout' } };
}

export const loggingRouter = router({
  /** Offline sync push: the entire batch is idempotent; retries are free. */
  push: tenantProcedure.input(pushBatchSchema).mutation(async ({ ctx, input }) => {
    const memberId = ctx.actor.memberId;
    if (!memberId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members log workouts (trainer-on-behalf lands later)' });
    await ctx.allow('workout.log', { type: 'workout', memberId });
    return ctx.tenant((tx) =>
      applyPushBatch(tx, { gymId: ctx.gym.id, memberId, actorUserId: ctx.user.id, batch: input }),
    );
  }),

  history: tenantProcedure
    .input(z.object({ memberId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return [];
      return ctx.tenant(async (tx) => {
        const { resource } = await workoutFacts(tx, memberId);
        await ctx.allow('workout.read', resource, { notFound: true });
        const sessions = await tx
          .select()
          .from(schema.workoutSessions)
          .where(and(eq(schema.workoutSessions.memberId, memberId), eq(schema.workoutSessions.status, 'completed')))
          .orderBy(desc(schema.workoutSessions.startedAt))
          .limit(input.limit);
        if (sessions.length === 0) return [];
        const ops = await tx
          .select()
          .from(schema.setLog)
          .where(inArray(schema.setLog.sessionId, sessions.map((s) => s.id)));
        const parsed = rowsToOps(ops);
        return sessions.map((s) => {
          const sets = workingSets(foldOps(parsed.filter((o) => o.sessionId === s.id)));
          const volume = sets.reduce((sum, x) => sum + (x.payload.weightKg ?? 0) * (x.payload.reps ?? 0), 0);
          return {
            id: s.id,
            title: s.title,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            feltRating: s.feltRating,
            programDayId: s.programDayId,
            setCount: sets.length,
            volumeKg: Math.round(volume),
            exerciseCount: new Set(sets.map((x) => x.exerciseId)).size,
          };
        });
      });
    }),

  sessionDetail: tenantProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.workoutSessions)
          .where(eq(schema.workoutSessions.id, input.sessionId))
          .limit(1);
        const session = rows[0];
        if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
        const { resource } = await workoutFacts(tx, session.memberId);
        await ctx.allow('workout.read', resource, { notFound: true });

        const ops = rowsToOps(
          await tx.select().from(schema.setLog).where(eq(schema.setLog.sessionId, session.id)),
        );
        const folded = foldOps(ops);
        const exerciseIds = [
          ...new Set([
            ...folded.sets.map((s) => s.exerciseId),
            ...folded.substitutions.flatMap((s) => [s.fromExerciseId, s.toExerciseId]),
          ].filter((x): x is string => x != null)),
        ];
        const exercises = exerciseIds.length
          ? await tx
              .select({ id: schema.exercises.id, name: schema.exercises.name })
              .from(schema.exercises)
              .where(inArray(schema.exercises.id, exerciseIds))
          : [];
        return { session, ...folded, exercises };
      });
    }),

  /** Trainer view: a client's recent activity. */
  clientOverview: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { resource } = await workoutFacts(tx, input.memberId);
        await ctx.allow('workout.read', resource, { notFound: true });
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const sessions = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.workoutSessions)
          .where(
            and(
              eq(schema.workoutSessions.memberId, input.memberId),
              eq(schema.workoutSessions.status, 'completed'),
              gte(schema.workoutSessions.startedAt, since),
            ),
          );
        const prs = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.personalRecords)
          .where(and(eq(schema.personalRecords.memberId, input.memberId), gte(schema.personalRecords.achievedAt, since)));
        return { sessions30d: sessions[0]?.n ?? 0, prs30d: prs[0]?.n ?? 0 };
      });
    }),

  /** e1RM + top-set series for one exercise (member progress charts). */
  exerciseTrend: tenantProcedure
    .input(z.object({ exerciseId: z.string().uuid(), memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return [];
      return ctx.tenant(async (tx) => {
        const { resource } = await workoutFacts(tx, memberId);
        await ctx.allow('progress.read', resource, { notFound: true });
        const since = new Date(Date.now() - 180 * 86400000).toISOString();
        const sessions = await tx
          .select({ id: schema.workoutSessions.id, startedAt: schema.workoutSessions.startedAt })
          .from(schema.workoutSessions)
          .where(
            and(
              eq(schema.workoutSessions.memberId, memberId),
              eq(schema.workoutSessions.status, 'completed'),
              gte(schema.workoutSessions.startedAt, since),
            ),
          )
          .orderBy(schema.workoutSessions.startedAt);
        if (sessions.length === 0) return [];
        const ops = rowsToOps(
          await tx
            .select()
            .from(schema.setLog)
            .where(
              and(
                inArray(schema.setLog.sessionId, sessions.map((s) => s.id)),
                eq(schema.setLog.exerciseId, input.exerciseId),
              ),
            ),
        );
        return sessions
          .map((s) => {
            const sets = workingSets(foldOps(ops.filter((o) => o.sessionId === s.id)));
            if (sets.length === 0) return null;
            const top = Math.max(...sets.map((x) => x.payload.weightKg ?? 0));
            const e1rm = Math.max(...sets.map((x) => epleyE1rm(x.payload.weightKg, x.payload.reps) ?? 0));
            return { date: s.startedAt.slice(0, 10), topWeightKg: top || null, e1rmKg: e1rm || null };
          })
          .filter((x): x is NonNullable<typeof x> => x != null);
      });
    }),

  /** Weekly volume by muscle region + movement pattern, last 8 weeks. */
  volumeBreakdown: tenantProcedure
    .input(z.object({ memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return { byRegion: [], byPattern: [] };
      return ctx.tenant(async (tx) => {
        const { resource } = await workoutFacts(tx, memberId);
        await ctx.allow('progress.read', resource, { notFound: true });
        const since = new Date(Date.now() - 56 * 86400000).toISOString();
        const result = await tx.execute(sql`
          WITH sets AS (
            SELECT sl.exercise_id,
                   date_trunc('week', ws.started_at) AS week,
                   coalesce((sl.payload->>'weightKg')::numeric, 0) * coalesce((sl.payload->>'reps')::numeric, 0) AS tonnage
            FROM set_log sl
            JOIN workout_sessions ws ON ws.id = sl.session_id
            WHERE ws.member_id = ${memberId}
              AND ws.status = 'completed'
              AND ws.started_at >= ${since}
              AND sl.kind = 'set_logged'
              AND coalesce((sl.payload->>'isWarmup')::boolean, false) = false
          )
          SELECT 'region' AS dim, m.region AS key, to_char(s.week, 'YYYY-MM-DD') AS week, round(sum(s.tonnage))::int AS volume
          FROM sets s
          JOIN exercise_muscles em ON em.exercise_id = s.exercise_id AND em.role = 'primary'
          JOIN muscles m ON m.id = em.muscle_id
          GROUP BY m.region, s.week
          UNION ALL
          SELECT 'pattern' AS dim, mp.name AS key, to_char(s.week, 'YYYY-MM-DD') AS week, round(sum(s.tonnage))::int AS volume
          FROM sets s
          JOIN exercises e ON e.id = s.exercise_id
          JOIN movement_patterns mp ON mp.id = e.movement_pattern_id
          GROUP BY mp.name, s.week
          ORDER BY week
        `);
        const rows = result.rows as Array<{ dim: string; key: string; week: string; volume: number }>;
        return {
          byRegion: rows.filter((r) => r.dim === 'region'),
          byPattern: rows.filter((r) => r.dim === 'pattern'),
        };
      });
    }),

  progressSummary: tenantProcedure
    .input(z.object({ memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return null;
      return ctx.tenant(async (tx) => {
        const { resource } = await workoutFacts(tx, memberId);
        await ctx.allow('progress.read', resource, { notFound: true });
        const all = await tx
          .select({ startedAt: schema.workoutSessions.startedAt })
          .from(schema.workoutSessions)
          .where(and(eq(schema.workoutSessions.memberId, memberId), eq(schema.workoutSessions.status, 'completed')));
        const streak = computeStreakWeeks(all.map((s) => new Date(s.startedAt)));
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const recent = all.filter((s) => s.startedAt >= since30).length;
        const prs = await tx
          .select({
            id: schema.personalRecords.id,
            exerciseId: schema.personalRecords.exerciseId,
            exerciseName: schema.exercises.name,
            kind: schema.personalRecords.kind,
            value: schema.personalRecords.value,
            achievedAt: schema.personalRecords.achievedAt,
          })
          .from(schema.personalRecords)
          .innerJoin(schema.exercises, eq(schema.exercises.id, schema.personalRecords.exerciseId))
          .where(eq(schema.personalRecords.memberId, memberId))
          .orderBy(desc(schema.personalRecords.achievedAt))
          .limit(10);
        return { totalSessions: all.length, sessions30d: recent, streak, recentPrs: prs };
      });
    }),

  // --- body metrics --------------------------------------------------------

  bodyMetrics: tenantProcedure
    .input(z.object({ memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return [];
      return ctx.tenant(async (tx) => {
        const { resource } = await memberFacts(tx, memberId);
        await ctx.allow('health.read', { ...resource, type: 'body_metrics' }, { notFound: true });
        return tx
          .select()
          .from(schema.bodyMetrics)
          .where(eq(schema.bodyMetrics.memberId, memberId))
          .orderBy(desc(schema.bodyMetrics.measuredAt))
          .limit(120);
      });
    }),

  bodyMetricAdd: tenantProcedure
    .input(
      z.object({
        weightKg: z.number().positive().max(500).nullish(),
        bodyFatPct: z.number().min(1).max(75).nullish(),
        measures: z.record(z.string(), z.number()).nullish(),
        measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'FORBIDDEN' });
      await ctx.allow('health.write', { type: 'body_metrics', memberId });
      const id = uuidv7();
      await ctx.tenant((tx) =>
        tx.insert(schema.bodyMetrics).values({
          id,
          gymId: ctx.gym.id,
          memberId,
          measuredAt: input.measuredAt ?? new Date().toISOString().slice(0, 10),
          weightKg: input.weightKg != null ? String(input.weightKg) : null,
          bodyFatPct: input.bodyFatPct != null ? String(input.bodyFatPct) : null,
          measures: input.measures ?? null,
        }),
      );
      return { id };
    }),

  // --- form review ---------------------------------------------------------

  formReviewCreate: tenantProcedure
    .input(z.object({ setOpId: z.string().length(26).nullish(), mediaId: z.string().uuid(), note: z.string().max(1000).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'FORBIDDEN' });
      await ctx.allow('workout.log', { type: 'form_review', memberId });
      const id = uuidv7();
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.formReviews).values({
          id,
          gymId: ctx.gym.id,
          memberId,
          setOpId: input.setOpId ?? null,
          mediaId: input.mediaId,
          memberNote: input.note ?? null,
        });
        const assigned = await tx
          .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
          .from(schema.trainerAssignments)
          .where(and(eq(schema.trainerAssignments.memberId, memberId), isNull(schema.trainerAssignments.endedAt)));
        const { notifyUsers } = await import('../services/people.js');
        await notifyUsers(tx, ctx.gym.id, assigned.map((a) => a.trainerUserId), {
          kind: 'form_review',
          title: 'Form check requested',
          data: { formReviewId: id },
        });
      });
      return { id };
    }),

  formReviewList: tenantProcedure
    .input(z.object({ status: z.enum(['pending', 'reviewed']).optional(), memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const conds = [eq(schema.formReviews.gymId, ctx.gym.id)];
        if (input.status) conds.push(eq(schema.formReviews.status, input.status));

        const memberId = input.memberId ?? ctx.actor.memberId;
        const isStaff = ctx.actor.staffRoles.some((r) => r === 'owner' || r === 'admin' || r === 'trainer');
        if (!isStaff) {
          if (!memberId) return [];
          await ctx.allow('workout.read', { type: 'form_review', memberId });
          conds.push(eq(schema.formReviews.memberId, memberId));
        } else if (
          ctx.actor.staffRoles.includes('trainer') &&
          !ctx.actor.staffRoles.some((r) => r === 'owner' || r === 'admin')
        ) {
          const { assignedMemberIds } = await import('../services/people.js');
          const ids = await assignedMemberIds(tx, ctx.user.id);
          if (ids.length === 0) return [];
          conds.push(inArray(schema.formReviews.memberId, ids));
        }

        const rows = await tx
          .select({
            review: schema.formReviews,
            firstName: schema.members.firstName,
            lastName: schema.members.lastName,
          })
          .from(schema.formReviews)
          .innerJoin(schema.members, eq(schema.members.id, schema.formReviews.memberId))
          .where(and(...conds))
          .orderBy(desc(schema.formReviews.createdAt))
          .limit(50);
        return rows.map((r) => ({ ...r.review, memberName: `${r.firstName} ${r.lastName}` }));
      });
    }),

  formReviewRespond: tenantProcedure
    .input(z.object({ formReviewId: z.string().uuid(), feedback: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.tenant(async (tx) => {
        const rows = await tx.select().from(schema.formReviews).where(eq(schema.formReviews.id, input.formReviewId)).limit(1);
        const review = rows[0];
        if (!review) throw new TRPCError({ code: 'NOT_FOUND' });
        const { resource } = await workoutFacts(tx, review.memberId);
        await ctx.allow('workout.review_form', resource, { notFound: true });
        await tx
          .update(schema.formReviews)
          .set({
            feedback: input.feedback,
            trainerUserId: ctx.user.id,
            status: 'reviewed',
            reviewedAt: new Date().toISOString(),
          })
          .where(eq(schema.formReviews.id, review.id));
        const memberUser = await tx
          .select({ userId: schema.members.userId })
          .from(schema.members)
          .where(eq(schema.members.id, review.memberId))
          .limit(1);
        if (memberUser[0]?.userId) {
          const { notifyUsers } = await import('../services/people.js');
          await notifyUsers(tx, ctx.gym.id, [memberUser[0].userId], {
            kind: 'form_feedback',
            title: 'Your form check has feedback',
            data: { formReviewId: review.id },
          });
        }
      });
      return { ok: true };
    }),
});
