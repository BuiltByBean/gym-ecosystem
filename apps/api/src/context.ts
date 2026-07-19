import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema, uuidv7, type DbBundle, type Tx } from '@gym/db';
import { AUDITED_ACTIONS, authorize, type Action, type Actor, type Resource } from '@gym/authz';
import { TRPCError } from '@trpc/server';
import { SESSION_COOKIE, lookupSession, type SessionRecord } from './auth/sessions.js';

export interface GymInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  units: 'lb' | 'kg';
  brandPrimary: string;
  brandAccent: string;
  settings: schema.GymSettings;
}

export interface Ctx {
  bundle: DbBundle;
  ip: string;
  userAgent: string;
  host: string;
  session: SessionRecord | null;
  user: { id: string; email: string; displayName: string; isPlatformAdmin: boolean } | null;
  gym: GymInfo | null;
  actor: Actor | null;
  /** Run fn inside a tenant-scoped transaction (RLS enforced). */
  tenant: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** authorize() or throw; audits sensitive actions automatically. */
  allow: (action: Action, resource?: Resource, opts?: { notFound?: boolean }) => Promise<void>;
  audit: (
    action: string,
    resourceType: string,
    resourceId?: string | null,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  setCookie: (name: string, value: string, maxAgeS: number) => void;
  clearCookie: (name: string) => void;
}

/** Host → gym, for subdomain/custom-domain tenancy. Falls back to the session's
 *  active gym in dev (localhost) or when the host is the bare platform domain. */
async function resolveGymIdFromHost(bundle: DbBundle, host: string): Promise<string | null> {
  const hostname = host.split(':')[0]?.toLowerCase() ?? '';
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return null;
  const rows = await bundle.db
    .select({ gymId: schema.tenantDomains.gymId })
    .from(schema.tenantDomains)
    .where(eq(schema.tenantDomains.hostname, hostname))
    .limit(1);
  return rows[0]?.gymId ?? null;
}

export async function createContext({ req, res }: CreateFastifyContextOptions): Promise<Ctx> {
  const bundle = getDb();
  const ip = req.ip;
  const userAgent = String(req.headers['user-agent'] ?? '');
  const host = String(req.headers.host ?? '');

  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  const token = cookies[SESSION_COOKIE] ?? '';
  const session = token ? await lookupSession(bundle, token) : null;

  let user: Ctx['user'] = null;
  let gym: GymInfo | null = null;
  let actor: Actor | null = null;

  if (session) {
    const userRows = await bundle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);
    const u = userRows[0];
    if (u) {
      user = { id: u.id, email: u.email, displayName: u.displayName, isPlatformAdmin: u.isPlatformAdmin };
    }
  }

  if (user) {
    const hostGymId = await resolveGymIdFromHost(bundle, host);
    const gymId = hostGymId ?? session?.activeGymId ?? null;
    if (gymId) {
      const loaded = await bundle.withTenant({ gymId, userId: user.id }, async (tx) => {
        const gymRows = await tx.select().from(schema.gyms).where(eq(schema.gyms.id, gymId)).limit(1);
        const g = gymRows[0];
        if (!g) return null;
        const staffRows = await tx
          .select({ role: schema.gymStaff.role })
          .from(schema.gymStaff)
          .where(
            and(
              eq(schema.gymStaff.gymId, gymId),
              eq(schema.gymStaff.userId, user!.id),
              eq(schema.gymStaff.status, 'active'),
            ),
          );
        const memberRows = await tx
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.gymId, gymId),
              eq(schema.members.userId, user!.id),
              isNull(schema.members.archivedAt),
            ),
          );
        return { g, roles: staffRows.map((r) => r.role), memberId: memberRows[0]?.id ?? null };
      });
      if (loaded) {
        gym = {
          id: loaded.g.id,
          name: loaded.g.name,
          slug: loaded.g.slug,
          timezone: loaded.g.timezone,
          currency: loaded.g.currency,
          units: loaded.g.units,
          brandPrimary: loaded.g.brandPrimary,
          brandAccent: loaded.g.brandAccent,
          settings: loaded.g.settings,
        };
        actor = {
          userId: user.id,
          isPlatformAdmin: user.isPlatformAdmin,
          staffRoles: loaded.roles,
          memberId: loaded.memberId,
        };
      }
    }
  }

  return makeCtx({
    bundle,
    ip,
    userAgent,
    host,
    session,
    user,
    gym,
    actor,
    setCookie: (name, value, maxAgeS) =>
      res.setCookie(name, value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        path: '/',
        maxAge: maxAgeS,
      }),
    clearCookie: (name) => res.clearCookie(name, { path: '/' }),
  });
}

/** Assembles the derived helpers (tenant/allow/audit) from resolved parts.
 *  createContext uses this per request; tests build contexts through the SAME
 *  code path so authorization semantics can't drift between prod and tests. */
export function makeCtx(parts: Omit<Ctx, 'tenant' | 'allow' | 'audit'>): Ctx {
  const { bundle, ip, gym, user, actor } = parts;
  const gymId = gym?.id ?? null;
  const userId = user?.id ?? null;

  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => {
    if (!gymId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No active gym' });
    return bundle.withTenant({ gymId, userId }, fn);
  };

  const audit: Ctx['audit'] = async (action, resourceType, resourceId, metadata) => {
    await bundle.withTenant({ gymId, userId }, (tx) =>
      tx.insert(schema.auditEvents).values({
        id: uuidv7(),
        gymId,
        actorUserId: userId,
        action,
        resourceType,
        resourceId: resourceId ?? null,
        ip,
        metadata: metadata ?? {},
      }),
    );
  };

  const allow: Ctx['allow'] = async (action, resource = { type: 'gym' }, opts) => {
    if (!actor) {
      throw new TRPCError({ code: userId ? 'FORBIDDEN' : 'UNAUTHORIZED' });
    }
    const decision = authorize(actor, action, resource);
    if (!decision.allowed) {
      // Cross-tenant probes and hidden resources 404 rather than 403 (docs/DECISIONS.md D-003)
      throw new TRPCError({ code: opts?.notFound ? 'NOT_FOUND' : 'FORBIDDEN' });
    }
    if (AUDITED_ACTIONS.has(action)) {
      await audit(action, resource.type, resource.memberId ?? null, { via: decision.via });
    }
  };

  return { ...parts, tenant, allow, audit };
}
