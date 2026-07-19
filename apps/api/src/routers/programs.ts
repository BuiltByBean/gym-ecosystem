import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7, uuidArrayLiteral } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { notifyUsers } from '../services/people.js';
import { availableExerciseIds } from '../services/substitution.js';
import {
  readVersionTree,
  resolveLoad,
  writeVersionTree,
  type BlockInput,
} from '../services/programs.js';

const loadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('absolute'), value: z.number().positive(), unit: z.enum(['lb', 'kg']) }),
  z.object({ type: z.literal('percent_max'), percent: z.number().min(1).max(150) }),
  z.object({ type: z.literal('rpe'), rpe: z.number().min(1).max(10) }),
  z.object({ type: z.literal('bodyweight') }),
]);

const treeSchema = z.array(
  z.object({
    name: z.string().min(1).max(80),
    orderNo: z.number().int().min(1),
    weeks: z.array(
      z.object({
        weekNo: z.number().int().min(1),
        name: z.string().max(80).nullish(),
        days: z.array(
          z.object({
            dayNo: z.number().int().min(1),
            name: z.string().min(1).max(80),
            focus: z.string().max(120).nullish(),
            items: z.array(
              z.object({
                exerciseId: z.string().uuid(),
                orderNo: z.number().int().min(1),
                groupNo: z.number().int().min(1).nullish(),
                groupKind: z.enum(['straight', 'superset', 'circuit', 'emom', 'amrap', 'interval']).default('straight'),
                sets: z.number().int().min(1).max(20),
                reps: z.string().min(1).max(20),
                load: loadSchema,
                tempo: z.string().max(20).nullish(),
                restS: z.number().int().min(0).max(1800).nullish(),
                rpeTarget: z.number().min(1).max(10).nullish(),
                notes: z.string().max(1000).nullish(),
                progressionRuleId: z.string().uuid().nullish(),
                alternates: z
                  .array(z.object({ exerciseId: z.string().uuid(), rank: z.number().int().min(1).max(20), reason: z.string().max(200).nullish() }))
                  .max(5)
                  .default([]),
              }),
            ).max(30),
          }),
        ).max(7),
      }),
    ).max(16),
  }),
).max(6);

async function programResource(tx: Parameters<typeof readVersionTree>[0], programId: string) {
  const rows = await tx.select().from(schema.programs).where(eq(schema.programs.id, programId)).limit(1);
  const program = rows[0];
  if (!program) throw new TRPCError({ code: 'NOT_FOUND' });
  return { program, resource: { type: 'program', ownerUserId: program.ownerTrainerId } };
}

export const programsRouter = router({
  progressionRules: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('program.read');
    return ctx.tenant((tx) => tx.select().from(schema.progressionRules).orderBy(asc(schema.progressionRules.name)));
  }),

  list: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('program.read');
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.programs)
        .where(and(isNull(schema.programs.archivedAt)))
        .orderBy(desc(schema.programs.createdAt))
        .limit(200);
      const counts = await tx
        .select({
          programId: schema.programAssignments.programId,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.programAssignments)
        .where(eq(schema.programAssignments.status, 'active'))
        .groupBy(schema.programAssignments.programId);
      const owners = await tx
        .select({ id: schema.users.id, name: schema.users.displayName })
        .from(schema.users)
        .where(inArray(schema.users.id, rows.map((r) => r.ownerTrainerId).filter((x): x is string => x != null)));
      return rows.map((p) => ({
        ...p,
        source: p.gymId === null ? ('platform' as const) : p.ownerTrainerId ? ('trainer' as const) : ('gym' as const),
        ownerName: owners.find((o) => o.id === p.ownerTrainerId)?.name ?? null,
        activeAssignments: counts.find((c) => c.programId === p.id)?.n ?? 0,
      }));
    });
  }),

  create: tenantProcedure
    .input(z.object({ name: z.string().min(1).max(160), description: z.string().max(2000).nullish(), goalTags: z.array(z.string().max(40)).max(8).default([]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('program.create');
      const isTrainerOnly =
        ctx.actor.staffRoles.includes('trainer') &&
        !ctx.actor.staffRoles.some((r) => r === 'owner' || r === 'admin');
      const programId = uuidv7();
      const versionId = uuidv7();
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.programs).values({
          id: programId,
          gymId: ctx.gym.id,
          ownerTrainerId: isTrainerOnly ? ctx.user.id : null,
          name: input.name,
          description: input.description ?? null,
          goalTags: input.goalTags,
          createdBy: ctx.user.id,
        });
        await tx.insert(schema.programVersions).values({
          id: versionId,
          gymId: ctx.gym.id,
          programId,
          version: 1,
          status: 'draft',
        });
        await writeVersionTree(tx, ctx.gym.id, versionId, [
          { name: 'Block 1', orderNo: 1, weeks: [{ weekNo: 1, days: [{ dayNo: 1, name: 'Day 1', items: [] }] }] },
        ]);
      });
      return { programId, versionId };
    }),

  get: tenantProcedure.input(z.object({ programId: z.string().uuid() })).query(async ({ ctx, input }) => {
    return ctx.tenant(async (tx) => {
      const { program, resource } = await programResource(tx, input.programId);
      // staff read; members read only if assigned or gym-published
      if (ctx.actor.staffRoles.length === 0) {
        const assigned = await tx
          .select({ id: schema.programAssignments.id })
          .from(schema.programAssignments)
          .where(
            and(
              eq(schema.programAssignments.programId, program.id),
              eq(schema.programAssignments.status, 'active'),
              or(
                isNull(schema.programAssignments.memberId),
                eq(schema.programAssignments.memberId, ctx.actor.memberId ?? '00000000-0000-0000-0000-000000000000'),
              ),
            ),
          )
          .limit(1);
        if (assigned.length === 0 && !program.publishedToMembers) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('program.read_assigned', { type: 'program', memberId: ctx.actor.memberId });
      } else {
        await ctx.allow('program.read', resource);
      }
      const versions = await tx
        .select()
        .from(schema.programVersions)
        .where(eq(schema.programVersions.programId, program.id))
        .orderBy(desc(schema.programVersions.version));
      return { ...program, versions };
    });
  }),

  getTree: tenantProcedure
    .input(z.object({ programId: z.string().uuid(), versionId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { program, resource } = await programResource(tx, input.programId);
        if (ctx.actor.staffRoles.length === 0) {
          await ctx.allow('program.read_assigned', { type: 'program', memberId: ctx.actor.memberId });
        } else {
          await ctx.allow('program.read', resource);
        }
        const versionId =
          input.versionId ??
          program.currentVersionId ??
          (
            await tx
              .select({ id: schema.programVersions.id })
              .from(schema.programVersions)
              .where(eq(schema.programVersions.programId, program.id))
              .orderBy(desc(schema.programVersions.version))
              .limit(1)
          )[0]?.id;
        if (!versionId) throw new TRPCError({ code: 'NOT_FOUND' });
        const vRows = await tx.select().from(schema.programVersions).where(eq(schema.programVersions.id, versionId)).limit(1);
        const blocks = await readVersionTree(tx, versionId);
        const available = await availableExerciseIds(tx);
        // flag items whose equipment is currently out of service (spec §4.6)
        const withFlags = blocks.map((b) => ({
          ...b,
          weeks: b.weeks.map((w) => ({
            ...w,
            days: w.days.map((d) => ({
              ...d,
              items: d.items.map((i) => ({ ...i, equipmentAvailable: available.has(i.exerciseId) })),
            })),
          })),
        }));
        return { version: vRows[0]!, blocks: withFlags };
      });
    }),

  saveDraft: tenantProcedure
    .input(
      z.object({
        programId: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).nullish(),
        goalTags: z.array(z.string().max(40)).max(8).optional(),
        defaultProgressionRuleId: z.string().uuid().nullish(),
        blocks: treeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { program, resource } = await programResource(tx, input.programId);
        await ctx.allow('program.update', resource, { notFound: true });
        if (program.gymId === null) throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform templates are read-only — duplicate first' });

        let draft = (
          await tx
            .select()
            .from(schema.programVersions)
            .where(and(eq(schema.programVersions.programId, program.id), eq(schema.programVersions.status, 'draft')))
            .orderBy(desc(schema.programVersions.version))
            .limit(1)
        )[0];
        if (!draft) {
          const maxV = await tx
            .select({ v: sql<number>`coalesce(max(version), 0)::int` })
            .from(schema.programVersions)
            .where(eq(schema.programVersions.programId, program.id));
          const id = uuidv7();
          await tx.insert(schema.programVersions).values({
            id,
            gymId: ctx.gym.id,
            programId: program.id,
            version: (maxV[0]?.v ?? 0) + 1,
            status: 'draft',
          });
          draft = (await tx.select().from(schema.programVersions).where(eq(schema.programVersions.id, id)).limit(1))[0]!;
        }

        await tx
          .update(schema.programVersions)
          .set({ defaultProgressionRuleId: input.defaultProgressionRuleId ?? null })
          .where(eq(schema.programVersions.id, draft.id));
        const meta: Record<string, unknown> = {};
        if (input.name) meta.name = input.name;
        if (input.description !== undefined) meta.description = input.description;
        if (input.goalTags) meta.goalTags = input.goalTags;
        if (Object.keys(meta).length) {
          await tx.update(schema.programs).set(meta).where(eq(schema.programs.id, program.id));
        }
        await writeVersionTree(tx, ctx.gym.id, draft.id, input.blocks as BlockInput[]);
        return { versionId: draft.id, version: draft.version };
      });
    }),

  /** Publish freezes the draft; assignments pin versions (docs/DECISIONS.md D-007). */
  publish: tenantProcedure
    .input(z.object({ programId: z.string().uuid(), publishToMembers: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tenant(async (tx) => {
        const { program, resource } = await programResource(tx, input.programId);
        await ctx.allow('program.publish', resource, { notFound: true });
        const draft = (
          await tx
            .select()
            .from(schema.programVersions)
            .where(and(eq(schema.programVersions.programId, program.id), eq(schema.programVersions.status, 'draft')))
            .orderBy(desc(schema.programVersions.version))
            .limit(1)
        )[0];
        if (!draft) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to publish — no draft version' });
        await tx
          .update(schema.programVersions)
          .set({ status: 'published', publishedAt: new Date().toISOString(), publishedBy: ctx.user.id })
          .where(eq(schema.programVersions.id, draft.id));
        await tx
          .update(schema.programs)
          .set({
            status: 'published',
            currentVersionId: draft.id,
            ...(input.publishToMembers !== undefined ? { publishedToMembers: input.publishToMembers } : {}),
          })
          .where(eq(schema.programs.id, program.id));
        return { versionId: draft.id, version: draft.version };
      });
      await ctx.audit('program.publish', 'program', input.programId, result);
      return result;
    }),

  assign: tenantProcedure
    .input(
      z.object({
        programId: z.string().uuid(),
        memberIds: z.array(z.string().uuid()).max(200).optional(),
        wholeGym: z.boolean().default(false),
        startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.wholeGym && (!input.memberIds || input.memberIds.length === 0)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick members or assign to the whole gym' });
      }
      const created = await ctx.tenant(async (tx) => {
        const { program } = await programResource(tx, input.programId);
        if (!program.currentVersionId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Publish the program before assigning it' });
        const startsOn = input.startsOn ?? new Date().toISOString().slice(0, 10);
        const ids: string[] = [];

        if (input.wholeGym) {
          await ctx.allow('program.assign', { type: 'program' });
          const id = uuidv7();
          await tx.insert(schema.programAssignments).values({
            id,
            gymId: ctx.gym.id,
            programId: program.id,
            programVersionId: program.currentVersionId,
            memberId: null,
            assignedBy: ctx.user.id,
            startsOn,
          });
          ids.push(id);
          return ids;
        }

        for (const memberId of input.memberIds!) {
          const assigned = await tx
            .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
            .from(schema.trainerAssignments)
            .where(and(eq(schema.trainerAssignments.memberId, memberId), isNull(schema.trainerAssignments.endedAt)));
          await ctx.allow(
            'program.assign',
            { type: 'program', memberId, assignedTrainerUserIds: assigned.map((a) => a.trainerUserId) },
            { notFound: true },
          );
          const id = uuidv7();
          await tx.insert(schema.programAssignments).values({
            id,
            gymId: ctx.gym.id,
            programId: program.id,
            programVersionId: program.currentVersionId,
            memberId,
            assignedBy: ctx.user.id,
            startsOn,
          });
          ids.push(id);
          const memberUser = await tx
            .select({ userId: schema.members.userId })
            .from(schema.members)
            .where(eq(schema.members.id, memberId))
            .limit(1);
          if (memberUser[0]?.userId) {
            await notifyUsers(tx, ctx.gym.id, [memberUser[0].userId], {
              kind: 'program_assigned',
              title: `New program: ${program.name}`,
              data: { programId: program.id, assignmentId: id },
            });
          }
        }
        return ids;
      });
      await ctx.audit('program.assign', 'program', input.programId, { assignments: created.length });
      return { assignmentIds: created };
    }),

  unassign: tenantProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('program.assign', { type: 'program' });
      await ctx.tenant((tx) =>
        tx
          .update(schema.programAssignments)
          .set({ status: 'cancelled' })
          .where(eq(schema.programAssignments.id, input.assignmentId)),
      );
      return { ok: true };
    }),

  /** Member home: active assignments incl. gym-wide programs + progress. */
  myAssignments: tenantProcedure.query(async ({ ctx }) => {
    const memberId = ctx.actor.memberId;
    if (!memberId) return [];
    await ctx.allow('program.read_assigned', { type: 'program', memberId });
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select({
          assignment: schema.programAssignments,
          program: schema.programs,
        })
        .from(schema.programAssignments)
        .innerJoin(schema.programs, eq(schema.programs.id, schema.programAssignments.programId))
        .where(
          and(
            eq(schema.programAssignments.status, 'active'),
            or(eq(schema.programAssignments.memberId, memberId), isNull(schema.programAssignments.memberId)),
          ),
        )
        .orderBy(desc(schema.programAssignments.createdAt));
      const versionIds = rows.map((r) => r.assignment.programVersionId);
      const dayCounts = versionIds.length
        ? await tx.execute(sql`
            SELECT pv.id AS version_id, count(pd.id)::int AS days
            FROM program_versions pv
            JOIN program_blocks pb ON pb.version_id = pv.id
            JOIN program_weeks pw ON pw.block_id = pb.id
            JOIN program_days pd ON pd.week_id = pw.id
            WHERE pv.id = ANY(${uuidArrayLiteral(versionIds)}::uuid[])
            GROUP BY pv.id
          `)
        : { rows: [] };
      const completed = await tx
        .select({
          versionId: schema.workoutSessions.programVersionId,
          n: sql<number>`count(distinct ${schema.workoutSessions.programDayId})::int`,
        })
        .from(schema.workoutSessions)
        .where(and(eq(schema.workoutSessions.memberId, memberId), eq(schema.workoutSessions.status, 'completed')))
        .groupBy(schema.workoutSessions.programVersionId);
      // a member personally assigned a program also "has" its gym-wide offering —
      // keep the personal assignment only
      const deduped = rows.filter(
        (r) =>
          r.assignment.memberId !== null ||
          !rows.some((o) => o.program.id === r.program.id && o.assignment.memberId !== null),
      );
      return deduped.map((r) => {
        const total =
          (dayCounts.rows as Array<{ version_id: string; days: number }>).find(
            (d) => d.version_id === r.assignment.programVersionId,
          )?.days ?? 0;
        const done = completed.find((c) => c.versionId === r.assignment.programVersionId)?.n ?? 0;
        return {
          assignmentId: r.assignment.id,
          programId: r.program.id,
          programVersionId: r.assignment.programVersionId,
          name: r.program.name,
          description: r.program.description,
          goalTags: r.program.goalTags,
          startsOn: r.assignment.startsOn,
          isGymWide: r.assignment.memberId === null,
          totalDays: total,
          completedDays: done,
        };
      });
    });
  }),

  /** Resolve one day into concrete targets: loads, progression, last performance. */
  todayPlan: tenantProcedure
    .input(z.object({ assignmentId: z.string().uuid(), dayId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = ctx.actor.memberId;
      return ctx.tenant(async (tx) => {
        const aRows = await tx
          .select()
          .from(schema.programAssignments)
          .where(eq(schema.programAssignments.id, input.assignmentId))
          .limit(1);
        const assignment = aRows[0];
        if (!assignment) throw new TRPCError({ code: 'NOT_FOUND' });
        const effectiveMemberId = assignment.memberId ?? memberId;
        if (!effectiveMemberId) throw new TRPCError({ code: 'FORBIDDEN' });
        const assigned = await tx
          .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
          .from(schema.trainerAssignments)
          .where(and(eq(schema.trainerAssignments.memberId, effectiveMemberId), isNull(schema.trainerAssignments.endedAt)));
        await ctx.allow(
          'program.read_assigned',
          { type: 'program', memberId: effectiveMemberId, assignedTrainerUserIds: assigned.map((a) => a.trainerUserId) },
          { notFound: true },
        );

        const blocks = await readVersionTree(tx, assignment.programVersionId);
        const allDays = blocks.flatMap((b) => b.weeks.flatMap((w) => w.days.map((d) => ({ ...d, weekNo: w.weekNo, blockName: b.name }))));
        if (allDays.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Program has no days' });

        const done = await tx
          .select({ dayId: schema.workoutSessions.programDayId })
          .from(schema.workoutSessions)
          .where(
            and(
              eq(schema.workoutSessions.memberId, effectiveMemberId),
              eq(schema.workoutSessions.programVersionId, assignment.programVersionId),
              eq(schema.workoutSessions.status, 'completed'),
            ),
          );
        const doneDayIds = new Set(done.map((d) => d.dayId));
        const day =
          (input.dayId ? allDays.find((d) => d.id === input.dayId) : undefined) ??
          allDays.find((d) => !doneDayIds.has(d.id)) ??
          allDays[allDays.length - 1]!;

        const vRows = await tx
          .select()
          .from(schema.programVersions)
          .where(eq(schema.programVersions.id, assignment.programVersionId))
          .limit(1);
        const defaultRuleId = vRows[0]?.defaultProgressionRuleId ?? null;
        const ruleIds = [
          ...new Set(
            [...day.items.map((i) => i.progressionRuleId), defaultRuleId].filter((x): x is string => x != null),
          ),
        ];
        const rules = ruleIds.length
          ? await tx.select().from(schema.progressionRules).where(inArray(schema.progressionRules.id, ruleIds))
          : [];

        const available = await availableExerciseIds(tx);
        const items = [];
        for (const item of day.items) {
          const rule = rules.find((r) => r.id === (item.progressionRuleId ?? defaultRuleId)) ?? null;
          const resolved = await resolveLoad(tx, {
            item,
            rule,
            memberId: effectiveMemberId,
            weekNo: day.weekNo,
            unit: ctx.gym.units,
            exerciseName: item.exercise?.name ?? 'exercise',
          });
          items.push({
            ...item,
            equipmentAvailable: available.has(item.exerciseId),
            resolved,
          });
        }
        return {
          assignment: { id: assignment.id, programVersionId: assignment.programVersionId },
          day: { id: day.id, name: day.name, focus: day.focus, weekNo: day.weekNo, blockName: day.blockName, dayNo: day.dayNo },
          allDays: allDays.map((d) => ({ id: d.id, name: d.name, weekNo: d.weekNo, dayNo: d.dayNo, completed: doneDayIds.has(d.id) })),
          items,
        };
      });
    }),

  // member maxes ------------------------------------------------------------

  maxList: tenantProcedure.input(z.object({ memberId: z.string().uuid().optional() })).query(async ({ ctx, input }) => {
    const memberId = input.memberId ?? ctx.actor.memberId;
    if (!memberId) return [];
    return ctx.tenant(async (tx) => {
      const assigned = await tx
        .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
        .from(schema.trainerAssignments)
        .where(and(eq(schema.trainerAssignments.memberId, memberId), isNull(schema.trainerAssignments.endedAt)));
      await ctx.allow('max.read', { type: 'max', memberId, assignedTrainerUserIds: assigned.map((a) => a.trainerUserId) }, { notFound: true });
      return tx
        .select({
          id: schema.memberMaxes.id,
          exerciseId: schema.memberMaxes.exerciseId,
          exerciseName: schema.exercises.name,
          kind: schema.memberMaxes.kind,
          valueKg: schema.memberMaxes.valueKg,
          measuredAt: schema.memberMaxes.measuredAt,
        })
        .from(schema.memberMaxes)
        .innerJoin(schema.exercises, eq(schema.exercises.id, schema.memberMaxes.exerciseId))
        .where(eq(schema.memberMaxes.memberId, memberId))
        .orderBy(desc(schema.memberMaxes.measuredAt));
    });
  }),

  maxSet: tenantProcedure
    .input(
      z.object({
        memberId: z.string().uuid().optional(),
        exerciseId: z.string().uuid(),
        valueKg: z.number().positive().max(1000),
        kind: z.enum(['tested', 'e1rm']).default('tested'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'BAD_REQUEST' });
      return ctx.tenant(async (tx) => {
        const assigned = await tx
          .select({ trainerUserId: schema.trainerAssignments.trainerUserId })
          .from(schema.trainerAssignments)
          .where(and(eq(schema.trainerAssignments.memberId, memberId), isNull(schema.trainerAssignments.endedAt)));
        await ctx.allow('max.write', { type: 'max', memberId, assignedTrainerUserIds: assigned.map((a) => a.trainerUserId) }, { notFound: true });
        const id = uuidv7();
        await tx.insert(schema.memberMaxes).values({
          id,
          gymId: ctx.gym.id,
          memberId,
          exerciseId: input.exerciseId,
          kind: input.kind,
          valueKg: String(input.valueKg),
          measuredAt: new Date().toISOString().slice(0, 10),
          source: 'manual',
        });
        return { id };
      });
    }),
});
