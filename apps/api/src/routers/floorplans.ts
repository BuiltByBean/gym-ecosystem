import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { locateExercise, locateMany, readPlan } from '../services/wayfinding.js';
import { readVersionTree } from '../services/programs.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const floorPlansRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('floorplan.read');
    return ctx.tenant((tx) =>
      tx
        .select()
        .from(schema.floorPlans)
        .where(eq(schema.floorPlans.gymId, ctx.gym.id))
        .orderBy(asc(schema.floorPlans.name)),
    );
  }),

  /** Full plan payload for rendering: geometry, zones, placed machines. */
  get: tenantProcedure
    .input(z.object({ planId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('floorplan.read');
      return ctx.tenant(async (tx) => {
        let planId = input.planId;
        if (!planId) {
          const rows = await tx
            .select({ id: schema.floorPlans.id, isDefault: schema.floorPlans.isDefault })
            .from(schema.floorPlans)
            .where(eq(schema.floorPlans.gymId, ctx.gym.id))
            .orderBy(asc(schema.floorPlans.createdAt));
          planId = (rows.find((r) => r.isDefault) ?? rows[0])?.id;
        }
        if (!planId) return null;
        return readPlan(tx, planId);
      });
    }),

  create: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        widthCm: z.number().int().min(200).max(30000).default(3000),
        heightCm: z.number().int().min(200).max(30000).default(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      const id = uuidv7();
      await ctx.tenant(async (tx) => {
        const existing = await tx
          .select({ id: schema.floorPlans.id })
          .from(schema.floorPlans)
          .where(eq(schema.floorPlans.gymId, ctx.gym.id))
          .limit(1);
        await tx.insert(schema.floorPlans).values({
          id,
          gymId: ctx.gym.id,
          name: input.name,
          widthCm: input.widthCm,
          heightCm: input.heightCm,
          isDefault: existing.length === 0, // first plan is the default
        });
      });
      await ctx.audit('floorplan.create', 'floor_plan', id);
      return { id };
    }),

  update: tenantProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        name: z.string().min(1).max(80).optional(),
        widthCm: z.number().int().min(200).max(30000).optional(),
        heightCm: z.number().int().min(200).max(30000).optional(),
        gridCm: z.number().int().min(10).max(500).optional(),
        backgroundMediaId: z.string().uuid().nullish(),
        backgroundOpacity: z.number().min(0).max(1).optional(),
        entranceXCm: z.number().int().nullish(),
        entranceYCm: z.number().int().nullish(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      await ctx.tenant(async (tx) => {
        const { planId, isDefault, backgroundOpacity, ...rest } = input;
        if (isDefault) {
          // one default per gym (partial unique index enforces it too)
          await tx
            .update(schema.floorPlans)
            .set({ isDefault: false })
            .where(and(eq(schema.floorPlans.gymId, ctx.gym.id), ne(schema.floorPlans.id, planId)));
        }
        const patch: Record<string, unknown> = { ...rest, updatedAt: new Date().toISOString() };
        if (isDefault !== undefined) patch.isDefault = isDefault;
        if (backgroundOpacity !== undefined) patch.backgroundOpacity = String(backgroundOpacity);
        const updated = await tx
          .update(schema.floorPlans)
          .set(patch)
          .where(and(eq(schema.floorPlans.id, planId), eq(schema.floorPlans.gymId, ctx.gym.id)))
          .returning({ id: schema.floorPlans.id });
        if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      });
      return { ok: true };
    }),

  remove: tenantProcedure
    .input(z.object({ planId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      await ctx.tenant(async (tx) => {
        // units and zones keep existing, they just lose their placement
        await tx
          .update(schema.equipmentUnits)
          .set({ floorPlanId: null, xCm: null, yCm: null })
          .where(eq(schema.equipmentUnits.floorPlanId, input.planId));
        await tx.delete(schema.floorPlans).where(
          and(eq(schema.floorPlans.id, input.planId), eq(schema.floorPlans.gymId, ctx.gym.id)),
        );
      });
      await ctx.audit('floorplan.delete', 'floor_plan', input.planId);
      return { ok: true };
    }),

  /** Place or move one machine. Called on drag-end, so it must be cheap. */
  placeUnit: tenantProcedure
    .input(
      z.object({
        unitId: z.string().uuid(),
        planId: z.string().uuid(),
        xCm: z.number().int().min(0).max(30000),
        yCm: z.number().int().min(0).max(30000),
        rotationDeg: z.number().int().min(0).max(359).default(0),
        zoneId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      await ctx.tenant(async (tx) => {
        const plan = await tx
          .select({ id: schema.floorPlans.id })
          .from(schema.floorPlans)
          .where(and(eq(schema.floorPlans.id, input.planId), eq(schema.floorPlans.gymId, ctx.gym.id)))
          .limit(1);
        if (!plan[0]) throw new TRPCError({ code: 'NOT_FOUND' });
        const updated = await tx
          .update(schema.equipmentUnits)
          .set({
            floorPlanId: input.planId,
            xCm: input.xCm,
            yCm: input.yCm,
            rotationDeg: input.rotationDeg,
            ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
          })
          .where(and(eq(schema.equipmentUnits.id, input.unitId), eq(schema.equipmentUnits.gymId, ctx.gym.id)))
          .returning({ id: schema.equipmentUnits.id });
        if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      });
      return { ok: true };
    }),

  unplaceUnit: tenantProcedure
    .input(z.object({ unitId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      await ctx.tenant((tx) =>
        tx
          .update(schema.equipmentUnits)
          .set({ floorPlanId: null, xCm: null, yCm: null })
          .where(and(eq(schema.equipmentUnits.id, input.unitId), eq(schema.equipmentUnits.gymId, ctx.gym.id))),
      );
      return { ok: true };
    }),

  /** Units that exist but aren't on a plan yet — the editor's palette. */
  unplacedUnits: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('floorplan.manage');
    return ctx.tenant((tx) =>
      tx
        .select({
          unitId: schema.equipmentUnits.id,
          tagCode: schema.equipmentUnits.tagCode,
          status: schema.equipmentUnits.status,
          modelId: schema.equipmentModels.id,
          modelName: schema.equipmentModels.name,
          category: schema.equipmentModels.category,
          widthCm: schema.equipmentModels.footprintWCm,
          heightCm: schema.equipmentModels.footprintHCm,
        })
        .from(schema.equipmentUnits)
        .innerJoin(schema.equipmentModels, eq(schema.equipmentModels.id, schema.equipmentUnits.modelId))
        .where(and(eq(schema.equipmentUnits.gymId, ctx.gym.id), isNull(schema.equipmentUnits.floorPlanId)))
        .orderBy(asc(schema.equipmentModels.name)),
    );
  }),

  saveZone: tenantProcedure
    .input(
      z.object({
        zoneId: z.string().uuid().optional(),
        planId: z.string().uuid(),
        name: z.string().min(1).max(60),
        xCm: z.number().int().min(0).max(30000),
        yCm: z.number().int().min(0).max(30000),
        widthCm: z.number().int().min(20).max(30000),
        heightCm: z.number().int().min(20).max(30000),
        color: hex.default('#5B6472'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      const id = input.zoneId ?? uuidv7();
      await ctx.tenant(async (tx) => {
        const values = {
          floorPlanId: input.planId,
          name: input.name,
          xCm: input.xCm,
          yCm: input.yCm,
          widthCm: input.widthCm,
          heightCm: input.heightCm,
          color: input.color,
        };
        if (input.zoneId) {
          await tx
            .update(schema.gymZones)
            .set(values)
            .where(and(eq(schema.gymZones.id, input.zoneId), eq(schema.gymZones.gymId, ctx.gym.id)));
        } else {
          await tx.insert(schema.gymZones).values({ id, gymId: ctx.gym.id, ...values });
        }
      });
      return { id };
    }),

  deleteZone: tenantProcedure
    .input(z.object({ zoneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('floorplan.manage');
      await ctx.tenant(async (tx) => {
        await tx
          .update(schema.equipmentUnits)
          .set({ zoneId: null })
          .where(eq(schema.equipmentUnits.zoneId, input.zoneId));
        await tx
          .delete(schema.gymZones)
          .where(and(eq(schema.gymZones.id, input.zoneId), eq(schema.gymZones.gymId, ctx.gym.id)));
      });
      return { ok: true };
    }),

  // --- member wayfinding ---------------------------------------------------

  /** "Where is it?" for one exercise. */
  locate: tenantProcedure
    .input(z.object({ exerciseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('floorplan.read');
      return ctx.tenant((tx) => locateExercise(tx, input.exerciseId));
    }),

  /** Ordered pins for a program day — the member's route for today. */
  workoutRoute: tenantProcedure
    .input(z.object({ programVersionId: z.string().uuid(), dayId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await ctx.allow('floorplan.read');
      return ctx.tenant(async (tx) => {
        const blocks = await readVersionTree(tx, input.programVersionId);
        const day = blocks
          .flatMap((b) => b.weeks.flatMap((w) => w.days))
          .find((d) => d.id === input.dayId);
        if (!day) throw new TRPCError({ code: 'NOT_FOUND' });
        const exerciseIds = day.items.map((i) => i.exerciseId);
        const located = await locateMany(tx, exerciseIds);
        const planId = located.find((l) => l.planId)?.planId ?? null;
        const plan = planId ? await readPlan(tx, planId) : null;
        return { plan, stops: located };
      });
    }),
});
