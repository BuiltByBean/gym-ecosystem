import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';

function financialResource(ctx: { gym: { settings: schema.GymSettings } }) {
  return { type: 'money', adminFinancials: ctx.gym.settings.adminFinancials === true };
}

export const moneyRouter = router({
  rateCards: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('rate.read', financialResource(ctx));
    return ctx.tenant((tx) =>
      tx
        .select({
          card: schema.rateCards,
          sessionTypeName: schema.sessionTypes.name,
          trainerName: schema.users.displayName,
        })
        .from(schema.rateCards)
        .leftJoin(schema.sessionTypes, eq(schema.sessionTypes.id, schema.rateCards.sessionTypeId))
        .leftJoin(schema.users, eq(schema.users.id, schema.rateCards.trainerUserId))
        .where(eq(schema.rateCards.gymId, ctx.gym.id))
        .orderBy(desc(schema.rateCards.effectiveAt)),
    );
  }),

  /** New card supersedes the open card of the exact same scope tuple. History is never edited. */
  rateCardCreate: tenantProcedure
    .input(
      z.object({
        scope: z.enum(['session_type', 'trainer', 'trainer_session_type']),
        sessionTypeId: z.string().uuid().nullish(),
        trainerUserId: z.string().uuid().nullish(),
        amountCents: z.number().int().min(0).max(10_000_00),
        effectiveAt: z.string().datetime().optional(),
        reason: z.string().max(300).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('rate.manage', financialResource(ctx));
      const needsSt = input.scope === 'session_type' || input.scope === 'trainer_session_type';
      const needsTr = input.scope === 'trainer' || input.scope === 'trainer_session_type';
      if (needsSt !== (input.sessionTypeId != null) || needsTr !== (input.trainerUserId != null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Scope fields do not match the scope' });
      }
      const effectiveAt = input.effectiveAt ?? new Date().toISOString();
      const id = uuidv7();
      await ctx.tenant(async (tx) => {
        const conds = [
          eq(schema.rateCards.gymId, ctx.gym.id),
          eq(schema.rateCards.scope, input.scope),
          isNull(schema.rateCards.supersededAt),
        ];
        if (input.sessionTypeId) conds.push(eq(schema.rateCards.sessionTypeId, input.sessionTypeId));
        else conds.push(isNull(schema.rateCards.sessionTypeId));
        if (input.trainerUserId) conds.push(eq(schema.rateCards.trainerUserId, input.trainerUserId));
        else conds.push(isNull(schema.rateCards.trainerUserId));
        await tx.update(schema.rateCards).set({ supersededAt: effectiveAt }).where(and(...conds));
        await tx.insert(schema.rateCards).values({
          id,
          gymId: ctx.gym.id,
          scope: input.scope,
          sessionTypeId: input.sessionTypeId ?? null,
          trainerUserId: input.trainerUserId ?? null,
          amountCents: input.amountCents,
          currency: ctx.gym.currency,
          effectiveAt,
          createdBy: ctx.user.id,
          reason: input.reason ?? null,
        });
      });
      await ctx.audit('rate.create', 'rate_card', id, { scope: input.scope, amountCents: input.amountCents });
      return { id };
    }),

  packages: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('package.read', { type: 'package' });
    return ctx.tenant((tx) =>
      tx.select().from(schema.packages).where(eq(schema.packages.gymId, ctx.gym.id)).orderBy(asc(schema.packages.name)),
    );
  }),

  packageSave: tenantProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        sessionTypeIds: z.array(z.string().uuid()).max(10).default([]),
        quantity: z.number().int().min(1).max(500),
        priceCents: z.number().int().min(0).max(100_000_00),
        expiresDays: z.number().int().min(1).max(3650).nullish(),
        transferable: z.boolean().default(false),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('package.manage', financialResource(ctx));
      const id = input.id ?? uuidv7();
      await ctx.tenant(async (tx) => {
        if (input.id) {
          const { id: _, ...patch } = input;
          await tx.update(schema.packages).set({ ...patch, expiresDays: patch.expiresDays ?? null }).where(eq(schema.packages.id, input.id));
        } else {
          await tx.insert(schema.packages).values({ ...input, id, gymId: ctx.gym.id, expiresDays: input.expiresDays ?? null });
        }
      });
      await ctx.audit('package.save', 'package', id);
      return { id };
    }),

  /** Sell via the dev payment provider (Stripe adapter lands with credentials —
   *  docs/OPEN_QUESTIONS.md #1). Money math is real; the charge is simulated. */
  sell: tenantProcedure
    .input(z.object({ packageId: z.string().uuid(), memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('package.sell');
      return ctx.tenant(async (tx) => {
        const pkgRows = await tx.select().from(schema.packages).where(eq(schema.packages.id, input.packageId)).limit(1);
        const pkg = pkgRows[0];
        if (!pkg || !pkg.active) throw new TRPCError({ code: 'NOT_FOUND' });

        const paymentId = uuidv7();
        await tx.insert(schema.payments).values({
          id: paymentId,
          gymId: ctx.gym.id,
          memberId: input.memberId,
          amountCents: pkg.priceCents,
          currency: ctx.gym.currency,
          purpose: 'package',
          provider: 'dev',
          providerRef: `dev_${paymentId.slice(0, 8)}`,
          status: 'paid',
        });
        const purchaseId = uuidv7();
        await tx.insert(schema.packagePurchases).values({
          id: purchaseId,
          gymId: ctx.gym.id,
          packageId: pkg.id,
          memberId: input.memberId,
          pricePaidCents: pkg.priceCents,
          paymentId,
          expiresAt: pkg.expiresDays ? new Date(Date.now() + pkg.expiresDays * 86400_000).toISOString() : null,
        });
        await tx.insert(schema.packageLedger).values({
          id: uuidv7(),
          gymId: ctx.gym.id,
          purchaseId,
          memberId: input.memberId,
          delta: pkg.quantity,
          kind: 'purchase',
          createdBy: ctx.user.id,
        });
        await ctx.audit('package.sell', 'package_purchase', purchaseId, {
          packageId: pkg.id,
          memberId: input.memberId,
          priceCents: pkg.priceCents,
        });
        return { purchaseId };
      });
    }),

  memberPackages: tenantProcedure
    .input(z.object({ memberId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const memberId = input.memberId ?? ctx.actor.memberId;
      if (!memberId) return [];
      const isSelf = memberId === ctx.actor.memberId;
      await ctx.allow('package.read', { type: 'package', memberId: isSelf ? memberId : undefined });
      return ctx.tenant(async (tx) => {
        const result = await tx.execute(sql`
          SELECT pp.id, pp.purchased_at, pp.expires_at, pp.price_paid_cents,
                 p.name, p.quantity,
                 coalesce((SELECT sum(delta) FROM package_ledger pl WHERE pl.purchase_id = pp.id), 0)::int AS balance
          FROM package_purchases pp
          JOIN packages p ON p.id = pp.package_id
          WHERE pp.member_id = ${memberId}
          ORDER BY pp.purchased_at DESC
        `);
        return result.rows as Array<{
          id: string;
          purchased_at: string;
          expires_at: string | null;
          price_paid_cents: number;
          name: string;
          quantity: number;
          balance: number;
        }>;
      });
    }),

  ledger: tenantProcedure
    .input(z.object({ purchaseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.tenant(async (tx) => {
        const purchase = await tx
          .select()
          .from(schema.packagePurchases)
          .where(eq(schema.packagePurchases.id, input.purchaseId))
          .limit(1);
        if (!purchase[0]) throw new TRPCError({ code: 'NOT_FOUND' });
        const isSelf = purchase[0].memberId === ctx.actor.memberId;
        await ctx.allow('ledger.read', {
          ...financialResource(ctx),
          memberId: isSelf ? purchase[0].memberId : undefined,
        });
        return tx
          .select()
          .from(schema.packageLedger)
          .where(eq(schema.packageLedger.purchaseId, input.purchaseId))
          .orderBy(asc(schema.packageLedger.createdAt));
      });
    }),

  payments: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('ledger.read', financialResource(ctx));
    return ctx.tenant((tx) =>
      tx
        .select({
          payment: schema.payments,
          firstName: schema.members.firstName,
          lastName: schema.members.lastName,
        })
        .from(schema.payments)
        .innerJoin(schema.members, eq(schema.members.id, schema.payments.memberId))
        .where(eq(schema.payments.gymId, ctx.gym.id))
        .orderBy(desc(schema.payments.createdAt))
        .limit(100),
    );
  }),
});
