/* Platform content: taxonomies, curated exercise library with graph edges,
 * default progression rules, PAR-Q + waiver templates. Idempotent (keyed on
 * stable names); safe to re-run. Runs on the OWNER connection. */
import { createDb, env, schema, uuidv7 } from '@gym/db';

type Ex = [name: string, pattern: string, cls: string | null, difficulty: number, primary: string[], secondary: string[], cues: string[]];

const PATTERNS: [string, string][] = [
  ['squat', 'Squat'], ['hinge', 'Hinge'], ['lunge', 'Lunge'],
  ['horizontal_push', 'Horizontal Push'], ['vertical_push', 'Vertical Push'],
  ['horizontal_pull', 'Horizontal Pull'], ['vertical_pull', 'Vertical Pull'],
  ['carry', 'Carry'], ['core', 'Core'], ['rotation', 'Rotation'],
  ['isolation', 'Isolation'], ['conditioning', 'Conditioning'],
];

const MUSCLES: [string, string, string][] = [
  ['quads', 'Quadriceps', 'legs'], ['hamstrings', 'Hamstrings', 'legs'], ['glutes', 'Glutes', 'legs'],
  ['calves', 'Calves', 'legs'], ['chest', 'Chest', 'chest'], ['lats', 'Lats', 'back'],
  ['upper_back', 'Upper Back', 'back'], ['lower_back', 'Lower Back', 'back'],
  ['front_delts', 'Front Delts', 'shoulders'], ['side_delts', 'Side Delts', 'shoulders'],
  ['rear_delts', 'Rear Delts', 'shoulders'], ['biceps', 'Biceps', 'arms'],
  ['triceps', 'Triceps', 'arms'], ['forearms', 'Forearms', 'arms'],
  ['abs', 'Abs', 'core'], ['obliques', 'Obliques', 'core'],
];

const CLASSES: [string, string][] = [
  ['barbell_rack', 'Barbell + Rack'], ['barbell', 'Barbell'], ['bench_station', 'Bench Press Station'],
  ['dumbbell', 'Dumbbells'], ['kettlebell', 'Kettlebells'], ['cable_stack', 'Cable Stack'],
  ['lat_pulldown_machine', 'Lat Pulldown Machine'], ['seated_row_machine', 'Seated Row Machine'],
  ['leg_press_machine', 'Leg Press Machine'], ['leg_curl_machine', 'Leg Curl Machine'],
  ['leg_extension_machine', 'Leg Extension Machine'], ['chest_press_machine', 'Chest Press Machine'],
  ['shoulder_press_machine', 'Shoulder Press Machine'], ['pullup_bar', 'Pull-Up Bar'],
  ['dip_station', 'Dip Station'], ['smith_machine', 'Smith Machine'], ['trap_bar', 'Trap Bar'],
  ['rower', 'Rowing Machine'], ['bike', 'Stationary Bike'], ['treadmill', 'Treadmill'],
];

const EXERCISES: Ex[] = [
  // squat
  ['Back Squat', 'squat', 'barbell_rack', 3, ['quads', 'glutes'], ['hamstrings', 'lower_back'], ['Big breath, brace hard', 'Knees track over toes', 'Drive the floor apart']],
  ['Front Squat', 'squat', 'barbell_rack', 4, ['quads'], ['glutes', 'abs'], ['Elbows high', 'Stay tall through the rep']],
  ['Goblet Squat', 'squat', 'dumbbell', 2, ['quads', 'glutes'], ['abs'], ['Bell tight to chest', 'Sit between your heels']],
  ['Bodyweight Squat', 'squat', null, 1, ['quads', 'glutes'], [], ['Full foot pressure', 'Control the descent']],
  ['Leg Press', 'squat', 'leg_press_machine', 2, ['quads', 'glutes'], ['hamstrings'], ['Lower under control', "Don't lock out hard"]],
  ['Smith Machine Squat', 'squat', 'smith_machine', 2, ['quads', 'glutes'], [], ['Feet slightly forward', 'Bar path is fixed — let it guide you']],
  ['Leg Extension', 'isolation', 'leg_extension_machine', 1, ['quads'], [], ['Pause at the top', 'No swinging']],
  // hinge
  ['Deadlift', 'hinge', 'barbell', 4, ['hamstrings', 'glutes'], ['lower_back', 'forearms', 'upper_back'], ['Bar over midfoot', 'Wedge, then push the floor away', 'Lats on']],
  ['Trap Bar Deadlift', 'hinge', 'trap_bar', 3, ['glutes', 'quads'], ['hamstrings', 'lower_back'], ['Neutral grip, tall chest']],
  ['Romanian Deadlift', 'hinge', 'barbell', 3, ['hamstrings', 'glutes'], ['lower_back'], ['Soft knees', 'Push hips back until you feel the stretch']],
  ['Dumbbell RDL', 'hinge', 'dumbbell', 2, ['hamstrings', 'glutes'], ['lower_back'], ['Bells stay close to your legs']],
  ['Kettlebell Swing', 'hinge', 'kettlebell', 2, ['glutes', 'hamstrings'], ['abs'], ['Snap the hips', 'Arms are ropes']],
  ['Hip Thrust', 'hinge', 'barbell', 2, ['glutes'], ['hamstrings'], ['Chin tucked', 'Full lockout squeeze']],
  ['Glute Bridge', 'hinge', null, 1, ['glutes'], ['hamstrings'], ['Ribs down, squeeze at top']],
  ['Lying Leg Curl', 'isolation', 'leg_curl_machine', 1, ['hamstrings'], [], ['Control the lowering']],
  // lunge
  ['Walking Lunge', 'lunge', 'dumbbell', 2, ['quads', 'glutes'], ['hamstrings'], ['Long stride, soft landing']],
  ['Reverse Lunge', 'lunge', null, 1, ['quads', 'glutes'], [], ['Step back, knee kisses the floor']],
  ['Bulgarian Split Squat', 'lunge', 'dumbbell', 3, ['quads', 'glutes'], ['hamstrings'], ['Front foot far enough forward', 'Torso slightly leaned']],
  ['Step-Up', 'lunge', 'dumbbell', 2, ['quads', 'glutes'], [], ['Drive through the top foot only']],
  // horizontal push
  ['Bench Press', 'horizontal_push', 'bench_station', 3, ['chest'], ['triceps', 'front_delts'], ['Feet planted', 'Bar to lower chest', 'Elbows ~45°']],
  ['Dumbbell Bench Press', 'horizontal_push', 'dumbbell', 2, ['chest'], ['triceps', 'front_delts'], ['Deep stretch, press together']],
  ['Incline Dumbbell Press', 'horizontal_push', 'dumbbell', 2, ['chest', 'front_delts'], ['triceps'], ['30–45° incline']],
  ['Push-Up', 'horizontal_push', null, 1, ['chest'], ['triceps', 'abs'], ['Body is a plank', 'Full range']],
  ['Machine Chest Press', 'horizontal_push', 'chest_press_machine', 1, ['chest'], ['triceps'], ['Shoulder blades back into the pad']],
  ['Dip', 'horizontal_push', 'dip_station', 3, ['chest', 'triceps'], ['front_delts'], ['Slight forward lean', 'Shoulder-depth or your depth']],
  ['Cable Fly', 'isolation', 'cable_stack', 2, ['chest'], [], ['Hug a barrel', 'Stretch, then squeeze']],
  // vertical push
  ['Overhead Press', 'vertical_push', 'barbell', 3, ['front_delts'], ['triceps', 'abs'], ['Glutes tight', 'Head through at lockout']],
  ['Dumbbell Shoulder Press', 'vertical_push', 'dumbbell', 2, ['front_delts', 'side_delts'], ['triceps'], ['Elbows slightly forward']],
  ['Machine Shoulder Press', 'vertical_push', 'shoulder_press_machine', 1, ['front_delts', 'side_delts'], ['triceps'], ['Set the seat so handles start at ear height']],
  ['Pike Push-Up', 'vertical_push', null, 2, ['front_delts'], ['triceps'], ['Hips high, head toward the floor']],
  ['Lateral Raise', 'isolation', 'dumbbell', 1, ['side_delts'], [], ['Lead with the elbows', 'No swing']],
  // horizontal pull
  ['Barbell Row', 'horizontal_pull', 'barbell', 3, ['upper_back', 'lats'], ['biceps', 'lower_back'], ['Hinge and hold', 'Pull to lower ribs']],
  ['Dumbbell Row', 'horizontal_pull', 'dumbbell', 2, ['lats', 'upper_back'], ['biceps'], ['Long arm stretch, elbow to hip']],
  ['Seated Cable Row', 'horizontal_pull', 'seated_row_machine', 1, ['upper_back', 'lats'], ['biceps'], ['Chest tall, squeeze the blades']],
  ['Chest-Supported Row', 'horizontal_pull', 'dumbbell', 2, ['upper_back'], ['biceps', 'rear_delts'], ['Chest glued to the pad']],
  ['Inverted Row', 'horizontal_pull', 'pullup_bar', 2, ['upper_back', 'lats'], ['biceps'], ['Rigid plank, chest to bar']],
  ['Face Pull', 'isolation', 'cable_stack', 1, ['rear_delts', 'upper_back'], [], ['Pull to your eyebrows', 'Thumbs back']],
  // vertical pull
  ['Pull-Up', 'vertical_pull', 'pullup_bar', 3, ['lats'], ['biceps', 'upper_back'], ['Dead hang start', 'Chin over, chest up']],
  ['Chin-Up', 'vertical_pull', 'pullup_bar', 3, ['lats', 'biceps'], ['upper_back'], ['Underhand grip, drive elbows down']],
  ['Lat Pulldown', 'vertical_pull', 'lat_pulldown_machine', 1, ['lats'], ['biceps'], ['Pull to collarbone', 'No leaning back']],
  ['Straight-Arm Pulldown', 'isolation', 'cable_stack', 2, ['lats'], [], ['Arms long, sweep to hips']],
  // arms
  ['Biceps Curl', 'isolation', 'dumbbell', 1, ['biceps'], ['forearms'], ['Elbows pinned']],
  ['Hammer Curl', 'isolation', 'dumbbell', 1, ['biceps', 'forearms'], [], ['Neutral grip']],
  ['Cable Curl', 'isolation', 'cable_stack', 1, ['biceps'], [], ['Constant tension']],
  ['Triceps Pushdown', 'isolation', 'cable_stack', 1, ['triceps'], [], ['Elbows glued to ribs']],
  ['Overhead Triceps Extension', 'isolation', 'dumbbell', 1, ['triceps'], [], ['Big stretch behind the head']],
  ['Standing Calf Raise', 'isolation', null, 1, ['calves'], [], ['Pause at the stretch']],
  // carry / core / rotation
  ['Farmer Carry', 'carry', 'dumbbell', 2, ['forearms', 'abs'], ['upper_back'], ['Tall posture, quick steps']],
  ['Suitcase Carry', 'carry', 'kettlebell', 2, ['obliques', 'forearms'], [], ['Do not lean — fight the tilt']],
  ['Plank', 'core', null, 1, ['abs'], ['obliques'], ['Squeeze glutes, ribs down']],
  ['Side Plank', 'core', null, 1, ['obliques'], ['abs'], ['Straight line ankle to shoulder']],
  ['Dead Bug', 'core', null, 1, ['abs'], [], ['Low back stays pressed down']],
  ['Hanging Knee Raise', 'core', 'pullup_bar', 2, ['abs'], ['forearms'], ['No swing, curl the hips']],
  ['Cable Crunch', 'core', 'cable_stack', 2, ['abs'], [], ['Round the spine, hips still']],
  ['Ab Wheel Rollout', 'core', null, 3, ['abs'], ['lats'], ['Hips forward, no sag']],
  ['Pallof Press', 'rotation', 'cable_stack', 2, ['obliques', 'abs'], [], ['Press out, resist the turn']],
  ['Cable Woodchop', 'rotation', 'cable_stack', 2, ['obliques'], ['abs'], ['Pivot the back foot']],
  ['Russian Twist', 'rotation', null, 1, ['obliques'], ['abs'], ['Rotate the ribcage, not the arms']],
  // conditioning
  ['Rowing Intervals', 'conditioning', 'rower', 2, ['upper_back', 'quads'], ['hamstrings'], ['Legs → body → arms']],
  ['Bike Sprints', 'conditioning', 'bike', 2, ['quads'], ['calves'], ['Smooth circles, high cadence']],
  ['Incline Treadmill Walk', 'conditioning', 'treadmill', 1, ['glutes', 'calves'], [], ['No handrail holding']],
];

/** [from, to, kind, rank, reason] — substitutes are directed; regressions are progressions read backwards. */
const EDGES: [string, string, 'substitutes_for' | 'progression_of', number, string | null][] = [
  ['Back Squat', 'Leg Press', 'substitutes_for', 10, 'Same squat pattern without spinal loading'],
  ['Back Squat', 'Front Squat', 'substitutes_for', 15, 'Keeps the barbell; shifts demand to the upper back'],
  ['Back Squat', 'Goblet Squat', 'substitutes_for', 20, 'Lighter squat pattern, easy setup'],
  ['Back Squat', 'Smith Machine Squat', 'substitutes_for', 30, 'Fixed bar path when racks are busy'],
  ['Goblet Squat', 'Bodyweight Squat', 'substitutes_for', 10, 'Same movement, no load'],
  ['Leg Press', 'Goblet Squat', 'substitutes_for', 10, 'Free-weight squat pattern'],
  ['Back Squat', 'Goblet Squat', 'progression_of', 10, null],
  ['Front Squat', 'Back Squat', 'progression_of', 10, null],
  ['Goblet Squat', 'Bodyweight Squat', 'progression_of', 10, null],

  ['Deadlift', 'Trap Bar Deadlift', 'substitutes_for', 10, 'Friendlier hinge geometry, same pattern'],
  ['Deadlift', 'Romanian Deadlift', 'substitutes_for', 20, 'Hinge with lighter loading from the floor'],
  ['Romanian Deadlift', 'Dumbbell RDL', 'substitutes_for', 10, 'Same hinge with dumbbells'],
  ['Romanian Deadlift', 'Lying Leg Curl', 'substitutes_for', 30, 'Isolates hamstrings when hinging is out'],
  ['Deadlift', 'Kettlebell Swing', 'substitutes_for', 30, 'Explosive hinge, much lighter load'],
  ['Hip Thrust', 'Glute Bridge', 'substitutes_for', 10, 'Same glute drive, bodyweight'],
  ['Deadlift', 'Romanian Deadlift', 'progression_of', 10, null],
  ['Hip Thrust', 'Glute Bridge', 'progression_of', 10, null],

  ['Bulgarian Split Squat', 'Reverse Lunge', 'substitutes_for', 10, 'Single-leg pattern, easier balance'],
  ['Walking Lunge', 'Reverse Lunge', 'substitutes_for', 10, 'Lower-impact lunge'],
  ['Bulgarian Split Squat', 'Reverse Lunge', 'progression_of', 10, null],

  ['Bench Press', 'Dumbbell Bench Press', 'substitutes_for', 10, 'Same press with independent arms'],
  ['Bench Press', 'Machine Chest Press', 'substitutes_for', 20, 'Fixed path when benches are taken'],
  ['Bench Press', 'Push-Up', 'substitutes_for', 30, 'No equipment needed'],
  ['Dumbbell Bench Press', 'Push-Up', 'substitutes_for', 20, 'No equipment needed'],
  ['Bench Press', 'Push-Up', 'progression_of', 10, null],
  ['Dip', 'Push-Up', 'progression_of', 10, null],

  ['Overhead Press', 'Dumbbell Shoulder Press', 'substitutes_for', 10, 'Same press, friendlier shoulders'],
  ['Overhead Press', 'Machine Shoulder Press', 'substitutes_for', 20, 'Guided path'],
  ['Dumbbell Shoulder Press', 'Pike Push-Up', 'substitutes_for', 30, 'Bodyweight vertical press'],
  ['Overhead Press', 'Dumbbell Shoulder Press', 'progression_of', 10, null],

  ['Barbell Row', 'Seated Cable Row', 'substitutes_for', 10, 'Supported row, less low-back demand'],
  ['Barbell Row', 'Dumbbell Row', 'substitutes_for', 15, 'Unilateral row, bench support'],
  ['Barbell Row', 'Chest-Supported Row', 'substitutes_for', 20, 'Takes the low back out entirely'],
  ['Seated Cable Row', 'Inverted Row', 'substitutes_for', 20, 'Bodyweight row on a bar'],
  ['Barbell Row', 'Inverted Row', 'progression_of', 10, null],

  ['Pull-Up', 'Lat Pulldown', 'substitutes_for', 10, 'Same pull, adjustable load'],
  ['Pull-Up', 'Chin-Up', 'substitutes_for', 15, 'Underhand grip, more biceps'],
  ['Lat Pulldown', 'Straight-Arm Pulldown', 'substitutes_for', 30, 'Lat isolation on the cable'],
  ['Pull-Up', 'Lat Pulldown', 'progression_of', 10, null],

  ['Biceps Curl', 'Cable Curl', 'substitutes_for', 10, 'Same curl, constant tension'],
  ['Biceps Curl', 'Hammer Curl', 'substitutes_for', 15, 'Neutral grip variation'],
  ['Triceps Pushdown', 'Overhead Triceps Extension', 'substitutes_for', 10, 'Dumbbell triceps option'],
  ['Cable Fly', 'Push-Up', 'substitutes_for', 30, 'Pattern-mate when cables are busy'],

  ['Plank', 'Dead Bug', 'substitutes_for', 10, 'Core brace with less wrist/shoulder load'],
  ['Ab Wheel Rollout', 'Plank', 'progression_of', 10, null],
  ['Hanging Knee Raise', 'Dead Bug', 'progression_of', 10, null],
  ['Cable Crunch', 'Dead Bug', 'substitutes_for', 20, 'Loaded flexion alternative'],
  ['Pallof Press', 'Russian Twist', 'substitutes_for', 20, 'Anti-rotation without a cable'],

  ['Rowing Intervals', 'Bike Sprints', 'substitutes_for', 10, 'Comparable conditioning stimulus'],
  ['Bike Sprints', 'Incline Treadmill Walk', 'substitutes_for', 20, 'Lower-intensity conditioning'],
];

const PARQ: schema.ScreeningQuestion[] = [
  { key: 'heart', text: 'Has a doctor ever said you have a heart condition and should only do activity recommended by a doctor?', flagOnYes: true },
  { key: 'chest_pain', text: 'Do you feel pain in your chest during physical activity?', flagOnYes: true },
  { key: 'chest_pain_rest', text: 'In the past month, have you had chest pain while not doing physical activity?', flagOnYes: true },
  { key: 'balance', text: 'Do you lose balance because of dizziness, or do you ever lose consciousness?', flagOnYes: true },
  { key: 'bone_joint', text: 'Do you have a bone or joint problem that could be made worse by a change in activity?', flagOnYes: true },
  { key: 'medication', text: 'Is a doctor currently prescribing medication for blood pressure or a heart condition?', flagOnYes: true },
  { key: 'other_reason', text: 'Do you know of any other reason you should not do physical activity?', flagOnYes: true },
];

const WAIVER_MD = `# Assumption of Risk & Release of Liability

In consideration of being permitted to use the facilities and participate in training at this gym, I acknowledge and agree:

1. **Assumption of risk.** Exercise carries inherent risks including muscle strains, sprains, fractures, cardiac events, and other injuries. I voluntarily assume all such risks.
2. **Health readiness.** I affirm I am physically able to participate, and I have disclosed relevant medical conditions through the health screening.
3. **Release.** To the fullest extent permitted by law, I release the gym, its owners, employees, and contractors from liability for injuries or losses arising from ordinary negligence connected with my use of the facilities.
4. **Equipment.** I will use equipment as instructed and report damaged equipment rather than use it.
5. **Medical attention.** I consent to receive emergency medical treatment if needed, at my expense.

This release is binding on my heirs and assigns. I have read it, understood it, and sign it voluntarily.`;

export async function seedPlatform(): Promise<void> {
  const bundle = createDb(env.DATABASE_ADMIN_URL);
  const d = bundle.db;
  try {
    // taxonomies (idempotent by key)
    const have = {
      patterns: new Map((await d.select().from(schema.movementPatterns)).map((r) => [r.key, r.id])),
      muscles: new Map((await d.select().from(schema.muscles)).map((r) => [r.key, r.id])),
      classes: new Map((await d.select().from(schema.equipmentClasses)).map((r) => [r.key, r.id])),
    };
    for (const [key, name] of PATTERNS) {
      if (!have.patterns.has(key)) {
        const id = uuidv7();
        await d.insert(schema.movementPatterns).values({ id, key, name });
        have.patterns.set(key, id);
      }
    }
    for (const [key, name, region] of MUSCLES) {
      if (!have.muscles.has(key)) {
        const id = uuidv7();
        await d.insert(schema.muscles).values({ id, key, name, region });
        have.muscles.set(key, id);
      }
    }
    for (const [key, name] of CLASSES) {
      if (!have.classes.has(key)) {
        const id = uuidv7();
        await d.insert(schema.equipmentClasses).values({ id, key, name });
        have.classes.set(key, id);
      }
    }

    const existingEx = new Map(
      (await d.select().from(schema.exercises)).filter((e) => e.gymId === null).map((e) => [e.name, e.id]),
    );
    for (const [name, pattern, cls, difficulty, primary, secondary, cues] of EXERCISES) {
      if (existingEx.has(name)) continue;
      const id = uuidv7();
      await d.insert(schema.exercises).values({
        id,
        gymId: null,
        name,
        movementPatternId: have.patterns.get(pattern)!,
        equipmentClassId: cls ? have.classes.get(cls)! : null,
        difficulty,
        cues,
      });
      existingEx.set(name, id);
      const muscleRows = [
        ...primary.map((m) => ({ muscleId: have.muscles.get(m)!, role: 'primary' as const })),
        ...secondary.map((m) => ({ muscleId: have.muscles.get(m)!, role: 'secondary' as const })),
      ];
      if (muscleRows.length) {
        await d.insert(schema.exerciseMuscles).values(
          muscleRows.map((m) => ({ id: uuidv7(), gymId: null, exerciseId: id, ...m })),
        );
      }
    }

    const existingEdges = new Set(
      (await d.select().from(schema.exerciseRelationships))
        .filter((e) => e.gymId === null)
        .map((e) => `${e.fromExerciseId}|${e.toExerciseId}|${e.kind}`),
    );
    for (const [from, to, kind, rank, reason] of EDGES) {
      const fromId = existingEx.get(from);
      const toId = existingEx.get(to);
      if (!fromId || !toId) continue;
      const key = `${fromId}|${toId}|${kind}`;
      if (existingEdges.has(key)) continue;
      await d.insert(schema.exerciseRelationships).values({
        id: uuidv7(), gymId: null, fromExerciseId: fromId, toExerciseId: toId, kind, rank, reason,
      });
      existingEdges.add(key);
    }

    const rules = await d.select().from(schema.progressionRules);
    if (!rules.some((r) => r.gymId === null && r.kind === 'linear')) {
      await d.insert(schema.progressionRules).values({
        id: uuidv7(), gymId: null, name: 'Linear (+5 lb / +2.5 kg per week)', kind: 'linear',
        params: { incrementKg: 2.5, incrementLb: 5 },
        description: 'Adds a fixed increment to absolute loads each program week.',
      });
    }
    if (!rules.some((r) => r.gymId === null && r.kind === 'double')) {
      await d.insert(schema.progressionRules).values({
        id: uuidv7(), gymId: null, name: 'Double progression 8–12', kind: 'double',
        params: { repRangeMin: 8, repRangeMax: 12, incrementKg: 2.5, incrementLb: 5 },
        description: 'Climb reps to the top of the range, then add weight and reset.',
      });
    }

    const screenings = await d.select().from(schema.healthScreeningTemplates);
    if (!screenings.some((s) => s.gymId === null)) {
      await d.insert(schema.healthScreeningTemplates).values({
        id: uuidv7(), gymId: null, name: 'PAR-Q Readiness Screening', version: 1, questions: PARQ, active: true,
      });
    }
    const waivers = await d.select().from(schema.waiverTemplates);
    if (!waivers.some((w) => w.gymId === null)) {
      await d.insert(schema.waiverTemplates).values({
        id: uuidv7(), gymId: null, name: 'Liability Waiver', version: 1, bodyMd: WAIVER_MD, active: true,
      });
    }

    console.log(`[seed] platform: ${existingEx.size} exercises, ${existingEdges.size} edges`);
  } finally {
    await bundle.end();
  }
}
