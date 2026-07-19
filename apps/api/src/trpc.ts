import { initTRPC, TRPCError } from '@trpc/server';
import type { Ctx } from './context.js';

const t = initTRPC.context<Ctx>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user, session: ctx.session } });
});

/** Requires an active gym; every domain router builds on this. */
export const tenantProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.gym || !ctx.actor) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No active gym' });
  return next({ ctx: { ...ctx, gym: ctx.gym, actor: ctx.actor } });
});
