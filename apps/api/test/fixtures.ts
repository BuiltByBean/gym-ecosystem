/* Two fully-populated gyms on a fresh migrated database. Seeded through an
 * owner (superuser) connection; tests then act through RLS-bound contexts. */
import { createDb, schema, uuidv7 } from '@gym/db';
import { createTestDb, type TestDb } from '@gym/db/testing';
import type { StaffRole } from '@gym/db/schema';
import { appRouter } from '../src/routers/index.js';
import { makeCtx, type Ctx, type GymInfo } from '../src/context.js';

export interface GymFixture {
  gym: GymInfo;
  users: Record<'owner' | 'admin' | 'desk' | 'trainer' | 'member', { id: string; email: string }>;
  memberId: string; // member profile of users.member
  member2Id: string; // member with no login
  trainerUserId: string;
  equipment: { rackModelId: string; rackUnitId: string; legPressModelId: string; legPressUnitId: string; rackTag: string };
  programId: string;
  programVersionId: string;
  assignmentId: string;
  sessionTypeId: string;
  packageId: string;
}

export interface Fixture {
  db: TestDb;
  admin: ReturnType<typeof createDb>;
  platform: {
    patterns: Record<'squat' | 'hinge' | 'push', string>;
    muscles: Record<'quads' | 'glutes' | 'chest', string>;
    classes: Record<'rack' | 'legPress' | 'dumbbell', string>;
    exercises: Record<'backSquat' | 'legPress' | 'gobletSquat' | 'bwSquat', string>;
    linearRuleId: string;
    doubleRuleId: string;
  };
  a: GymFixture;
  b: GymFixture;
  caller: (gym: GymFixture, who: keyof GymFixture['users']) => ReturnType<typeof appRouter.createCaller>;
  ctxFor: (gym: GymFixture, who: keyof GymFixture['users']) => Ctx;
  destroy: () => Promise<void>;
}

const ROLE_OF: Record<string, StaffRole | null> = {
  owner: 'owner',
  admin: 'admin',
  desk: 'front_desk',
  trainer: 'trainer',
  member: null,
};

export async function createFixture(): Promise<Fixture> {
  const db = await createTestDb();
  const admin = createDb(db.adminUrl);
  const d = admin.db;

  // ---- platform layer (gym_id NULL) ----
  const ids = {
    patterns: { squat: uuidv7(), hinge: uuidv7(), push: uuidv7() },
    muscles: { quads: uuidv7(), glutes: uuidv7(), chest: uuidv7() },
    classes: { rack: uuidv7(), legPress: uuidv7(), dumbbell: uuidv7() },
    exercises: { backSquat: uuidv7(), legPress: uuidv7(), gobletSquat: uuidv7(), bwSquat: uuidv7() },
    linearRuleId: uuidv7(),
    doubleRuleId: uuidv7(),
  };
  await d.insert(schema.movementPatterns).values([
    { id: ids.patterns.squat, key: 'squat', name: 'Squat' },
    { id: ids.patterns.hinge, key: 'hinge', name: 'Hinge' },
    { id: ids.patterns.push, key: 'h_push', name: 'Horizontal Push' },
  ]);
  await d.insert(schema.muscles).values([
    { id: ids.muscles.quads, key: 'quads', name: 'Quadriceps', region: 'legs' },
    { id: ids.muscles.glutes, key: 'glutes', name: 'Glutes', region: 'legs' },
    { id: ids.muscles.chest, key: 'chest', name: 'Chest', region: 'chest' },
  ]);
  await d.insert(schema.equipmentClasses).values([
    { id: ids.classes.rack, key: 'barbell_rack', name: 'Barbell + Rack' },
    { id: ids.classes.legPress, key: 'leg_press', name: 'Leg Press Machine' },
    { id: ids.classes.dumbbell, key: 'dumbbell', name: 'Dumbbells' },
  ]);
  await d.insert(schema.exercises).values([
    { id: ids.exercises.backSquat, gymId: null, name: 'Back Squat', movementPatternId: ids.patterns.squat, equipmentClassId: ids.classes.rack, difficulty: 3, cues: ['brace', 'knees out'] },
    { id: ids.exercises.legPress, gymId: null, name: 'Leg Press', movementPatternId: ids.patterns.squat, equipmentClassId: ids.classes.legPress, difficulty: 2, cues: [] },
    { id: ids.exercises.gobletSquat, gymId: null, name: 'Goblet Squat', movementPatternId: ids.patterns.squat, equipmentClassId: ids.classes.dumbbell, difficulty: 2, cues: [] },
    { id: ids.exercises.bwSquat, gymId: null, name: 'Bodyweight Squat', movementPatternId: ids.patterns.squat, equipmentClassId: null, difficulty: 1, cues: [] },
  ]);
  await d.insert(schema.exerciseMuscles).values([
    { id: uuidv7(), gymId: null, exerciseId: ids.exercises.backSquat, muscleId: ids.muscles.quads, role: 'primary' },
    { id: uuidv7(), gymId: null, exerciseId: ids.exercises.legPress, muscleId: ids.muscles.quads, role: 'primary' },
  ]);
  await d.insert(schema.exerciseRelationships).values([
    { id: uuidv7(), gymId: null, fromExerciseId: ids.exercises.backSquat, toExerciseId: ids.exercises.legPress, kind: 'substitutes_for', rank: 10, reason: 'Same squat pattern, no spinal load' },
    { id: uuidv7(), gymId: null, fromExerciseId: ids.exercises.backSquat, toExerciseId: ids.exercises.gobletSquat, kind: 'substitutes_for', rank: 20, reason: 'Lighter squat pattern' },
    { id: uuidv7(), gymId: null, fromExerciseId: ids.exercises.gobletSquat, toExerciseId: ids.exercises.backSquat, kind: 'progression_of', rank: 10, reason: null },
  ]);
  await d.insert(schema.progressionRules).values([
    { id: ids.linearRuleId, gymId: null, name: 'Linear +2.5kg', kind: 'linear', params: { incrementKg: 2.5 } },
    { id: ids.doubleRuleId, gymId: null, name: 'Double 8-12', kind: 'double', params: { repRangeMin: 8, repRangeMax: 12, incrementKg: 2.5 } },
  ]);

  async function buildGym(suffix: 'a' | 'b'): Promise<GymFixture> {
    const gymId = uuidv7();
    await d.insert(schema.gyms).values({
      id: gymId,
      name: `Gym ${suffix.toUpperCase()}`,
      slug: `gym-${suffix}-${gymId.slice(0, 8)}`,
      settings: { adminFinancials: suffix === 'a', cancellationWindowHours: 24, lateCancelFeeCents: 1500, noShowFeeCents: 2500 },
      units: 'kg',
    });

    const users = {} as GymFixture['users'];
    for (const who of ['owner', 'admin', 'desk', 'trainer', 'member'] as const) {
      const id = uuidv7();
      const email = `${who}@${suffix}-${gymId.slice(0, 8)}.test`;
      await d.insert(schema.users).values({ id, email, displayName: `${who} ${suffix}`, passwordHash: null });
      users[who] = { id, email };
      const role = ROLE_OF[who];
      if (role) {
        await d.insert(schema.gymStaff).values({ id: uuidv7(), gymId, userId: id, role });
        if (role === 'trainer') {
          await d.insert(schema.trainerProfiles).values({ id: uuidv7(), gymId, userId: id, specialties: ['strength'], languages: ['en'], targetClientLoad: 20 });
        }
      }
    }

    const memberId = uuidv7();
    await d.insert(schema.members).values({
      id: memberId, gymId, userId: users.member.id, firstName: 'Mia', lastName: `Member${suffix.toUpperCase()}`,
      email: users.member.email, status: 'active', goalsNote: 'get strong', dateOfBirth: '1994-05-01',
    });
    const member2Id = uuidv7();
    await d.insert(schema.members).values({
      id: member2Id, gymId, firstName: 'Noah', lastName: `NoLogin${suffix.toUpperCase()}`, status: 'active',
    });
    await d.insert(schema.trainerAssignments).values({ id: uuidv7(), gymId, memberId, trainerUserId: users.trainer.id });
    await d.insert(schema.memberTrainerGrants).values({ id: uuidv7(), gymId, memberId, trainerUserId: users.trainer.id, scope: 'health' });

    // equipment: rack (class-satisfying) + leg press (direct exercise link)
    const rackModelId = uuidv7();
    const legPressModelId = uuidv7();
    const rackUnitId = uuidv7();
    const legPressUnitId = uuidv7();
    const rackTag = `EQ-RACK${suffix.toUpperCase()}`;
    await d.insert(schema.equipmentModels).values([
      { id: rackModelId, gymId, name: 'Power Rack', category: 'strength' },
      { id: legPressModelId, gymId, name: 'Leg Press 45', category: 'machine' },
    ]);
    await d.insert(schema.equipmentModelClasses).values([
      { id: uuidv7(), gymId, modelId: rackModelId, classId: ids.classes.rack },
      { id: uuidv7(), gymId, modelId: legPressModelId, classId: ids.classes.legPress },
    ]);
    await d.insert(schema.equipmentExerciseLinks).values([
      { id: uuidv7(), gymId, modelId: rackModelId, exerciseId: ids.exercises.backSquat },
      { id: uuidv7(), gymId, modelId: legPressModelId, exerciseId: ids.exercises.legPress },
    ]);
    await d.insert(schema.equipmentUnits).values([
      { id: rackUnitId, gymId, modelId: rackModelId, tagCode: rackTag },
      { id: legPressUnitId, gymId, modelId: legPressModelId, tagCode: `EQ-LP${suffix.toUpperCase()}` },
    ]);

    // program with one published version: Back Squat 3x8 @ 100kg, linear rule
    const programId = uuidv7();
    const programVersionId = uuidv7();
    const blockId = uuidv7();
    const week1Id = uuidv7();
    const week2Id = uuidv7();
    const day1Id = uuidv7();
    const day2Id = uuidv7();
    await d.insert(schema.programs).values({
      id: programId, gymId, name: `Strength ${suffix.toUpperCase()}`, status: 'published',
      currentVersionId: programVersionId, createdBy: users.admin.id,
    });
    await d.insert(schema.programVersions).values({
      id: programVersionId, gymId, programId, version: 1, status: 'published',
      publishedAt: new Date().toISOString(), defaultProgressionRuleId: ids.linearRuleId,
    });
    await d.insert(schema.programBlocks).values({ id: blockId, gymId, versionId: programVersionId, name: 'Block 1', orderNo: 1 });
    await d.insert(schema.programWeeks).values([
      { id: week1Id, gymId, blockId, weekNo: 1 },
      { id: week2Id, gymId, blockId, weekNo: 2 },
    ]);
    await d.insert(schema.programDays).values([
      { id: day1Id, gymId, weekId: week1Id, dayNo: 1, name: 'Lower A' },
      { id: day2Id, gymId, weekId: week2Id, dayNo: 1, name: 'Lower A' },
    ]);
    await d.insert(schema.programDayItems).values([
      { id: uuidv7(), gymId, dayId: day1Id, orderNo: 1, exerciseId: ids.exercises.backSquat, sets: 3, reps: '8', load: { type: 'absolute', value: 100, unit: 'kg' } },
      { id: uuidv7(), gymId, dayId: day2Id, orderNo: 1, exerciseId: ids.exercises.backSquat, sets: 3, reps: '8', load: { type: 'absolute', value: 100, unit: 'kg' } },
    ]);
    const assignmentId = uuidv7();
    await d.insert(schema.programAssignments).values({
      id: assignmentId, gymId, programId, programVersionId, memberId,
      assignedBy: users.trainer.id, startsOn: new Date().toISOString().slice(0, 10),
    });

    // scheduling + money
    const sessionTypeId = uuidv7();
    await d.insert(schema.sessionTypes).values({ id: sessionTypeId, gymId, name: 'PT 60', durationMin: 60, requiresPackage: true });
    await d.insert(schema.availabilityTemplates).values(
      [1, 2, 3, 4, 5].map((weekday) => ({ id: uuidv7(), gymId, trainerUserId: users.trainer.id, weekday, startMin: 9 * 60, endMin: 17 * 60 })),
    );
    await d.insert(schema.rateCards).values([
      { id: uuidv7(), gymId, scope: 'session_type', sessionTypeId, amountCents: 8000, effectiveAt: new Date('2020-01-01').toISOString() },
      { id: uuidv7(), gymId, scope: 'trainer_session_type', sessionTypeId, trainerUserId: users.trainer.id, amountCents: 9000, effectiveAt: new Date('2020-01-01').toISOString() },
    ]);
    const packageId = uuidv7();
    await d.insert(schema.packages).values({ id: packageId, gymId, name: '10 Pack', quantity: 10, priceCents: 80000, expiresDays: 365 });

    const gym: GymInfo = {
      id: gymId,
      name: `Gym ${suffix.toUpperCase()}`,
      slug: `gym-${suffix}`,
      timezone: 'America/New_York',
      currency: 'USD',
      units: 'kg',
      brandPrimary: '#C8472B',
      brandAccent: '#1A1A1A',
      settings: { adminFinancials: suffix === 'a', cancellationWindowHours: 24, lateCancelFeeCents: 1500, noShowFeeCents: 2500 },
    };
    return {
      gym, users, memberId, member2Id,
      trainerUserId: users.trainer.id,
      equipment: { rackModelId, rackUnitId, legPressModelId, legPressUnitId, rackTag },
      programId, programVersionId, assignmentId, sessionTypeId, packageId,
    };
  }

  const a = await buildGym('a');
  const b = await buildGym('b');

  const ctxFor: Fixture['ctxFor'] = (gymFx, who) => {
    const user = gymFx.users[who];
    const role = ROLE_OF[who];
    return makeCtx({
      bundle: db.bundle,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      host: 'localhost',
      session: { id: uuidv7(), userId: user.id, activeGymId: gymFx.gym.id },
      user: { id: user.id, email: user.email, displayName: who, isPlatformAdmin: false },
      gym: gymFx.gym,
      actor: {
        userId: user.id,
        isPlatformAdmin: false,
        staffRoles: role ? [role] : [],
        memberId: who === 'member' ? gymFx.memberId : null,
      },
      setCookie: () => {},
      clearCookie: () => {},
    });
  };

  return {
    db,
    admin,
    platform: ids,
    a,
    b,
    ctxFor,
    caller: (gymFx, who) => appRouter.createCaller(ctxFor(gymFx, who)),
    destroy: async () => {
      await admin.end();
      await db.destroy();
    },
  };
}
