import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { decryptSensitive, encryptSensitive, schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';
import { assignedMemberIds, createInvite, frontDeskMemberView, memberFacts, notifyUsers } from '../services/people.js';

const memberPatch = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  email: z.string().email().nullish(),
  phone: z.string().max(40).nullish(),
  status: z.enum(['prospect', 'active', 'frozen', 'inactive', 'cancelled']).optional(),
  membershipType: z.string().max(80).nullish(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  emergencyName: z.string().max(120).nullish(),
  emergencyPhone: z.string().max(40).nullish(),
  goalsNote: z.string().max(4000).nullish(),
  preferredTimes: z.array(z.string().max(40)).max(14).nullish(),
});

/** Fields a member may edit on their own profile. */
const SELF_EDITABLE = new Set(['phone', 'emergencyName', 'emergencyPhone', 'goalsNote', 'preferredTimes']);

function isPureFrontDesk(roles: string[]): boolean {
  return roles.includes('front_desk') && !roles.some((r) => r === 'owner' || r === 'admin' || r === 'trainer');
}

export const membersRouter = router({
  list: tenantProcedure
    .input(
      z.object({
        search: z.string().max(100).optional(),
        status: z.enum(['prospect', 'active', 'frozen', 'inactive', 'cancelled']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ctx.allow('member.list');
      return ctx.tenant(async (tx) => {
        const conds = [eq(schema.members.gymId, ctx.gym.id), isNull(schema.members.archivedAt)];
        if (input.status) conds.push(eq(schema.members.status, input.status));
        if (input.search) {
          const q = `%${input.search}%`;
          conds.push(
            or(
              ilike(schema.members.firstName, q),
              ilike(schema.members.lastName, q),
              ilike(schema.members.email, q),
            )!,
          );
        }
        // A pure trainer sees only their assigned clients.
        const roles = ctx.actor.staffRoles;
        if (roles.includes('trainer') && !roles.some((r) => r === 'owner' || r === 'admin' || r === 'front_desk')) {
          const ids = await assignedMemberIds(tx, ctx.user.id);
          if (ids.length === 0) return [];
          conds.push(inArray(schema.members.id, ids));
        }
        const rows = await tx
          .select()
          .from(schema.members)
          .where(and(...conds))
          .orderBy(schema.members.lastName, schema.members.firstName)
          .limit(500);
        return isPureFrontDesk(roles) ? rows.map(frontDeskMemberView) : rows;
      });
    }),

  get: tenantProcedure.input(z.object({ memberId: z.string().uuid() })).query(async ({ ctx, input }) => {
    return ctx.tenant(async (tx) => {
      const { member, resource } = await memberFacts(tx, input.memberId);
      if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.allow('member.read', resource, { notFound: true });

      const assignments = await tx
        .select({
          trainerUserId: schema.trainerAssignments.trainerUserId,
          startedAt: schema.trainerAssignments.startedAt,
          trainerName: schema.users.displayName,
        })
        .from(schema.trainerAssignments)
        .innerJoin(schema.users, eq(schema.users.id, schema.trainerAssignments.trainerUserId))
        .where(and(eq(schema.trainerAssignments.memberId, member.id), isNull(schema.trainerAssignments.endedAt)));

      const waiver = await tx
        .select({ id: schema.waiverSignatures.id, signedAt: schema.waiverSignatures.signedAt })
        .from(schema.waiverSignatures)
        .where(eq(schema.waiverSignatures.memberId, member.id))
        .orderBy(desc(schema.waiverSignatures.signedAt))
        .limit(1);

      const screening = await tx
        .select({ id: schema.healthScreenings.id, flagged: schema.healthScreenings.flagged })
        .from(schema.healthScreenings)
        .where(eq(schema.healthScreenings.memberId, member.id))
        .orderBy(desc(schema.healthScreenings.createdAt))
        .limit(1);

      const base = {
        ...member,
        assignedTrainers: assignments,
        waiverSigned: waiver.length > 0,
        screeningDone: screening.length > 0,
        // flag visible only to those who could read health data anyway
        screeningFlagged: undefined as boolean | undefined,
        hasLogin: member.userId != null,
      };
      const roles = ctx.actor.staffRoles;
      if (roles.includes('owner') || roles.includes('admin')) {
        base.screeningFlagged = screening[0]?.flagged;
      }
      return isPureFrontDesk(roles) && resource.memberId !== ctx.actor.memberId
        ? (frontDeskMemberView(base) as typeof base)
        : base;
    });
  }),

  create: tenantProcedure
    .input(memberPatch.extend({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.create');
      const id = uuidv7();
      await ctx.tenant((tx) =>
        tx.insert(schema.members).values({
          id,
          gymId: ctx.gym.id,
          ...input,
          email: input.email?.toLowerCase() ?? null,
          joinedAt: input.joinedAt ?? new Date().toISOString().slice(0, 10),
        }),
      );
      await ctx.audit('member.create', 'member', id);
      return { id };
    }),

  update: tenantProcedure
    .input(z.object({ memberId: z.string().uuid(), patch: memberPatch }))
    .mutation(async ({ ctx, input }) => {
      await ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('member.update', resource, { notFound: true });
        let patch: Record<string, unknown> = { ...input.patch };
        // members editing themselves: restricted field set
        const isStaff = ctx.actor.staffRoles.some((r) => r === 'owner' || r === 'admin');
        if (!isStaff) {
          patch = Object.fromEntries(Object.entries(patch).filter(([k]) => SELF_EDITABLE.has(k)));
        }
        if (patch.email) patch.email = String(patch.email).toLowerCase();
        await tx
          .update(schema.members)
          .set({ ...patch, updatedAt: new Date().toISOString() })
          .where(eq(schema.members.id, member.id));
      });
      await ctx.audit('member.update', 'member', input.memberId, { fields: Object.keys(input.patch) });
      return { ok: true };
    }),

  archive: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.archive');
      await ctx.tenant((tx) =>
        tx
          .update(schema.members)
          .set({ archivedAt: new Date().toISOString(), status: 'cancelled' })
          .where(eq(schema.members.id, input.memberId)),
      );
      await ctx.audit('member.archive', 'member', input.memberId);
      return { ok: true };
    }),

  invite: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.update', { type: 'member', memberId: input.memberId });
      return ctx.tenant(async (tx) => {
        const { member } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        if (!member.email) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Member has no email on file' });
        if (member.userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Member already has a login' });
        return createInvite(tx, {
          gymId: ctx.gym.id,
          email: member.email,
          kind: 'member',
          memberId: member.id,
          invitedBy: ctx.user.id,
        });
      });
    }),

  assignTrainer: tenantProcedure
    .input(z.object({ memberId: z.string().uuid(), trainerUserId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.update', { type: 'member', memberId: input.memberId });
      await ctx.tenant(async (tx) => {
        const { member } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx
          .update(schema.trainerAssignments)
          .set({ endedAt: new Date().toISOString() })
          .where(and(eq(schema.trainerAssignments.memberId, member.id), isNull(schema.trainerAssignments.endedAt)));
        if (input.trainerUserId) {
          await tx.insert(schema.trainerAssignments).values({
            id: uuidv7(),
            gymId: ctx.gym.id,
            memberId: member.id,
            trainerUserId: input.trainerUserId,
            source: 'manual',
          });
          // Spec §3: default health grant for the assigned trainer, member-revocable.
          await tx.insert(schema.memberTrainerGrants).values({
            id: uuidv7(),
            gymId: ctx.gym.id,
            memberId: member.id,
            trainerUserId: input.trainerUserId,
            scope: 'health',
          });
          await notifyUsers(tx, ctx.gym.id, [input.trainerUserId], {
            kind: 'client_assigned',
            title: `New client: ${member.firstName} ${member.lastName}`,
            data: { memberId: member.id },
          });
        }
      });
      await ctx.audit('member.assign_trainer', 'member', input.memberId, {
        trainerUserId: input.trainerUserId,
      });
      return { ok: true };
    }),

  // --- member-controlled grants ------------------------------------------

  myGrants: tenantProcedure.query(async ({ ctx }) => {
    if (!ctx.actor.memberId) return [];
    await ctx.allow('grant.read', { type: 'grant', memberId: ctx.actor.memberId });
    return ctx.tenant((tx) =>
      tx
        .select({
          id: schema.memberTrainerGrants.id,
          trainerUserId: schema.memberTrainerGrants.trainerUserId,
          scope: schema.memberTrainerGrants.scope,
          grantedAt: schema.memberTrainerGrants.grantedAt,
          revokedAt: schema.memberTrainerGrants.revokedAt,
          trainerName: schema.users.displayName,
        })
        .from(schema.memberTrainerGrants)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberTrainerGrants.trainerUserId))
        .where(eq(schema.memberTrainerGrants.memberId, ctx.actor.memberId!)),
    );
  }),

  setGrant: tenantProcedure
    .input(
      z.object({
        trainerUserId: z.string().uuid(),
        scope: z.enum(['health', 'progress_photos']),
        granted: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'FORBIDDEN' });
      await ctx.allow('grant.manage', { type: 'grant', memberId });
      await ctx.tenant(async (tx) => {
        if (input.granted) {
          await tx.insert(schema.memberTrainerGrants).values({
            id: uuidv7(),
            gymId: ctx.gym.id,
            memberId,
            trainerUserId: input.trainerUserId,
            scope: input.scope,
          });
        } else {
          await tx
            .update(schema.memberTrainerGrants)
            .set({ revokedAt: new Date().toISOString() })
            .where(
              and(
                eq(schema.memberTrainerGrants.memberId, memberId),
                eq(schema.memberTrainerGrants.trainerUserId, input.trainerUserId),
                eq(schema.memberTrainerGrants.scope, input.scope),
                isNull(schema.memberTrainerGrants.revokedAt),
              ),
            );
        }
      });
      await ctx.audit('grant.change', 'member', memberId, { ...input });
      return { ok: true };
    }),

  // --- health: limitations + screening (encrypted, grant-gated, audited) --

  limitations: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('health.read', resource, { notFound: true });
        const rows = await tx
          .select()
          .from(schema.memberLimitations)
          .where(eq(schema.memberLimitations.memberId, member.id));
        return rows.map((r) => ({
          id: r.id,
          description: decryptSensitive<string>(r.descriptionEnc),
          excludedPatternIds: r.excludedPatternIds,
          excludedExerciseIds: r.excludedExerciseIds,
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
        }));
      });
    }),

  limitationCreate: tenantProcedure
    .input(
      z.object({
        memberId: z.string().uuid(),
        description: z.string().min(1).max(2000),
        excludedPatternIds: z.array(z.string().uuid()).max(20).default([]),
        excludedExerciseIds: z.array(z.string().uuid()).max(50).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('health.write', resource, { notFound: true });
        const id = uuidv7();
        await tx.insert(schema.memberLimitations).values({
          id,
          gymId: ctx.gym.id,
          memberId: member.id,
          descriptionEnc: encryptSensitive(input.description),
          excludedPatternIds: input.excludedPatternIds,
          excludedExerciseIds: input.excludedExerciseIds,
          createdBy: ctx.user.id,
        });
        return { id };
      });
    }),

  limitationResolve: tenantProcedure
    .input(z.object({ memberId: z.string().uuid(), limitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('health.write', resource, { notFound: true });
        await tx
          .update(schema.memberLimitations)
          .set({ resolvedAt: new Date().toISOString() })
          .where(and(eq(schema.memberLimitations.id, input.limitationId), eq(schema.memberLimitations.memberId, member.id)));
        return { ok: true };
      });
    }),

  screeningTemplate: tenantProcedure.query(async ({ ctx }) => {
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.healthScreeningTemplates)
        .where(eq(schema.healthScreeningTemplates.active, true))
        .orderBy(desc(schema.healthScreeningTemplates.version));
      // gym-specific template wins over the platform default
      return rows.find((r) => r.gymId === ctx.gym.id) ?? rows.find((r) => r.gymId === null) ?? null;
    });
  }),

  screeningSubmit: tenantProcedure
    .input(z.object({ templateId: z.string().uuid(), answers: z.record(z.string(), z.boolean()) }))
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only members submit screenings' });
      await ctx.allow('health.write', { type: 'screening', memberId });
      return ctx.tenant(async (tx) => {
        const tmplRows = await tx
          .select()
          .from(schema.healthScreeningTemplates)
          .where(eq(schema.healthScreeningTemplates.id, input.templateId))
          .limit(1);
        const tmpl = tmplRows[0];
        if (!tmpl) throw new TRPCError({ code: 'NOT_FOUND' });
        const flagged = tmpl.questions.some((q) => q.flagOnYes && input.answers[q.key] === true);
        const id = uuidv7();
        await tx.insert(schema.healthScreenings).values({
          id,
          gymId: ctx.gym.id,
          memberId,
          templateId: tmpl.id,
          answersEnc: encryptSensitive(input.answers),
          flagged,
        });
        return { id, flagged };
      });
    }),

  screeningGet: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('health.read', resource, { notFound: true });
        const rows = await tx
          .select()
          .from(schema.healthScreenings)
          .where(eq(schema.healthScreenings.memberId, member.id))
          .orderBy(desc(schema.healthScreenings.createdAt))
          .limit(1);
        const s = rows[0];
        if (!s) return null;
        const tmpl = await tx
          .select()
          .from(schema.healthScreeningTemplates)
          .where(eq(schema.healthScreeningTemplates.id, s.templateId))
          .limit(1);
        return {
          id: s.id,
          flagged: s.flagged,
          signedAt: s.signedAt,
          answers: decryptSensitive<Record<string, boolean>>(s.answersEnc),
          questions: tmpl[0]?.questions ?? [],
        };
      });
    }),

  // --- waivers ------------------------------------------------------------

  waiverTemplate: tenantProcedure.query(async ({ ctx }) => {
    return ctx.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.waiverTemplates)
        .where(eq(schema.waiverTemplates.active, true))
        .orderBy(desc(schema.waiverTemplates.version));
      return rows.find((r) => r.gymId === ctx.gym.id) ?? rows.find((r) => r.gymId === null) ?? null;
    });
  }),

  waiverTemplateUpdate: tenantProcedure
    .input(z.object({ name: z.string().min(1).max(120), bodyMd: z.string().min(1).max(50_000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('waiver.manage_templates');
      return ctx.tenant(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.waiverTemplates)
          .where(eq(schema.waiverTemplates.gymId, ctx.gym.id))
          .orderBy(desc(schema.waiverTemplates.version))
          .limit(1);
        const version = (existing[0]?.version ?? 0) + 1;
        if (existing[0]) {
          await tx
            .update(schema.waiverTemplates)
            .set({ active: false })
            .where(eq(schema.waiverTemplates.id, existing[0].id));
        }
        const id = uuidv7();
        await tx.insert(schema.waiverTemplates).values({
          id,
          gymId: ctx.gym.id,
          name: input.name,
          version,
          bodyMd: input.bodyMd,
          active: true,
        });
        await ctx.audit('waiver.template_update', 'waiver_template', id, { version });
        return { id, version };
      });
    }),

  waiverSign: tenantProcedure
    .input(
      z.object({
        templateId: z.string().uuid(),
        signedName: z.string().min(2).max(160),
        memberId: z.string().uuid().optional(), // staff-initiated (kiosk/front desk)
        signerRelationship: z.enum(['self', 'guardian']).default('self'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No member to sign for' });
      await ctx.allow('waiver.sign', { type: 'waiver', memberId });
      return ctx.tenant(async (tx) => {
        const tmplRows = await tx
          .select()
          .from(schema.waiverTemplates)
          .where(eq(schema.waiverTemplates.id, input.templateId))
          .limit(1);
        const tmpl = tmplRows[0];
        if (!tmpl) throw new TRPCError({ code: 'NOT_FOUND' });
        const id = uuidv7();
        await tx.insert(schema.waiverSignatures).values({
          id,
          gymId: ctx.gym.id,
          memberId,
          templateId: tmpl.id,
          templateVersion: tmpl.version,
          docSha256: createHash('sha256').update(tmpl.bodyMd).digest('hex'),
          signedName: input.signedName,
          signerRelationship: input.signerRelationship,
          ip: ctx.ip,
          userAgent: ctx.userAgent.slice(0, 300),
        });
        return { id };
      });
    }),

  waiverSignatures: tenantProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const { member, resource } = await memberFacts(tx, input.memberId);
        if (!member) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.allow('waiver.read_signatures', resource, { notFound: true });
        return tx
          .select()
          .from(schema.waiverSignatures)
          .where(eq(schema.waiverSignatures.memberId, member.id))
          .orderBy(desc(schema.waiverSignatures.signedAt));
      });
    }),
});
