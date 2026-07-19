import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHlcClock, ulid } from '@gym/sync';
import { uuidv7 } from '@gym/db';
import { createFixture, type Fixture } from './fixtures.js';
import { resolveRate } from '../src/services/scheduling.js';

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture();
}, 180_000);

afterAll(async () => {
  await fx.destroy();
});

function nextMonday(offsetWeeks = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

describe('substitution engine', () => {
  it('ranks curated substitutes first, equipment-aware, with reasons', async () => {
    const member = fx.caller(fx.a, 'member');
    const subs = await member.equipment.substitutes({ exerciseId: fx.platform.exercises.backSquat });
    const names = subs.map((s) => s.name);
    expect(names).toContain('Leg Press');       // curated + machine in service
    expect(names).toContain('Bodyweight Squat'); // pattern mate, no equipment needed
    expect(names).not.toContain('Goblet Squat'); // no dumbbells at this gym
    const legPress = subs.find((s) => s.name === 'Leg Press')!;
    expect(legPress.source).toBe('curated');
    expect(legPress.reason).toMatch(/spinal load/i);
    expect(legPress.availableOn).toBe('Leg Press 45');
    expect(subs.indexOf(legPress)).toBeLessThan(names.indexOf('Bodyweight Squat'));
  });

  it('member limitations filter candidates', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.members.limitationCreate({
      memberId: fx.a.memberId,
      description: 'knee flexion pain under machine load',
      excludedExerciseIds: [fx.platform.exercises.legPress],
    });
    const member = fx.caller(fx.a, 'member');
    const subs = await member.equipment.substitutes({ exerciseId: fx.platform.exercises.backSquat });
    expect(subs.map((s) => s.name)).not.toContain('Leg Press');
    // clean up: resolve the limitation so later tests see the machine again
    const lims = await admin.members.limitations({ memberId: fx.a.memberId });
    await admin.members.limitationResolve({ memberId: fx.a.memberId, limitationId: lims[0]!.id });
  });

  it('marking the last unit out of service removes availability and flags programs', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const result = await admin.equipment.unitSetStatus({
      unitId: fx.a.equipment.legPressUnitId,
      status: 'out_of_service',
      note: 'hydraulic leak',
    });
    expect(result.affected).not.toBeNull(); // last unit of the model
    const member = fx.caller(fx.a, 'member');
    const subs = await member.equipment.substitutes({ exerciseId: fx.platform.exercises.backSquat });
    expect(subs.map((s) => s.name)).not.toContain('Leg Press');
    // restore
    await admin.equipment.unitSetStatus({ unitId: fx.a.equipment.legPressUnitId, status: 'in_service' });
  });

  it('rack down → OOS trigger reports the affected program and notifies', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const result = await admin.equipment.unitSetStatus({
      unitId: fx.a.equipment.rackUnitId,
      status: 'maintenance',
    });
    expect(result.affected?.programs.map((p) => p.name)).toContain('Strength A');
    const ownerNotifs = await fx.caller(fx.a, 'owner').gym.notifications();
    expect(ownerNotifs.some((n) => n.kind === 'equipment_down')).toBe(true);
    await admin.equipment.unitSetStatus({ unitId: fx.a.equipment.rackUnitId, status: 'in_service' });
  });
});

describe('rates, packages, ledger (billing math)', () => {
  it('most specific rate card wins and is frozen onto the booking', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.money.sell({ packageId: fx.a.packageId, memberId: fx.a.memberId });

    const monday = nextMonday();
    const booking = await admin.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: `${monday}T15:00:00.000Z`,
      memberId: fx.a.memberId,
    });
    expect(booking.rateAppliedCents).toBe(9000); // trainer_session_type beats session_type

    // A raise does not rewrite history: supersede with a new trainer_session_type card
    await admin.money.rateCardCreate({
      scope: 'trainer_session_type',
      sessionTypeId: fx.a.sessionTypeId,
      trainerUserId: fx.a.trainerUserId,
      amountCents: 9500,
      reason: 'annual raise',
    });
    const booking2 = await admin.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: `${monday}T16:00:00.000Z`,
      memberId: fx.a.memberId,
    });
    expect(booking2.rateAppliedCents).toBe(9500);

    const list = await admin.scheduling.list({
      from: `${monday}T00:00:00.000Z`,
      to: `${monday}T23:59:59.000Z`,
    });
    const first = list.find((b) => b.id === booking.id)!;
    expect(first.rateAppliedCents).toBe(9000); // frozen
  });

  it('effective-dated resolution answers "what was the rate then"', async () => {
    const at2019 = await fx.db.bundle.withTenant(
      { gymId: fx.a.gym.id, userId: fx.a.users.owner.id },
      (tx) =>
        resolveRate(tx, {
          gymId: fx.a.gym.id,
          trainerUserId: fx.a.trainerUserId,
          sessionTypeId: fx.a.sessionTypeId,
          at: new Date('2019-06-01').toISOString(),
        }),
    );
    expect(at2019).toBeNull(); // before any card was effective
  });

  it('package balance is a ledger sum; completion redeems exactly one credit', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const before = await admin.money.memberPackages({ memberId: fx.a.memberId });
    const balBefore = before[0]!.balance;

    const monday = nextMonday();
    const booking = await admin.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: `${monday}T17:00:00.000Z`,
      memberId: fx.a.memberId,
    });
    await fx.caller(fx.a, 'trainer').scheduling.complete({ bookingId: booking.id, noShowMemberIds: [] });

    const after = await admin.money.memberPackages({ memberId: fx.a.memberId });
    expect(after[0]!.balance).toBe(balBefore - 1);

    const ledger = await admin.money.ledger({ purchaseId: after[0]!.id });
    expect(ledger.map((l) => l.kind)).toContain('purchase');
    expect(ledger.map((l) => l.kind)).toContain('redemption');
    // completing twice is impossible — status already changed
    await expect(
      fx.caller(fx.a, 'trainer').scheduling.complete({ bookingId: booking.id, noShowMemberIds: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('double-booking the trainer is rejected by the database', async () => {
    const admin = fx.caller(fx.a, 'admin');
    const monday = nextMonday(1);
    await admin.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: `${monday}T15:00:00.000Z`,
      memberId: fx.a.memberId,
    });
    await expect(
      admin.scheduling.book({
        trainerUserId: fx.a.trainerUserId,
        sessionTypeId: fx.a.sessionTypeId,
        startsAt: `${monday}T15:30:00.000Z`, // overlaps the 60-min session
        memberId: fx.a.memberId, // same member holds the package credits
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('member self-booking works inside availability, rejected outside, late cancel posts a fee', async () => {
    const member = fx.caller(fx.a, 'member');
    const monday = nextMonday(2);
    const slots = await member.scheduling.slots({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      fromDate: monday,
      days: 1,
    });
    expect(slots.length).toBeGreaterThan(0);
    const booked = await member.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: slots[0]!.startsAt,
    });
    expect(booked.id).toBeDefined();

    // outside availability (3am) → conflict
    await expect(
      member.scheduling.book({
        trainerUserId: fx.a.trainerUserId,
        sessionTypeId: fx.a.sessionTypeId,
        startsAt: `${monday}T07:00:00.000Z`,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // late cancel: staff books a session 2h out, member cancels → incident with fee
    const admin = fx.caller(fx.a, 'admin');
    const soon = new Date(Date.now() + 2 * 3600_000);
    soon.setUTCMinutes(0, 0, 0);
    const lateBooking = await admin.scheduling.book({
      trainerUserId: fx.a.trainerUserId,
      sessionTypeId: fx.a.sessionTypeId,
      startsAt: soon.toISOString(),
      memberId: fx.a.memberId,
    });
    const cancelled = await member.scheduling.cancel({ bookingId: lateBooking.id });
    expect(cancelled.status).toBe('late_cancelled');
    const incidents = await admin.scheduling.incidents({ status: 'posted' });
    const incident = incidents.find((i) => i.incident.bookingId === lateBooking.id)!;
    expect(incident.incident.feeCents).toBe(1500);
    await admin.scheduling.incidentResolve({ incidentId: incident.incident.id, status: 'waived' });
  });
});

describe('workout sync (never lose a set)', () => {
  const device = 'device-test-0001';
  let deviceSeq = 0; // per-device monotonic counter, like a real client keeps

  function makeBatch(sessionId: string, opts?: { status?: 'active' | 'completed'; extraOps?: number }) {
    const clock = createHlcClock(device);
    const mk = (setNo: number, weightKg: number, reps: number, isWarmup = false) => ({
      opId: ulid(),
      sessionId,
      kind: 'set_logged' as const,
      amends: null,
      exerciseId: fx.platform.exercises.backSquat,
      programItemId: null,
      setNo,
      payload: { weightKg, reps, isWarmup },
      deviceId: device,
      clientSeq: ++deviceSeq,
      clientTs: new Date().toISOString(),
      hlc: clock.tick(),
    });
    return {
      batchId: ulid(),
      deviceId: device,
      sessions: [
        {
          id: sessionId,
          status: opts?.status ?? ('active' as const),
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
          endedAt: opts?.status === 'completed' ? new Date().toISOString() : null,
          deviceId: device,
          fieldsHlc: clock.tick(),
          title: null,
          feltRating: opts?.status === 'completed' ? 4 : null,
          notes: null,
          assignmentId: null,
          programVersionId: null,
          programDayId: null,
        },
      ],
      ops: [mk(1, 60, 5, true), mk(2, 100, 8), mk(3, 102.5, 6), mk(4, 100, 8)],
    };
  }

  it('push is idempotent: replaying a batch stores nothing twice', async () => {
    const member = fx.caller(fx.a, 'member');
    const sessionId = uuidv7();
    const batch = makeBatch(sessionId);
    const first = await member.logging.push(batch);
    expect(first.accepted).toHaveLength(4);
    expect(first.sessionsApplied).toContain(sessionId);

    const replay = await member.logging.push(batch);
    expect(replay.accepted).toHaveLength(0);
    expect(replay.duplicate).toHaveLength(4);

    const detail = await member.logging.sessionDetail({ sessionId });
    expect(detail.sets).toHaveLength(4);
  });

  it('two devices merge without losing sets; completion detects PRs', async () => {
    const member = fx.caller(fx.a, 'member');
    const sessionId = uuidv7();
    await member.logging.push(makeBatch(sessionId));

    // second device logs one more set into the same session
    const clock2 = createHlcClock('device-test-0002');
    const extra = {
      batchId: ulid(),
      deviceId: 'device-test-0002',
      sessions: [],
      ops: [
        {
          opId: ulid(),
          sessionId,
          kind: 'set_logged' as const,
          amends: null,
          exerciseId: fx.platform.exercises.backSquat,
          programItemId: null,
          setNo: 5,
          payload: { weightKg: 105, reps: 3 },
          deviceId: 'device-test-0002',
          clientSeq: 1,
          clientTs: new Date().toISOString(),
          hlc: clock2.tick(),
        },
      ],
    };
    await member.logging.push(extra);

    // completing the session (LWW newer stamp) triggers PR detection
    const clock3 = createHlcClock(device);
    clock3.receive(`${String(Date.now() + 5000).padStart(13, '0')}-0000-x`);
    const completion = await member.logging.push({
      batchId: ulid(),
      deviceId: device,
      sessions: [
        {
          id: sessionId,
          status: 'completed',
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
          endedAt: new Date().toISOString(),
          deviceId: device,
          fieldsHlc: clock3.tick(),
          title: null,
          feltRating: 5,
          notes: 'strong day',
          assignmentId: null,
          programVersionId: null,
          programDayId: null,
        },
      ],
      ops: [],
    });
    expect(completion.sessionsApplied).toContain(sessionId);
    expect(completion.newPrs.some((p) => p.kind === 'weight' && p.value === 105)).toBe(true);

    const detail = await member.logging.sessionDetail({ sessionId });
    expect(detail.sets).toHaveLength(5);
    expect(new Set(detail.sets.map((s) => s.deviceId)).size).toBe(2);

    // stale LWW write (old clock) must NOT reopen the session
    const staleClock = createHlcClock('device-test-0001', () => Date.now() - 86400_000);
    const stale = await member.logging.push({
      batchId: ulid(),
      deviceId: device,
      sessions: [
        {
          id: sessionId,
          status: 'active',
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
          endedAt: null,
          deviceId: device,
          fieldsHlc: staleClock.tick(),
          title: null,
          feltRating: null,
          notes: null,
          assignmentId: null,
          programVersionId: null,
          programDayId: null,
        },
      ],
      ops: [],
    });
    expect(stale.sessionsStale).toContain(sessionId);
  });

  it('progress: history, trend, summary and streak all see the data', async () => {
    const member = fx.caller(fx.a, 'member');
    const history = await member.logging.history({});
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]!.setCount).toBeGreaterThan(0);
    const trend = await member.logging.exerciseTrend({ exerciseId: fx.platform.exercises.backSquat });
    expect(trend.length).toBeGreaterThan(0);
    const summary = await member.logging.progressSummary({});
    expect(summary!.streak.current).toBeGreaterThanOrEqual(1);
    expect(summary!.recentPrs.length).toBeGreaterThan(0);
  });

  it('trainer of the member reads the session; a foreign member cannot exist here', async () => {
    const trainer = fx.caller(fx.a, 'trainer');
    const history = await trainer.logging.history({ memberId: fx.a.memberId });
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('programs: plan resolution + progression', () => {
  it('todayPlan resolves absolute load, then linear-progresses into week 2', async () => {
    const member = fx.caller(fx.a, 'member');
    const plan1 = await member.programs.todayPlan({ assignmentId: fx.a.assignmentId });
    expect(plan1.day.weekNo).toBe(1);
    expect(plan1.items[0]!.resolved.weightKg).toBe(100);

    // complete week 1 day via sync push pinned to the program day
    const clock = createHlcClock('device-plan-0001');
    const sessionId = uuidv7();
    await member.logging.push({
      batchId: ulid(),
      deviceId: 'device-plan-0001',
      sessions: [
        {
          id: sessionId,
          status: 'completed',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          deviceId: 'device-plan-0001',
          fieldsHlc: clock.tick(),
          title: null,
          feltRating: 3,
          notes: null,
          assignmentId: fx.a.assignmentId,
          programVersionId: fx.a.programVersionId,
          programDayId: plan1.day.id,
        },
      ],
      ops: [],
    });

    const plan2 = await member.programs.todayPlan({ assignmentId: fx.a.assignmentId });
    expect(plan2.day.weekNo).toBe(2);
    expect(plan2.items[0]!.resolved.weightKg).toBe(102.5); // +2.5kg linear
    expect(plan2.items[0]!.resolved.explain).toMatch(/linear/i);
  });

  it('percent_max resolves from the latest tested max', async () => {
    const trainer = fx.caller(fx.a, 'trainer');
    await trainer.programs.maxSet({ memberId: fx.a.memberId, exerciseId: fx.platform.exercises.backSquat, valueKg: 140 });
    const admin = fx.caller(fx.a, 'admin');
    // build a tiny program with a percent_max item through the real builder flow
    const created = await admin.programs.create({ name: 'Peak Block' });
    await admin.programs.saveDraft({
      programId: created.programId,
      blocks: [
        {
          name: 'Block 1',
          orderNo: 1,
          weeks: [
            {
              weekNo: 1,
              days: [
                {
                  dayNo: 1,
                  name: 'Heavy Day',
                  items: [
                    {
                      exerciseId: fx.platform.exercises.backSquat,
                      orderNo: 1,
                      groupKind: 'straight',
                      sets: 5,
                      reps: '3',
                      load: { type: 'percent_max', percent: 85 },
                      alternates: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await admin.programs.publish({ programId: created.programId });
    const assigned = await admin.programs.assign({ programId: created.programId, memberIds: [fx.a.memberId] });
    const member = fx.caller(fx.a, 'member');
    const plan = await member.programs.todayPlan({ assignmentId: assigned.assignmentIds[0]! });
    expect(plan.items[0]!.resolved.weightKg).toBe(120); // 85% of 140 = 119 → rounded to 120
    expect(plan.items[0]!.resolved.explain).toMatch(/85%/);
  });
});
