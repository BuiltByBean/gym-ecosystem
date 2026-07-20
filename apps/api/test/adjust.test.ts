import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from './fixtures.js';

let fx: Fixture;
let dayId: string;

beforeAll(async () => {
  fx = await createFixture();
  const plan = await fx.caller(fx.a, 'member').programs.todayPlan({ assignmentId: fx.a.assignmentId });
  dayId = plan.day.id;
}, 180_000);

afterAll(async () => {
  await fx.destroy();
});

describe('adjust today’s workout', () => {
  it('offers only the muscles and machines this day actually uses', async () => {
    const member = fx.caller(fx.a, 'member');
    const options = await member.programs.adjustOptions({
      programVersionId: fx.a.programVersionId,
      dayId,
    });
    // fixture day is Back Squat: quads primary, performed on the rack
    expect(options.muscles.map((m) => m.key)).toContain('quads');
    expect(options.equipment.map((e) => e.name)).toContain('Power Rack');
    expect(options.bodyAreas).toContain('knee');
  });

  it('swaps a sore muscle for work that avoids it', async () => {
    const member = fx.caller(fx.a, 'member');
    const suggestions = await member.programs.adjustDay({
      programVersionId: fx.a.programVersionId,
      dayId,
      reason: 'soreness',
      muscleKeys: ['quads'],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    const squat = suggestions.find((s) => s.exerciseName === 'Back Squat')!;
    expect(squat).toBeDefined();
    expect(squat.reason).toMatch(/sore/i);
    // whatever it offers must not train the sore muscle again
    for (const alt of squat.alternatives) {
      expect(alt.name).not.toBe('Back Squat');
      expect(alt.name).not.toBe('Leg Press'); // also quads-primary in the fixture
    }
  });

  it('an injured knee rules out the squat pattern entirely', async () => {
    const member = fx.caller(fx.a, 'member');
    const suggestions = await member.programs.adjustDay({
      programVersionId: fx.a.programVersionId,
      dayId,
      reason: 'injury',
      bodyArea: 'knee',
    });
    const squat = suggestions.find((s) => s.exerciseName === 'Back Squat');
    expect(squat).toBeDefined();
    // knee maps to squat/lunge/plyometric patterns being avoided
    for (const alt of squat!.alternatives) {
      expect(['Leg Press', 'Goblet Squat', 'Bodyweight Squat']).not.toContain(alt.name);
    }
  });

  it('a busy machine keeps the movement pattern', async () => {
    const member = fx.caller(fx.a, 'member');
    const suggestions = await member.programs.adjustDay({
      programVersionId: fx.a.programVersionId,
      dayId,
      reason: 'equipment',
      equipmentModelId: fx.a.equipment.rackModelId,
    });
    const squat = suggestions.find((s) => s.exerciseName === 'Back Squat');
    expect(squat).toBeDefined();
    // equipment swaps preserve the pattern, so a squat stays a squat
    if (squat!.alternatives.length > 0) {
      expect(squat!.alternatives.map((a) => a.name)).toContain('Leg Press');
    }
  });

  it('reports nothing to change when the day does not conflict', async () => {
    const member = fx.caller(fx.a, 'member');
    const suggestions = await member.programs.adjustDay({
      programVersionId: fx.a.programVersionId,
      dayId,
      reason: 'soreness',
      muscleKeys: ['chest'], // fixture day has no chest work
    });
    expect(suggestions).toHaveLength(0);
  });

  it('never rewrites the program — the plan is unchanged afterwards', async () => {
    const member = fx.caller(fx.a, 'member');
    const before = await member.programs.todayPlan({ assignmentId: fx.a.assignmentId });
    await member.programs.adjustDay({
      programVersionId: fx.a.programVersionId,
      dayId,
      reason: 'injury',
      bodyArea: 'knee',
    });
    const after = await member.programs.todayPlan({ assignmentId: fx.a.assignmentId });
    expect(after.items.map((i) => i.exerciseId)).toEqual(before.items.map((i) => i.exerciseId));
  });
});

describe('member health profile', () => {
  it('round-trips encrypted intake and is gated like screenings', async () => {
    const admin = fx.caller(fx.a, 'admin');
    await admin.members.healthProfileSave({
      memberId: fx.a.memberId,
      trainingExperience: 'intermediate',
      physicianClearance: true,
      heightCm: 170,
      medicalHistory: 'Asthma, well controlled',
      medications: 'Albuterol as needed',
      surgicalHistory: 'Left meniscus repair 2021',
    });

    const profile = await admin.members.healthProfile({ memberId: fx.a.memberId });
    expect(profile!.trainingExperience).toBe('intermediate');
    expect(profile!.physicianClearance).toBe(true);
    expect(profile!.medications).toBe('Albuterol as needed');

    // stored ciphertext must not contain the plaintext
    const raw = await fx.db.adminQuery(
      `SELECT medications_enc FROM member_health_profiles WHERE member_id = $1`,
      [fx.a.memberId],
    );
    expect(String(raw.rows[0]!.medications_enc)).not.toContain('Albuterol');

    // front desk must never see it
    await expect(
      fx.caller(fx.a, 'desk').members.healthProfile({ memberId: fx.a.memberId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // and neither may another gym
    await expect(
      fx.caller(fx.b, 'admin').members.healthProfile({ memberId: fx.a.memberId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a member can read and write their own', async () => {
    const member = fx.caller(fx.a, 'member');
    await member.members.healthProfileSave({
      memberId: fx.a.memberId,
      trainingExperience: 'advanced',
      medicalHistory: 'None',
    });
    const mine = await member.members.healthProfile({ memberId: fx.a.memberId });
    expect(mine!.trainingExperience).toBe('advanced');
  });
});
