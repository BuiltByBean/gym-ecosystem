import { TRPCError } from '@trpc/server';
import { and, asc, eq, ilike, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { availableExerciseIds } from '../services/substitution.js';

export const exercisesRouter = router({
  taxonomies: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('exercise.read');
    return ctx.tenant(async (tx) => ({
      movementPatterns: await tx.select().from(schema.movementPatterns).orderBy(asc(schema.movementPatterns.name)),
      muscles: await tx.select().from(schema.muscles).orderBy(asc(schema.muscles.name)),
      equipmentClasses: await tx.select().from(schema.equipmentClasses).orderBy(asc(schema.equipmentClasses.name)),
    }));
  }),

  list: tenantProcedure
    .input(
      z.object({
        search: z.string().max(100).optional(),
        patternId: z.string().uuid().optional(),
        onlyAvailable: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ctx.allow('exercise.read');
      return ctx.tenant(async (tx) => {
        const conds = [isNull(schema.exercises.archivedAt)];
        if (input.patternId) conds.push(eq(schema.exercises.movementPatternId, input.patternId));
        if (input.search) {
          conds.push(ilike(schema.exercises.name, `%${input.search}%`));
        }
        // RLS exposes platform rows (gym_id NULL) + this gym's rows
        const rows = await tx
          .select({
            id: schema.exercises.id,
            gymId: schema.exercises.gymId,
            name: schema.exercises.name,
            movementPatternId: schema.exercises.movementPatternId,
            equipmentClassId: schema.exercises.equipmentClassId,
            difficulty: schema.exercises.difficulty,
            videoGroupId: schema.exercises.videoGroupId,
            cues: schema.exercises.cues,
          })
          .from(schema.exercises)
          .where(and(...conds))
          .orderBy(asc(schema.exercises.name))
          .limit(500);
        const available = await availableExerciseIds(tx);
        const mapped = rows.map((r) => ({
          ...r,
          source: r.gymId === null ? ('platform' as const) : ('gym' as const),
          available: available.has(r.id),
        }));
        return input.onlyAvailable ? mapped.filter((m) => m.available) : mapped;
      });
    }),

  get: tenantProcedure.input(z.object({ exerciseId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await ctx.allow('exercise.read');
    return ctx.tenant(async (tx) => {
      const rows = await tx.select().from(schema.exercises).where(eq(schema.exercises.id, input.exerciseId)).limit(1);
      const exercise = rows[0];
      if (!exercise) throw new TRPCError({ code: 'NOT_FOUND' });

      const muscles = await tx
        .select({
          muscleId: schema.exerciseMuscles.muscleId,
          role: schema.exerciseMuscles.role,
          name: schema.muscles.name,
          region: schema.muscles.region,
        })
        .from(schema.exerciseMuscles)
        .innerJoin(schema.muscles, eq(schema.muscles.id, schema.exerciseMuscles.muscleId))
        .where(eq(schema.exerciseMuscles.exerciseId, exercise.id));

      const outEdges = await tx
        .select({
          id: schema.exerciseRelationships.id,
          kind: schema.exerciseRelationships.kind,
          rank: schema.exerciseRelationships.rank,
          reason: schema.exerciseRelationships.reason,
          otherId: schema.exerciseRelationships.toExerciseId,
          otherName: schema.exercises.name,
        })
        .from(schema.exerciseRelationships)
        .innerJoin(schema.exercises, eq(schema.exercises.id, schema.exerciseRelationships.toExerciseId))
        .where(eq(schema.exerciseRelationships.fromExerciseId, exercise.id));
      // progression_of read backwards = regressions (docs/DECISIONS.md D-005)
      const inEdges = await tx
        .select({
          id: schema.exerciseRelationships.id,
          kind: schema.exerciseRelationships.kind,
          rank: schema.exerciseRelationships.rank,
          reason: schema.exerciseRelationships.reason,
          otherId: schema.exerciseRelationships.fromExerciseId,
          otherName: schema.exercises.name,
        })
        .from(schema.exerciseRelationships)
        .innerJoin(schema.exercises, eq(schema.exercises.id, schema.exerciseRelationships.fromExerciseId))
        .where(eq(schema.exerciseRelationships.toExerciseId, exercise.id));

      const models = await tx
        .select({ modelId: schema.equipmentExerciseLinks.modelId, name: schema.equipmentModels.name })
        .from(schema.equipmentExerciseLinks)
        .innerJoin(schema.equipmentModels, eq(schema.equipmentModels.id, schema.equipmentExerciseLinks.modelId))
        .where(eq(schema.equipmentExerciseLinks.exerciseId, exercise.id));

      let currentVideoMediaId: string | null = null;
      if (exercise.videoGroupId) {
        const vg = await tx
          .select({ currentVideoId: schema.videoGroups.currentVideoId })
          .from(schema.videoGroups)
          .where(eq(schema.videoGroups.id, exercise.videoGroupId))
          .limit(1);
        if (vg[0]?.currentVideoId) {
          const v = await tx
            .select({ mediaId: schema.videos.mediaId, status: schema.videos.status })
            .from(schema.videos)
            .where(eq(schema.videos.id, vg[0].currentVideoId))
            .limit(1);
          if (v[0]?.status === 'published') currentVideoMediaId = v[0].mediaId;
        }
      }

      const available = await availableExerciseIds(tx);
      return {
        ...exercise,
        source: exercise.gymId === null ? ('platform' as const) : ('gym' as const),
        available: available.has(exercise.id),
        muscles,
        substitutes: outEdges.filter((e) => e.kind === 'substitutes_for'),
        progressions: inEdges.filter((e) => e.kind === 'progression_of'), // harder versions
        regressions: outEdges.filter((e) => e.kind === 'progression_of'), // this progresses FROM (easier)
        models,
        currentVideoMediaId,
      };
    });
  }),

  create: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(160),
        movementPatternId: z.string().uuid(),
        equipmentClassId: z.string().uuid().nullish(),
        difficulty: z.number().int().min(1).max(5).default(2),
        cues: z.array(z.string().max(300)).max(10).default([]),
        muscles: z.array(z.object({ muscleId: z.string().uuid(), role: z.enum(['primary', 'secondary']) })).max(12).default([]),
        forkedFrom: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('exercise.manage');
      const id = uuidv7();
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.exercises).values({
          id,
          gymId: ctx.gym.id,
          name: input.name,
          movementPatternId: input.movementPatternId,
          equipmentClassId: input.equipmentClassId ?? null,
          difficulty: input.difficulty,
          cues: input.cues,
          forkedFrom: input.forkedFrom ?? null,
          createdBy: ctx.user.id,
        });
        if (input.muscles.length) {
          await tx.insert(schema.exerciseMuscles).values(
            input.muscles.map((m) => ({ id: uuidv7(), gymId: ctx.gym.id, exerciseId: id, ...m })),
          );
        }
      });
      await ctx.audit('exercise.create', 'exercise', id);
      return { id };
    }),

  update: tenantProcedure
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        movementPatternId: z.string().uuid().optional(),
        equipmentClassId: z.string().uuid().nullish(),
        difficulty: z.number().int().min(1).max(5).optional(),
        cues: z.array(z.string().max(300)).max(10).optional(),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('exercise.manage');
      await ctx.tenant(async (tx) => {
        const rows = await tx
          .select({ gymId: schema.exercises.gymId })
          .from(schema.exercises)
          .where(eq(schema.exercises.id, input.exerciseId))
          .limit(1);
        if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND' });
        if (rows[0].gymId !== ctx.gym.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform exercises are read-only — fork it into your gym library first' });
        }
        const { exerciseId, archived, ...patch } = input;
        await tx
          .update(schema.exercises)
          .set({ ...patch, ...(archived !== undefined ? { archivedAt: archived ? new Date().toISOString() : null } : {}) })
          .where(eq(schema.exercises.id, exerciseId));
      });
      return { ok: true };
    }),

  fork: tenantProcedure.input(z.object({ exerciseId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.allow('exercise.manage');
    return ctx.tenant(async (tx) => {
      const rows = await tx.select().from(schema.exercises).where(eq(schema.exercises.id, input.exerciseId)).limit(1);
      const src = rows[0];
      if (!src) throw new TRPCError({ code: 'NOT_FOUND' });
      const id = uuidv7();
      await tx.insert(schema.exercises).values({
        id,
        gymId: ctx.gym.id,
        name: `${src.name} (gym)`,
        movementPatternId: src.movementPatternId,
        equipmentClassId: src.equipmentClassId,
        difficulty: src.difficulty,
        cues: src.cues,
        forkedFrom: src.id,
        createdBy: ctx.user.id,
      });
      const muscles = await tx
        .select()
        .from(schema.exerciseMuscles)
        .where(eq(schema.exerciseMuscles.exerciseId, src.id));
      if (muscles.length) {
        await tx.insert(schema.exerciseMuscles).values(
          muscles.map((m) => ({ id: uuidv7(), gymId: ctx.gym.id, exerciseId: id, muscleId: m.muscleId, role: m.role })),
        );
      }
      return { id };
    });
  }),

  edgeSet: tenantProcedure
    .input(
      z.object({
        fromExerciseId: z.string().uuid(),
        toExerciseId: z.string().uuid(),
        kind: z.enum(['substitutes_for', 'progression_of']),
        rank: z.number().int().min(1).max(1000).default(100),
        reason: z.string().max(300).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('exercise.manage');
      if (input.fromExerciseId === input.toExerciseId) throw new TRPCError({ code: 'BAD_REQUEST' });
      const id = uuidv7();
      await ctx.tenant(async (tx) => {
        await tx
          .delete(schema.exerciseRelationships)
          .where(
            and(
              eq(schema.exerciseRelationships.gymId, ctx.gym.id),
              eq(schema.exerciseRelationships.fromExerciseId, input.fromExerciseId),
              eq(schema.exerciseRelationships.toExerciseId, input.toExerciseId),
              eq(schema.exerciseRelationships.kind, input.kind),
            ),
          );
        await tx.insert(schema.exerciseRelationships).values({
          id,
          gymId: ctx.gym.id,
          fromExerciseId: input.fromExerciseId,
          toExerciseId: input.toExerciseId,
          kind: input.kind,
          rank: input.rank,
          reason: input.reason ?? null,
          createdBy: ctx.user.id,
        });
      });
      return { id };
    }),

  edgeRemove: tenantProcedure.input(z.object({ edgeId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.allow('exercise.manage');
    await ctx.tenant(async (tx) => {
      const deleted = await tx
        .delete(schema.exerciseRelationships)
        .where(and(eq(schema.exerciseRelationships.id, input.edgeId), eq(schema.exerciseRelationships.gymId, ctx.gym.id)))
        .returning({ id: schema.exerciseRelationships.id });
      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Edge not found (platform edges cannot be removed)' });
      }
    });
    return { ok: true };
  }),

  /** Attach an uploaded video as a new pending version for an exercise demo. */
  attachVideo: tenantProcedure
    .input(z.object({ exerciseId: z.string().uuid(), mediaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('video.upload');
      return ctx.tenant(async (tx) => {
        const rows = await tx.select().from(schema.exercises).where(eq(schema.exercises.id, input.exerciseId)).limit(1);
        const exercise = rows[0];
        if (!exercise) throw new TRPCError({ code: 'NOT_FOUND' });
        if (exercise.gymId !== ctx.gym.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Fork the platform exercise to attach your own demo' });
        }
        let groupId = exercise.videoGroupId;
        if (!groupId) {
          groupId = uuidv7();
          await tx.insert(schema.videoGroups).values({ id: groupId, gymId: ctx.gym.id, kind: 'exercise_demo' });
          await tx.update(schema.exercises).set({ videoGroupId: groupId }).where(eq(schema.exercises.id, exercise.id));
        }
        const versions = await tx
          .select({ version: schema.videos.version })
          .from(schema.videos)
          .where(eq(schema.videos.groupId, groupId));
        const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
        const videoId = uuidv7();
        await tx.insert(schema.videos).values({
          id: videoId,
          gymId: ctx.gym.id,
          groupId,
          version,
          mediaId: input.mediaId,
          status: 'pending_review',
          uploadedBy: ctx.user.id,
        });
        return { videoId, version };
      });
    }),

  pendingVideos: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('video.publish');
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select({
          videoId: schema.videos.id,
          version: schema.videos.version,
          mediaId: schema.videos.mediaId,
          createdAt: schema.videos.createdAt,
          groupId: schema.videos.groupId,
          uploaderName: schema.users.displayName,
          exerciseName: schema.exercises.name,
          exerciseId: schema.exercises.id,
        })
        .from(schema.videos)
        .leftJoin(schema.users, eq(schema.users.id, schema.videos.uploadedBy))
        .leftJoin(schema.exercises, eq(schema.exercises.videoGroupId, schema.videos.groupId))
        .where(and(eq(schema.videos.gymId, ctx.gym.id), eq(schema.videos.status, 'pending_review')));
      return rows;
    });
  }),

  /** Admin publishes: version becomes current, prior current retires (spec §4.5). */
  publishVideo: tenantProcedure
    .input(z.object({ videoId: z.string().uuid(), approve: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('video.publish');
      await ctx.tenant(async (tx) => {
        const rows = await tx.select().from(schema.videos).where(eq(schema.videos.id, input.videoId)).limit(1);
        const video = rows[0];
        if (!video) throw new TRPCError({ code: 'NOT_FOUND' });
        if (!input.approve) {
          await tx.update(schema.videos).set({ status: 'retired' }).where(eq(schema.videos.id, video.id));
          return;
        }
        await tx
          .update(schema.videos)
          .set({ status: 'retired' })
          .where(and(eq(schema.videos.groupId, video.groupId), eq(schema.videos.status, 'published')));
        await tx
          .update(schema.videos)
          .set({ status: 'published', publishedBy: ctx.user.id })
          .where(eq(schema.videos.id, video.id));
        await tx
          .update(schema.videoGroups)
          .set({ currentVideoId: video.id })
          .where(eq(schema.videoGroups.id, video.groupId));
      });
      await ctx.audit('video.publish', 'video', input.videoId, { approved: input.approve });
      return { ok: true };
    }),
});
