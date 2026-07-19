import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createFixture, type Fixture } from './fixtures.js';

/** Global tables intentionally without RLS (documented in migrations 0002). */
const RLS_EXCEPTIONS = new Set(['invites']);

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture();
}, 180_000);

afterAll(async () => {
  await fx.destroy();
});

async function expectNotFound(promise: Promise<unknown>, label: string): Promise<void> {
  try {
    await promise;
    expect.fail(`${label}: expected NOT_FOUND, got success`);
  } catch (err) {
    if (err instanceof TRPCError) {
      // 404, never 403 — existence must not leak across tenants (D-003)
      expect(err.code, `${label}: expected NOT_FOUND, got ${err.code}`).toBe('NOT_FOUND');
    } else {
      throw err;
    }
  }
}

describe('RLS registry', () => {
  it('every table carrying gym_id has forced row security and at least one policy', async () => {
    const tables = await fx.db.adminQuery(`
      SELECT c.table_name,
             cls.relrowsecurity,
             cls.relforcerowsecurity,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.table_name)::int AS policies
      FROM information_schema.columns c
      JOIN pg_class cls ON cls.relname = c.table_name AND cls.relkind = 'r'
      JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = 'public'
      WHERE c.column_name = 'gym_id' AND c.table_schema = 'public'
    `);
    expect(tables.rows.length).toBeGreaterThan(40);
    for (const row of tables.rows as Array<{ table_name: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }>) {
      if (RLS_EXCEPTIONS.has(row.table_name)) continue;
      expect(row.relrowsecurity, `${row.table_name} must have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.table_name} must have RLS forced`).toBe(true);
      expect(row.policies, `${row.table_name} must have policies`).toBeGreaterThan(0);
    }
  });

  it('raw probe: tenant A sees zero rows of tenant B in every gym_id table', async () => {
    const tables = await fx.db.adminQuery(`
      SELECT c.table_name FROM information_schema.columns c
      WHERE c.column_name = 'gym_id' AND c.table_schema = 'public'
    `);
    for (const { table_name } of tables.rows as Array<{ table_name: string }>) {
      if (RLS_EXCEPTIONS.has(table_name)) continue;
      const count = await fx.db.bundle.withTenant(
        { gymId: fx.a.gym.id, userId: fx.a.users.owner.id },
        async (tx) => {
          const res = await tx.execute(
            // table name comes from information_schema, not user input
            `SELECT count(*)::int AS n FROM "${table_name}" WHERE gym_id = '${fx.b.gym.id}'` as never,
          );
          return (res.rows[0] as { n: number }).n;
        },
      );
      expect(count, `gym A must see 0 of gym B's rows in ${table_name}`).toBe(0);
    }
  });

  it('no tenant context = zero rows (fail closed)', async () => {
    const count = await fx.db.bundle.withTenant({ gymId: null, userId: null }, async (tx) => {
      const res = await tx.execute(`SELECT count(*)::int AS n FROM members` as never);
      return (res.rows[0] as { n: number }).n;
    });
    expect(count).toBe(0);
  });
});

describe('cross-tenant probes through the API return 404', () => {
  it('member records', async () => {
    const aAdmin = fx.caller(fx.a, 'admin');
    await expectNotFound(aAdmin.members.get({ memberId: fx.b.memberId }), 'members.get');
    await expectNotFound(aAdmin.members.screeningGet({ memberId: fx.b.memberId }), 'screeningGet');
    await expectNotFound(aAdmin.members.limitations({ memberId: fx.b.memberId }), 'limitations');
    await expectNotFound(aAdmin.members.waiverSignatures({ memberId: fx.b.memberId }), 'waiverSignatures');
  });

  it('programs and assignments', async () => {
    const aAdmin = fx.caller(fx.a, 'admin');
    await expectNotFound(aAdmin.programs.get({ programId: fx.b.programId }), 'programs.get');
    await expectNotFound(aAdmin.programs.getTree({ programId: fx.b.programId }), 'programs.getTree');
    await expectNotFound(aAdmin.programs.todayPlan({ assignmentId: fx.b.assignmentId }), 'todayPlan');
  });

  it('equipment tags', async () => {
    const aAdmin = fx.caller(fx.a, 'admin');
    await expectNotFound(aAdmin.equipment.byTag({ tagCode: fx.b.equipment.rackTag }), 'byTag');
  });

  it('booking a trainer from another gym', async () => {
    const aAdmin = fx.caller(fx.a, 'admin');
    const monday = nextMonday();
    await expectNotFound(
      aAdmin.scheduling.book({
        trainerUserId: fx.b.trainerUserId,
        sessionTypeId: fx.a.sessionTypeId,
        startsAt: `${monday}T15:00:00.000Z`,
        memberId: fx.a.memberId,
      }),
      'book foreign trainer',
    );
  });

  it('workout history of a foreign member', async () => {
    const aTrainer = fx.caller(fx.a, 'trainer');
    await expectNotFound(aTrainer.logging.history({ memberId: fx.b.memberId }), 'history');
  });
});

describe('in-tenant permission boundaries (through real endpoints)', () => {
  it('front desk cannot read health or workout data', async () => {
    const desk = fx.caller(fx.a, 'desk');
    await expect(desk.members.screeningGet({ memberId: fx.a.memberId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(desk.logging.history({ memberId: fx.a.memberId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(desk.gym.auditLog({ limit: 10 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('front desk member list is contact-only (no goals, no DOB)', async () => {
    const desk = fx.caller(fx.a, 'desk');
    const list = await desk.members.list({});
    const mia = list.find((m) => m.id === fx.a.memberId)!;
    expect(mia).toBeDefined();
    expect((mia as Record<string, unknown>).goalsNote).toBeUndefined();
    expect((mia as Record<string, unknown>).dateOfBirth).toBeUndefined();
    expect((mia as Record<string, unknown>).phone).toBeDefined();
  });

  it('trainer with a health grant reads screenings; grant revoked = access gone', async () => {
    const member = fx.caller(fx.a, 'member');
    const trainer = fx.caller(fx.a, 'trainer');
    const template = await member.members.screeningTemplate();
    // platform template is seeded by the platform seed in dev; here there may be none
    if (template) {
      await member.members.screeningSubmit({ templateId: template.id, answers: {} });
      const viaGrant = await trainer.members.screeningGet({ memberId: fx.a.memberId });
      expect(viaGrant).not.toBeNull();
    }
    await member.members.setGrant({ trainerUserId: fx.a.trainerUserId, scope: 'health', granted: false });
    await expect(trainer.members.limitations({ memberId: fx.a.memberId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // restore for other suites
    await member.members.setGrant({ trainerUserId: fx.a.trainerUserId, scope: 'health', granted: true });
  });

  it('admin financial toggle gates rate management (B has it off)', async () => {
    const bAdmin = fx.caller(fx.b, 'admin');
    await expect(
      bAdmin.money.rateCardCreate({ scope: 'session_type', sessionTypeId: fx.b.sessionTypeId, amountCents: 5000 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const bOwner = fx.caller(fx.b, 'owner');
    const created = await bOwner.money.rateCardCreate({
      scope: 'session_type',
      sessionTypeId: fx.b.sessionTypeId,
      amountCents: 5000,
    });
    expect(created.id).toBeDefined();
  });

  it('sensitive reads land in the audit log', async () => {
    const aAdmin = fx.caller(fx.a, 'admin');
    await aAdmin.members.limitations({ memberId: fx.a.memberId });
    const audit = await fx.caller(fx.a, 'owner').gym.auditLog({ limit: 50 });
    expect(audit.some((e) => e.action === 'health.read')).toBe(true);
  });
});

function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
