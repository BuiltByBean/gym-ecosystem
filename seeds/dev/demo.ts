/* Dev-only demo gym: Ironworks Strength Co. — staff, members, equipment,
 * a published program with an assignment, real workout history, money.
 * Idempotent: skips entirely if the demo gym already exists. */
import { eq } from 'drizzle-orm';
import { createDb, encryptSensitive, env, schema, uuidv7 } from '@gym/db';
import { createHlcClock, epleyE1rm, ulid } from '@gym/sync';
import { hashPassword } from './hash.js';

const PW = 'demo-password-123';
const LB = 0.45359237;
const lb = (n: number) => n * LB;

export async function seedDemo(): Promise<void> {
  const bundle = createDb(env.DATABASE_ADMIN_URL);
  const d = bundle.db;
  try {
    const existing = await d.select().from(schema.gyms);
    if (existing.some((g) => g.slug === 'demo')) {
      console.log('[seed] demo gym already present — skipping');
      return;
    }

    const gymId = uuidv7();
    await d.insert(schema.gyms).values({
      id: gymId,
      name: 'Ironworks Strength Co.',
      slug: 'demo',
      timezone: 'America/Chicago',
      currency: 'USD',
      units: 'lb',
      brandPrimary: '#C8472B',
      settings: { adminFinancials: true, cancellationWindowHours: 24, lateCancelFeeCents: 1500, noShowFeeCents: 2500 },
    });
    const locationId = uuidv7();
    await d.insert(schema.gymLocations).values({ id: locationId, gymId, name: 'Main Floor', address: '412 Foundry Ave' });

    // --- people -----------------------------------------------------------
    const pw = await hashPassword(PW);
    async function user(email: string, displayName: string): Promise<string> {
      const id = uuidv7();
      await d.insert(schema.users).values({ id, email, displayName, passwordHash: pw });
      return id;
    }
    const owner = await user('owner@demo.gym', 'Riley Cole');
    const admin = await user('admin@demo.gym', 'Morgan Diaz');
    const desk = await user('desk@demo.gym', 'Sam Porter');
    const trainer = await user('trainer@demo.gym', 'Alex Rivera');
    const trainer2 = await user('trainer2@demo.gym', 'Jordan Blake');
    const memberUser = await user('member@demo.gym', 'Mia Chen');

    const staffRows: [string, schema.StaffRole, 'employee' | 'contractor' | null][] = [
      [owner, 'owner', null], [admin, 'admin', 'employee'], [desk, 'front_desk', 'employee'],
      [trainer, 'trainer', 'employee'], [trainer2, 'trainer', 'contractor'],
    ];
    for (const [userId, role, employmentType] of staffRows) {
      await d.insert(schema.gymStaff).values({ id: uuidv7(), gymId, userId, role, employmentType });
    }
    await d.insert(schema.trainerProfiles).values([
      { id: uuidv7(), gymId, userId: trainer, bio: 'Powerlifting + return-to-training. 9 years coaching.', specialties: ['strength', 'powerlifting', 'rehab'], languages: ['en', 'es'], targetClientLoad: 25 },
      { id: uuidv7(), gymId, userId: trainer2, bio: 'Conditioning and weight-loss focus.', specialties: ['conditioning', 'weight loss'], languages: ['en'], targetClientLoad: 18 },
    ]);

    const day = 86400_000;
    const today = new Date();
    const iso = (t: number) => new Date(t).toISOString();
    const dateOnly = (t: number) => new Date(t).toISOString().slice(0, 10);

    const memberId = uuidv7();
    await d.insert(schema.members).values({
      id: memberId, gymId, userId: memberUser,
      firstName: 'Mia', lastName: 'Chen', email: 'member@demo.gym', phone: '312-555-0142',
      status: 'active', membershipType: 'Unlimited', dateOfBirth: '1994-05-12',
      joinedAt: dateOnly(today.getTime() - 200 * day),
      emergencyName: 'David Chen', emergencyPhone: '312-555-0143',
      goalsNote: 'First powerlifting meet next spring. Squat 100 kg.',
      preferredTimes: ['weekday evenings'],
    });

    const ROSTER: [string, string, schema.MemberStatus, string | null][] = [
      ['Omar', 'Haddad', 'active', 'Unlimited'], ['Priya', 'Natarajan', 'active', 'Unlimited'],
      ['Jake', 'Sullivan', 'active', '2x/week'], ['Elena', 'Rodrigues', 'active', 'Unlimited'],
      ['Tom', 'Becker', 'active', 'Off-peak'], ['Aisha', 'Cole', 'active', 'Unlimited'],
      ['Marcus', 'Webb', 'active', 'Unlimited'], ['Hana', 'Sato', 'active', '2x/week'],
      ['Leo', 'Fitzgerald', 'frozen', 'Unlimited'], ['Dana', 'Whitfield', 'inactive', null],
      ['Chris', 'Yoon', 'prospect', null], ['Rosa', 'Delgado', 'prospect', null],
    ];
    const rosterIds: string[] = [];
    for (const [i, [firstName, lastName, status, membershipType]] of ROSTER.entries()) {
      const id = uuidv7();
      rosterIds.push(id);
      await d.insert(schema.members).values({
        id, gymId, firstName, lastName, status, membershipType,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        phone: `312-555-0${150 + i}`,
        joinedAt: status === 'prospect' ? null : dateOnly(today.getTime() - (30 + i * 25) * day),
      });
    }

    // trainer relationships + default health grants
    for (const m of [memberId, rosterIds[0]!, rosterIds[1]!]) {
      await d.insert(schema.trainerAssignments).values({ id: uuidv7(), gymId, memberId: m, trainerUserId: trainer });
      await d.insert(schema.memberTrainerGrants).values({ id: uuidv7(), gymId, memberId: m, trainerUserId: trainer, scope: 'health' });
    }
    await d.insert(schema.trainerAssignments).values({ id: uuidv7(), gymId, memberId: rosterIds[3]!, trainerUserId: trainer2 });
    await d.insert(schema.memberTrainerGrants).values({ id: uuidv7(), gymId, memberId: rosterIds[3]!, trainerUserId: trainer2, scope: 'health' });

    // waiver + screening for Mia and a few others
    const waiverTmpl = (await d.select().from(schema.waiverTemplates)).find((w) => w.gymId === null)!;
    const screenTmpl = (await d.select().from(schema.healthScreeningTemplates)).find((s) => s.gymId === null)!;
    const { createHash } = await import('node:crypto');
    const docSha = createHash('sha256').update(waiverTmpl.bodyMd).digest('hex');
    for (const [m, name] of [[memberId, 'Mia Chen'], [rosterIds[0]!, 'Omar Haddad'], [rosterIds[1]!, 'Priya Natarajan']] as const) {
      await d.insert(schema.waiverSignatures).values({
        id: uuidv7(), gymId, memberId: m, templateId: waiverTmpl.id, templateVersion: waiverTmpl.version,
        docSha256: docSha, signedName: name, ip: '127.0.0.1', signedAt: iso(today.getTime() - 100 * day),
      });
      const answers = Object.fromEntries(screenTmpl.questions.map((q) => [q.key, false]));
      await d.insert(schema.healthScreenings).values({
        id: uuidv7(), gymId, memberId: m, templateId: screenTmpl.id,
        answersEnc: encryptSensitive(answers), flagged: false, signedAt: iso(today.getTime() - 100 * day),
      });
    }
    // a limitation for Omar: no jumping/lunging
    const patterns = new Map((await d.select().from(schema.movementPatterns)).map((p) => [p.key, p.id]));
    await d.insert(schema.memberLimitations).values({
      id: uuidv7(), gymId, memberId: rosterIds[0]!,
      descriptionEnc: encryptSensitive('Left knee meniscus repair (Feb) — avoid lunging patterns until cleared.'),
      excludedPatternIds: [patterns.get('lunge')!],
      createdBy: trainer,
    });

    // --- equipment --------------------------------------------------------
    const classes = new Map((await d.select().from(schema.equipmentClasses)).map((c) => [c.key, c.id]));
    const exercises = new Map(
      (await d.select().from(schema.exercises)).filter((e) => e.gymId === null).map((e) => [e.name, e.id]),
    );
    const zones: Record<string, string> = {};
    for (const name of ['Free Weights', 'Machines', 'Turf & Conditioning']) {
      const id = uuidv7();
      zones[name] = id;
      await d.insert(schema.gymZones).values({ id, gymId, locationId, name });
    }

    interface ModelSpec {
      name: string; category: string; zone: string; units: number;
      classes: string[]; exercises: string[]; manufacturer?: string;
    }
    const MODELS: ModelSpec[] = [
      { name: 'Power Rack', category: 'strength', zone: 'Free Weights', units: 3, manufacturer: 'Rogue', classes: ['barbell_rack', 'barbell', 'pullup_bar'], exercises: ['Back Squat', 'Front Squat', 'Overhead Press', 'Barbell Row', 'Pull-Up', 'Chin-Up', 'Inverted Row'] },
      { name: 'Bench Press Station', category: 'strength', zone: 'Free Weights', units: 2, manufacturer: 'Rogue', classes: ['bench_station', 'barbell'], exercises: ['Bench Press'] },
      { name: 'Deadlift Platform', category: 'strength', zone: 'Free Weights', units: 2, classes: ['barbell', 'trap_bar'], exercises: ['Deadlift', 'Romanian Deadlift', 'Trap Bar Deadlift', 'Hip Thrust'] },
      { name: 'Dumbbell Rack 5–100', category: 'free_weights', zone: 'Free Weights', units: 1, classes: ['dumbbell'], exercises: ['Dumbbell Bench Press', 'Incline Dumbbell Press', 'Dumbbell Row', 'Goblet Squat', 'Walking Lunge', 'Biceps Curl', 'Lateral Raise'] },
      { name: 'Kettlebell Set', category: 'free_weights', zone: 'Turf & Conditioning', units: 1, classes: ['kettlebell'], exercises: ['Kettlebell Swing', 'Suitcase Carry'] },
      { name: 'Cable Crossover', category: 'machine', zone: 'Machines', units: 2, manufacturer: 'Hammer Strength', classes: ['cable_stack'], exercises: ['Cable Fly', 'Face Pull', 'Triceps Pushdown', 'Cable Curl', 'Pallof Press', 'Cable Crunch', 'Cable Woodchop', 'Straight-Arm Pulldown'] },
      { name: 'Lat Pulldown', category: 'machine', zone: 'Machines', units: 1, classes: ['lat_pulldown_machine'], exercises: ['Lat Pulldown'] },
      { name: 'Seated Row', category: 'machine', zone: 'Machines', units: 1, classes: ['seated_row_machine'], exercises: ['Seated Cable Row'] },
      { name: 'Leg Press 45°', category: 'machine', zone: 'Machines', units: 1, manufacturer: 'Hammer Strength', classes: ['leg_press_machine'], exercises: ['Leg Press'] },
      { name: 'Leg Curl', category: 'machine', zone: 'Machines', units: 1, classes: ['leg_curl_machine'], exercises: ['Lying Leg Curl'] },
      { name: 'Leg Extension', category: 'machine', zone: 'Machines', units: 1, classes: ['leg_extension_machine'], exercises: ['Leg Extension'] },
      { name: 'Smith Machine', category: 'machine', zone: 'Machines', units: 1, classes: ['smith_machine'], exercises: ['Smith Machine Squat'] },
      { name: 'Concept2 Rower', category: 'cardio', zone: 'Turf & Conditioning', units: 2, manufacturer: 'Concept2', classes: ['rower'], exercises: ['Rowing Intervals'] },
      { name: 'Assault Bike', category: 'cardio', zone: 'Turf & Conditioning', units: 2, classes: ['bike'], exercises: ['Bike Sprints'] },
      { name: 'Treadmill', category: 'cardio', zone: 'Turf & Conditioning', units: 4, manufacturer: 'Woodway', classes: ['treadmill'], exercises: ['Incline Treadmill Walk'] },
    ];
    let tagN = 0;
    const unitIds: Record<string, string[]> = {};
    for (const spec of MODELS) {
      const modelId = uuidv7();
      await d.insert(schema.equipmentModels).values({
        id: modelId, gymId, name: spec.name, category: spec.category, manufacturer: spec.manufacturer ?? null,
      });
      for (const c of spec.classes) {
        await d.insert(schema.equipmentModelClasses).values({ id: uuidv7(), gymId, modelId, classId: classes.get(c)! });
      }
      for (const e of spec.exercises) {
        const exId = exercises.get(e);
        if (exId) await d.insert(schema.equipmentExerciseLinks).values({ id: uuidv7(), gymId, modelId, exerciseId: exId });
      }
      unitIds[spec.name] = [];
      for (let u = 0; u < spec.units; u++) {
        const unitId = uuidv7();
        unitIds[spec.name]!.push(unitId);
        tagN++;
        await d.insert(schema.equipmentUnits).values({
          id: unitId, gymId, modelId, tagCode: `EQ-${String(tagN).padStart(3, '0')}`,
          zoneId: zones[spec.zone]!, purchasedAt: dateOnly(today.getTime() - 400 * day),
        });
      }
    }
    // one treadmill down + an open report
    const downUnit = unitIds['Treadmill']![3]!;
    await d.update(schema.equipmentUnits).set({ status: 'maintenance' }).where(eq(schema.equipmentUnits.id, downUnit));
    await d.insert(schema.maintenanceReports).values({
      id: uuidv7(), gymId, unitId: downUnit, reportedByMemberId: rosterIds[2]!,
      description: 'Belt slips at anything over 6 mph.', status: 'open', createdAt: iso(today.getTime() - 2 * day),
    });

    // --- program ----------------------------------------------------------
    const rules = await d.select().from(schema.progressionRules);
    const linear = rules.find((r) => r.gymId === null && r.kind === 'linear')!;
    const double = rules.find((r) => r.gymId === null && r.kind === 'double')!;

    const programId = uuidv7();
    const versionId = uuidv7();
    await d.insert(schema.programs).values({
      id: programId, gymId, name: 'Ironworks Foundations', description: 'Four weeks, three days a week. Squat, hinge, press, pull — the base every member should own.',
      goalTags: ['strength', 'beginner'], status: 'published', publishedToMembers: true, currentVersionId: versionId, createdBy: admin,
    });
    await d.insert(schema.programVersions).values({
      id: versionId, gymId, programId, version: 1, status: 'published',
      publishedAt: iso(today.getTime() - 35 * day), publishedBy: admin, defaultProgressionRuleId: linear.id,
    });
    const blockId = uuidv7();
    await d.insert(schema.programBlocks).values({ id: blockId, gymId, versionId, name: 'Foundation Block', orderNo: 1 });

    const ex = (name: string) => exercises.get(name)!;
    type ItemSpec = [name: string, sets: number, reps: string, load: schema.LoadRx, restS: number, rule?: string | null, alternates?: string[]];
    const DAYS: [string, string, ItemSpec[]][] = [
      ['Lower A', 'Squat focus', [
        ['Back Squat', 3, '8', { type: 'absolute', value: 95, unit: 'lb' }, 150, linear.id, ['Leg Press', 'Goblet Squat']],
        ['Romanian Deadlift', 3, '10', { type: 'absolute', value: 95, unit: 'lb' }, 120, null, ['Dumbbell RDL']],
        ['Leg Press', 3, '12', { type: 'absolute', value: 180, unit: 'lb' }, 90, double.id, []],
        ['Plank', 3, '45s', { type: 'bodyweight' }, 60, null, ['Dead Bug']],
      ]],
      ['Upper A', 'Press + pull', [
        ['Bench Press', 3, '8', { type: 'absolute', value: 95, unit: 'lb' }, 150, double.id, ['Dumbbell Bench Press', 'Push-Up']],
        ['Seated Cable Row', 3, '10', { type: 'absolute', value: 100, unit: 'lb' }, 90, double.id, ['Dumbbell Row']],
        ['Dumbbell Shoulder Press', 3, '10', { type: 'absolute', value: 30, unit: 'lb' }, 90, null, []],
        ['Lat Pulldown', 3, '12', { type: 'absolute', value: 90, unit: 'lb' }, 90, null, ['Pull-Up']],
        ['Biceps Curl', 2, '12', { type: 'absolute', value: 20, unit: 'lb' }, 60, null, []],
      ]],
      ['Full Body', 'Hinge + carry', [
        ['Deadlift', 3, '5', { type: 'percent_max', percent: 75 }, 180, null, ['Trap Bar Deadlift']],
        ['Walking Lunge', 3, '10', { type: 'absolute', value: 25, unit: 'lb' }, 90, null, ['Reverse Lunge']],
        ['Push-Up', 3, 'AMRAP', { type: 'bodyweight' }, 90, null, []],
        ['Farmer Carry', 3, '40m', { type: 'rpe', rpe: 7 }, 90, null, ['Suitcase Carry']],
        ['Rowing Intervals', 1, '5x500m', { type: 'rpe', rpe: 8 }, 120, null, ['Bike Sprints']],
      ]],
    ];
    const dayIdsByWeek: string[][] = [];
    for (let week = 1; week <= 4; week++) {
      const weekId = uuidv7();
      await d.insert(schema.programWeeks).values({ id: weekId, gymId, blockId, weekNo: week });
      const dayIds: string[] = [];
      for (const [di, [name, focus, items]] of DAYS.entries()) {
        const dayId = uuidv7();
        dayIds.push(dayId);
        await d.insert(schema.programDays).values({ id: dayId, gymId, weekId, dayNo: di + 1, name, focus });
        for (const [ii, [exName, sets, reps, load, restS, rule, alternates]] of items.entries()) {
          const itemId = uuidv7();
          await d.insert(schema.programDayItems).values({
            id: itemId, gymId, dayId, orderNo: ii + 1, exerciseId: ex(exName),
            sets, reps, load, restS, progressionRuleId: rule ?? null,
          });
          for (const [ai, alt] of (alternates ?? []).entries()) {
            await d.insert(schema.programItemAlternates).values({
              id: uuidv7(), gymId, itemId, exerciseId: ex(alt), rank: ai + 1, reason: 'Planned alternate',
            });
          }
        }
      }
      dayIdsByWeek.push(dayIds);
    }
    const assignmentId = uuidv7();
    await d.insert(schema.programAssignments).values({
      id: assignmentId, gymId, programId, programVersionId: versionId, memberId,
      assignedBy: trainer, startsOn: dateOnly(today.getTime() - 28 * day),
    });
    await d.insert(schema.programAssignments).values({
      id: uuidv7(), gymId, programId, programVersionId: versionId, memberId: null,
      assignedBy: admin, startsOn: dateOnly(today.getTime() - 28 * day),
    });

    // --- workout history for Mia (progressing, feeds charts + PRs) --------
    const clock = createHlcClock('seed-device-0001');
    let seq = 0;
    const histSessions: { start: number; dayIdx: number; week: number }[] = [];
    for (let w = 0; w < 4; w++) {
      for (const dayIdx of [0, 1]) {
        histSessions.push({ start: today.getTime() - (27 - w * 7 - dayIdx * 2) * day, dayIdx, week: w });
      }
    }
    const bests: Record<string, { w: number; e: number; op: string }> = {};
    for (const h of histSessions) {
      if (h.start > today.getTime()) continue;
      const sessionId = uuidv7();
      const dayName = DAYS[h.dayIdx]![0];
      await d.insert(schema.workoutSessions).values({
        id: sessionId, gymId, memberId, assignmentId, programVersionId: versionId,
        programDayId: dayIdsByWeek[h.week]![h.dayIdx]!,
        title: dayName, status: 'completed',
        startedAt: iso(h.start), endedAt: iso(h.start + 55 * 60_000),
        feltRating: 3 + ((h.week + h.dayIdx) % 3), deviceId: 'seed-device-0001', actorUserId: memberUser,
        fieldsHlc: clock.tick(),
      });
      const lifts: [string, number, number[]][] = h.dayIdx === 0
        ? [['Back Squat', 95 + h.week * 5, [8, 8, 8]], ['Romanian Deadlift', 95 + h.week * 5, [10, 10, 9]], ['Leg Press', 180 + h.week * 10, [12, 12, 10]]]
        : [['Bench Press', 95 + h.week * 5, [8, 8, 7 + (h.week % 2)]], ['Seated Cable Row', 100 + h.week * 5, [10, 10, 10]], ['Lat Pulldown', 90 + h.week * 5, [12, 11, 10]]];
      for (const [exName, weightLb, reps] of lifts) {
        for (const [si, r] of reps.entries()) {
          seq++;
          const opId = ulid();
          const wKg = Math.round(lb(weightLb) * 10) / 10;
          await d.insert(schema.setLog).values({
            opId, gymId, sessionId, kind: 'set_logged', exerciseId: ex(exName), setNo: si + 1,
            payload: { weightKg: wKg, reps: r, isWarmup: false },
            actorUserId: memberUser, deviceId: 'seed-device-0001', clientSeq: seq,
            clientTs: iso(h.start + si * 3 * 60_000), hlc: clock.tick(),
          });
          const e1 = epleyE1rm(wKg, r) ?? 0;
          const best = bests[exName];
          if (!best || wKg > best.w || e1 > best.e) {
            bests[exName] = { w: Math.max(wKg, best?.w ?? 0), e: Math.max(e1, best?.e ?? 0), op: opId };
          }
        }
      }
    }
    for (const [exName, b] of Object.entries(bests)) {
      await d.insert(schema.personalRecords).values([
        { id: uuidv7(), gymId, memberId, exerciseId: ex(exName), kind: 'weight', value: String(b.w), setOpId: b.op, achievedAt: iso(today.getTime() - 2 * day) },
        { id: uuidv7(), gymId, memberId, exerciseId: ex(exName), kind: 'e1rm', value: String(b.e), setOpId: b.op, achievedAt: iso(today.getTime() - 2 * day) },
      ]);
    }
    await d.insert(schema.memberMaxes).values({
      id: uuidv7(), gymId, memberId, exerciseId: ex('Deadlift'), kind: 'tested', valueKg: String(Math.round(lb(225))),
      measuredAt: dateOnly(today.getTime() - 30 * day), source: 'trainer test',
    });
    // body metrics + checkins + scans
    for (let w = 5; w >= 0; w--) {
      await d.insert(schema.bodyMetrics).values({
        id: uuidv7(), gymId, memberId, measuredAt: dateOnly(today.getTime() - w * 7 * day),
        weightKg: String(Math.round((82 - (5 - w) * 0.3) * 10) / 10),
      });
    }
    for (let i = 0; i < 40; i++) {
      const who = i % 3 === 0 ? memberId : rosterIds[i % 8]!;
      await d.insert(schema.checkins).values({
        id: uuidv7(), gymId, memberId: who, source: i % 4 === 0 ? 'app' : 'front_desk',
        byUserId: desk, createdAt: iso(today.getTime() - (i % 28) * day - (i % 9) * 3600_000),
      });
    }
    for (let i = 0; i < 15; i++) {
      await d.insert(schema.equipmentScans).values({
        id: uuidv7(), gymId, unitId: unitIds['Power Rack']![i % 3]!, memberId,
        createdAt: iso(today.getTime() - (i % 20) * day),
      });
    }

    // --- scheduling + money ----------------------------------------------
    const pt60 = uuidv7();
    const intro30 = uuidv7();
    await d.insert(schema.sessionTypes).values([
      { id: pt60, gymId, name: 'Personal Training 60', durationMin: 60, requiresPackage: true },
      { id: intro30, gymId, name: 'Intro Assessment 30', durationMin: 30, requiresPackage: false },
    ]);
    for (const [t, days, from, to] of [[trainer, [1, 2, 3, 4, 5], 8, 16], [trainer2, [2, 3, 4, 5, 6], 10, 18]] as const) {
      for (const wd of days) {
        await d.insert(schema.availabilityTemplates).values({
          id: uuidv7(), gymId, trainerUserId: t, weekday: wd, startMin: from * 60, endMin: to * 60, locationId,
        });
      }
    }
    await d.insert(schema.rateCards).values([
      { id: uuidv7(), gymId, scope: 'session_type', sessionTypeId: pt60, amountCents: 9000, effectiveAt: iso(today.getTime() - 180 * day), createdBy: owner },
      { id: uuidv7(), gymId, scope: 'session_type', sessionTypeId: intro30, amountCents: 4500, effectiveAt: iso(today.getTime() - 180 * day), createdBy: owner },
      { id: uuidv7(), gymId, scope: 'trainer_session_type', sessionTypeId: pt60, trainerUserId: trainer, amountCents: 11000, effectiveAt: iso(today.getTime() - 90 * day), createdBy: owner, reason: 'Senior coach rate' },
    ]);
    const pack10 = uuidv7();
    await d.insert(schema.packages).values([
      { id: pack10, gymId, name: '10-Pack Personal Training', quantity: 10, priceCents: 95000, expiresDays: 365 },
      { id: uuidv7(), gymId, name: '5-Pack Personal Training', quantity: 5, priceCents: 52500, expiresDays: 180 },
    ]);
    const paymentId = uuidv7();
    await d.insert(schema.payments).values({
      id: paymentId, gymId, memberId, amountCents: 95000, purpose: 'package', provider: 'dev',
      providerRef: 'dev_seed', status: 'paid', createdAt: iso(today.getTime() - 21 * day),
    });
    const purchaseId = uuidv7();
    await d.insert(schema.packagePurchases).values({
      id: purchaseId, gymId, packageId: pack10, memberId, pricePaidCents: 95000, paymentId,
      purchasedAt: iso(today.getTime() - 21 * day), expiresAt: iso(today.getTime() + 344 * day),
    });
    await d.insert(schema.packageLedger).values({
      id: uuidv7(), gymId, purchaseId, memberId, delta: 10, kind: 'purchase', createdBy: admin,
      createdAt: iso(today.getTime() - 21 * day),
    });
    // two completed sessions redeemed + one upcoming
    for (const daysAgo of [14, 7]) {
      const bookingId = uuidv7();
      const starts = today.getTime() - daysAgo * day;
      await d.insert(schema.bookings).values({
        id: bookingId, gymId, trainerUserId: trainer, sessionTypeId: pt60, locationId,
        startsAt: iso(starts), endsAt: iso(starts + 3600_000), status: 'completed', bookedBy: desk,
        rateAppliedCents: 11000, packagePurchaseId: purchaseId,
      });
      await d.insert(schema.bookingAttendees).values({ id: uuidv7(), gymId, bookingId, memberId, status: 'checked_in', checkedInAt: iso(starts) });
      await d.insert(schema.packageLedger).values({
        id: uuidv7(), gymId, purchaseId, memberId, delta: -1, kind: 'redemption', bookingId, createdBy: trainer, createdAt: iso(starts + 3600_000),
      });
    }
    const nextTue = new Date(today);
    nextTue.setDate(today.getDate() + ((9 - today.getDay()) % 7 || 7));
    nextTue.setHours(10, 0, 0, 0);
    const upcomingId = uuidv7();
    await d.insert(schema.bookings).values({
      id: upcomingId, gymId, trainerUserId: trainer, sessionTypeId: pt60, locationId,
      startsAt: nextTue.toISOString(), endsAt: new Date(nextTue.getTime() + 3600_000).toISOString(),
      status: 'booked', bookedBy: memberUser, rateAppliedCents: 11000, packagePurchaseId: purchaseId,
    });
    await d.insert(schema.bookingAttendees).values({ id: uuidv7(), gymId, bookingId: upcomingId, memberId });

    console.log('[seed] demo gym ready — sign in with owner/admin/desk/trainer/member@demo.gym /', PW);
  } finally {
    await bundle.end();
  }
}
