import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7, uuidArrayLiteral } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { notifyUsers } from '../services/people.js';
import { findSubstitutes } from '../services/substitution.js';

/** Tag codes printed on QR labels: short, unambiguous, per-gym unique. */
function makeTagCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `EQ-${code}`;
}

export const equipmentRouter = router({
  classes: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('equipment.read');
    return ctx.tenant((tx) => tx.select().from(schema.equipmentClasses).orderBy(schema.equipmentClasses.name));
  }),

  models: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('equipment.read');
    return ctx.tenant(async (tx) => {
      const models = await tx
        .select()
        .from(schema.equipmentModels)
        .where(and(eq(schema.equipmentModels.gymId, ctx.gym.id), sql`${schema.equipmentModels.archivedAt} IS NULL`))
        .orderBy(schema.equipmentModels.name);
      const units = await tx
        .select()
        .from(schema.equipmentUnits)
        .where(eq(schema.equipmentUnits.gymId, ctx.gym.id));
      const links = await tx
        .select({ modelId: schema.equipmentExerciseLinks.modelId, exerciseId: schema.equipmentExerciseLinks.exerciseId })
        .from(schema.equipmentExerciseLinks)
        .where(eq(schema.equipmentExerciseLinks.gymId, ctx.gym.id));
      const classes = await tx
        .select()
        .from(schema.equipmentModelClasses)
        .where(eq(schema.equipmentModelClasses.gymId, ctx.gym.id));
      return models.map((m) => ({
        ...m,
        units: units.filter((u) => u.modelId === m.id),
        exerciseIds: links.filter((l) => l.modelId === m.id).map((l) => l.exerciseId),
        classIds: classes.filter((c) => c.modelId === m.id).map((c) => c.classId),
      }));
    });
  }),

  modelCreate: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        category: z.string().min(1).max(60).default('other'),
        manufacturer: z.string().max(120).nullish(),
        model: z.string().max(120).nullish(),
        notes: z.string().max(2000).nullish(),
        classIds: z.array(z.string().uuid()).max(10).default([]),
        exerciseIds: z.array(z.string().uuid()).max(100).default([]),
        unitCount: z.number().int().min(0).max(50).default(1),
        zoneId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.manage');
      const id = uuidv7();
      const tagCodes: string[] = [];
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.equipmentModels).values({
          id,
          gymId: ctx.gym.id,
          name: input.name,
          category: input.category,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          notes: input.notes ?? null,
        });
        if (input.classIds.length) {
          await tx.insert(schema.equipmentModelClasses).values(
            input.classIds.map((classId) => ({ id: uuidv7(), gymId: ctx.gym.id, modelId: id, classId })),
          );
        }
        if (input.exerciseIds.length) {
          await tx.insert(schema.equipmentExerciseLinks).values(
            input.exerciseIds.map((exerciseId) => ({ id: uuidv7(), gymId: ctx.gym.id, modelId: id, exerciseId })),
          );
        }
        for (let i = 0; i < input.unitCount; i++) {
          const tagCode = makeTagCode();
          tagCodes.push(tagCode);
          await tx.insert(schema.equipmentUnits).values({
            id: uuidv7(),
            gymId: ctx.gym.id,
            modelId: id,
            tagCode,
            zoneId: input.zoneId ?? null,
          });
        }
      });
      await ctx.audit('equipment.create', 'equipment_model', id, { units: input.unitCount });
      return { id, tagCodes };
    }),

  modelUpdate: tenantProcedure
    .input(
      z.object({
        modelId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        category: z.string().min(1).max(60).optional(),
        manufacturer: z.string().max(120).nullish(),
        notes: z.string().max(2000).nullish(),
        classIds: z.array(z.string().uuid()).max(10).optional(),
        exerciseIds: z.array(z.string().uuid()).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.manage');
      await ctx.tenant(async (tx) => {
        const { modelId, classIds, exerciseIds, ...patch } = input;
        if (Object.keys(patch).length) {
          await tx.update(schema.equipmentModels).set(patch).where(eq(schema.equipmentModels.id, modelId));
        }
        if (classIds) {
          await tx.delete(schema.equipmentModelClasses).where(eq(schema.equipmentModelClasses.modelId, modelId));
          if (classIds.length) {
            await tx.insert(schema.equipmentModelClasses).values(
              classIds.map((classId) => ({ id: uuidv7(), gymId: ctx.gym.id, modelId, classId })),
            );
          }
        }
        if (exerciseIds) {
          await tx.delete(schema.equipmentExerciseLinks).where(eq(schema.equipmentExerciseLinks.modelId, modelId));
          if (exerciseIds.length) {
            await tx.insert(schema.equipmentExerciseLinks).values(
              exerciseIds.map((exerciseId) => ({ id: uuidv7(), gymId: ctx.gym.id, modelId, exerciseId })),
            );
          }
        }
      });
      return { ok: true };
    }),

  unitAdd: tenantProcedure
    .input(z.object({ modelId: z.string().uuid(), zoneId: z.string().uuid().nullish() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.manage');
      const id = uuidv7();
      const tagCode = makeTagCode();
      await ctx.tenant((tx) =>
        tx.insert(schema.equipmentUnits).values({
          id,
          gymId: ctx.gym.id,
          modelId: input.modelId,
          tagCode,
          zoneId: input.zoneId ?? null,
        }),
      );
      return { id, tagCode };
    }),

  /** Status change + the OOS trigger: when the last in-service unit of a model
   *  goes down, surface substitutes and notify affected trainers (spec §4.3). */
  unitSetStatus: tenantProcedure
    .input(
      z.object({
        unitId: z.string().uuid(),
        status: z.enum(['in_service', 'maintenance', 'out_of_service', 'retired']),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.update_status');
      const affected = await ctx.tenant(async (tx) => {
        const unitRows = await tx
          .select()
          .from(schema.equipmentUnits)
          .where(eq(schema.equipmentUnits.id, input.unitId))
          .limit(1);
        const unit = unitRows[0];
        if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
        if (unit.status === input.status) return null;
        await tx.update(schema.equipmentUnits).set({ status: input.status }).where(eq(schema.equipmentUnits.id, unit.id));
        await tx.insert(schema.equipmentStatusHistory).values({
          id: uuidv7(),
          gymId: ctx.gym.id,
          unitId: unit.id,
          fromStatus: unit.status,
          toStatus: input.status,
          changedBy: ctx.user.id,
          note: input.note ?? null,
        });

        const goingDown = input.status !== 'in_service' && unit.status === 'in_service';
        if (!goingDown) return null;
        const remaining = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.equipmentUnits)
          .where(
            and(
              eq(schema.equipmentUnits.modelId, unit.modelId),
              eq(schema.equipmentUnits.status, 'in_service'),
            ),
          );
        if ((remaining[0]?.n ?? 0) > 0) return null; // other units still up

        // Model fully down: which exercises, which active programs, which trainers?
        const exerciseRows = await tx
          .select({ exerciseId: schema.equipmentExerciseLinks.exerciseId, name: schema.exercises.name })
          .from(schema.equipmentExerciseLinks)
          .innerJoin(schema.exercises, eq(schema.exercises.id, schema.equipmentExerciseLinks.exerciseId))
          .where(eq(schema.equipmentExerciseLinks.modelId, unit.modelId));
        const exerciseIds = exerciseRows.map((e) => e.exerciseId);
        if (exerciseIds.length === 0) return { exercises: [], programs: [] };

        const programRows = await tx.execute(sql`
          SELECT DISTINCT p.id, p.name, p.owner_trainer_id
          FROM program_assignments pa
          JOIN programs p ON p.id = pa.program_id
          JOIN program_versions pv ON pv.id = pa.program_version_id
          JOIN program_blocks pb ON pb.version_id = pv.id
          JOIN program_weeks pw ON pw.block_id = pb.id
          JOIN program_days pd ON pd.week_id = pw.id
          JOIN program_day_items pdi ON pdi.day_id = pd.id
          WHERE pa.status = 'active' AND pdi.exercise_id = ANY(${uuidArrayLiteral(exerciseIds)}::uuid[])
        `);
        const programs = programRows.rows as Array<{ id: string; name: string; owner_trainer_id: string | null }>;

        const modelRows = await tx
          .select({ name: schema.equipmentModels.name })
          .from(schema.equipmentModels)
          .where(eq(schema.equipmentModels.id, unit.modelId))
          .limit(1);
        const modelName = modelRows[0]?.name ?? 'Equipment';

        const staff = await tx
          .select({ userId: schema.gymStaff.userId, role: schema.gymStaff.role })
          .from(schema.gymStaff)
          .where(and(eq(schema.gymStaff.gymId, ctx.gym.id), eq(schema.gymStaff.status, 'active')));
        const notifyIds = new Set<string>();
        for (const s of staff) if (s.role === 'admin' || s.role === 'owner') notifyIds.add(s.userId);
        for (const p of programs) if (p.owner_trainer_id) notifyIds.add(p.owner_trainer_id);

        await notifyUsers(tx, ctx.gym.id, [...notifyIds], {
          kind: 'equipment_down',
          title: `${modelName} is ${input.status.replace('_', ' ')}`,
          body: programs.length
            ? `${programs.length} active program(s) reference it — substitutes are being surfaced to members.`
            : 'No active programs reference it.',
          data: { modelId: unit.modelId, exerciseIds },
        });

        return { exercises: exerciseRows, programs: programs.map((p) => ({ id: p.id, name: p.name })) };
      });
      await ctx.audit('equipment.status', 'equipment_unit', input.unitId, { status: input.status });
      return { ok: true, affected };
    }),

  /** QR resolve: tag → machine page payload (exercises ordered for one-tap start). */
  byTag: tenantProcedure.input(z.object({ tagCode: z.string().min(3).max(20) })).query(async ({ ctx, input }) => {
    await ctx.allow('equipment.read');
    return ctx.tenant(async (tx) => {
      const unitRows = await tx
        .select()
        .from(schema.equipmentUnits)
        .where(and(eq(schema.equipmentUnits.gymId, ctx.gym.id), eq(schema.equipmentUnits.tagCode, input.tagCode)))
        .limit(1);
      const unit = unitRows[0];
      if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });
      const modelRows = await tx
        .select()
        .from(schema.equipmentModels)
        .where(eq(schema.equipmentModels.id, unit.modelId))
        .limit(1);
      const exercises = await tx
        .select({
          id: schema.exercises.id,
          name: schema.exercises.name,
          difficulty: schema.exercises.difficulty,
          videoGroupId: schema.exercises.videoGroupId,
          cues: schema.exercises.cues,
        })
        .from(schema.equipmentExerciseLinks)
        .innerJoin(schema.exercises, eq(schema.exercises.id, schema.equipmentExerciseLinks.exerciseId))
        .where(eq(schema.equipmentExerciseLinks.modelId, unit.modelId))
        .orderBy(schema.exercises.name);
      const openReports = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.maintenanceReports)
        .where(and(eq(schema.maintenanceReports.unitId, unit.id), eq(schema.maintenanceReports.status, 'open')));
      if (ctx.actor.memberId) {
        await tx.insert(schema.equipmentScans).values({
          id: uuidv7(),
          gymId: ctx.gym.id,
          unitId: unit.id,
          memberId: ctx.actor.memberId,
        });
      }
      return { unit, model: modelRows[0] ?? null, exercises, openReports: openReports[0]?.n ?? 0 };
    });
  }),

  reportIssue: tenantProcedure
    .input(
      z.object({
        unitId: z.string().uuid().optional(),
        tagCode: z.string().max(20).optional(),
        description: z.string().min(1).max(2000),
        photoMediaId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('equipment.report_issue');
      return ctx.tenant(async (tx) => {
        let unitId = input.unitId;
        if (!unitId && input.tagCode) {
          const u = await tx
            .select({ id: schema.equipmentUnits.id })
            .from(schema.equipmentUnits)
            .where(and(eq(schema.equipmentUnits.gymId, ctx.gym.id), eq(schema.equipmentUnits.tagCode, input.tagCode)))
            .limit(1);
          unitId = u[0]?.id;
        }
        if (!unitId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'unitId or tagCode required' });
        const id = uuidv7();
        await tx.insert(schema.maintenanceReports).values({
          id,
          gymId: ctx.gym.id,
          unitId,
          reportedByUserId: ctx.user.id,
          reportedByMemberId: ctx.actor.memberId,
          description: input.description,
          photoMediaId: input.photoMediaId ?? null,
        });
        const staff = await tx
          .select({ userId: schema.gymStaff.userId, role: schema.gymStaff.role })
          .from(schema.gymStaff)
          .where(and(eq(schema.gymStaff.gymId, ctx.gym.id), eq(schema.gymStaff.status, 'active')));
        await notifyUsers(
          tx,
          ctx.gym.id,
          staff.filter((s) => s.role === 'admin' || s.role === 'owner').map((s) => s.userId),
          { kind: 'maintenance_report', title: 'Equipment issue reported', body: input.description.slice(0, 140), data: { reportId: id } },
        );
        return { id };
      });
    }),

  maintenanceList: tenantProcedure
    .input(z.object({ status: z.enum(['open', 'in_progress', 'resolved']).optional() }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('maintenance.read');
      return ctx.tenant(async (tx) => {
        const conds = [eq(schema.maintenanceReports.gymId, ctx.gym.id)];
        if (input.status) conds.push(eq(schema.maintenanceReports.status, input.status));
        const reports = await tx
          .select()
          .from(schema.maintenanceReports)
          .where(and(...conds))
          .orderBy(desc(schema.maintenanceReports.createdAt))
          .limit(100);
        const unitIds = [...new Set(reports.map((r) => r.unitId))];
        const units = unitIds.length
          ? await tx
              .select({
                id: schema.equipmentUnits.id,
                tagCode: schema.equipmentUnits.tagCode,
                status: schema.equipmentUnits.status,
                modelName: schema.equipmentModels.name,
              })
              .from(schema.equipmentUnits)
              .innerJoin(schema.equipmentModels, eq(schema.equipmentModels.id, schema.equipmentUnits.modelId))
              .where(inArray(schema.equipmentUnits.id, unitIds))
          : [];
        return reports.map((r) => ({ ...r, unit: units.find((u) => u.id === r.unitId) ?? null }));
      });
    }),

  maintenanceUpdate: tenantProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        status: z.enum(['open', 'in_progress', 'resolved']),
        resolution: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('maintenance.manage');
      await ctx.tenant((tx) =>
        tx
          .update(schema.maintenanceReports)
          .set({
            status: input.status,
            resolution: input.resolution ?? null,
            resolvedAt: input.status === 'resolved' ? new Date().toISOString() : null,
          })
          .where(eq(schema.maintenanceReports.id, input.reportId)),
      );
      return { ok: true };
    }),

  substitutes: tenantProcedure
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        memberId: z.string().uuid().nullish(),
        preservePattern: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ctx.allow('exercise.read');
      // members get their own limitation filtering automatically
      const memberId = input.memberId ?? ctx.actor.memberId;
      return ctx.tenant((tx) =>
        findSubstitutes(tx, {
          exerciseId: input.exerciseId,
          memberId,
          preservePattern: input.preservePattern,
        }),
      );
    }),
});
