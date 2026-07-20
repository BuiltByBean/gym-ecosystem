/* Taxonomy mapping for the imported exercise library.
 *
 * The source data (from the earlier Personal-Trainer project) is a flat
 * (name, category, equipment) triple. This platform needs more than that: the
 * substitution graph resolves on movement pattern, the availability check
 * resolves on equipment class, and progression/regression needs difficulty.
 * Importing the triples raw would leave 200+ exercises invisible to the
 * substitution engine, so every one is mapped here instead.
 *
 * Category gives a default; the name overrides it where the category lies
 * ("Romanian Deadlift" is filed under Back but is a hinge, not a pull).
 */

export interface MappedExercise {
  name: string;
  pattern: string;
  equipmentClass: string | null;
  primary: string[];
  secondary: string[];
  difficulty: number;
}

/** category -> [movement pattern, primary muscles] */
const CATEGORY_DEFAULT: Record<string, [pattern: string, primary: string[]]> = {
  Chest: ['horizontal_push', ['chest']],
  Back: ['horizontal_pull', ['lats', 'upper_back']],
  Shoulders: ['vertical_push', ['front_delts']],
  Biceps: ['isolation', ['biceps']],
  Triceps: ['isolation', ['triceps']],
  Forearms: ['isolation', ['forearms']],
  Quadriceps: ['squat', ['quads']],
  Hamstrings: ['hinge', ['hamstrings']],
  Glutes: ['hinge', ['glutes']],
  Calves: ['isolation', ['calves']],
  Core: ['core', ['abs']],
  // Cardio and mobility deliberately carry no primary muscle: they produce no
  // tonnage, so tagging them would skew the member's volume-by-muscle chart.
  Cardio: ['conditioning', []],
  Mobility: ['mobility', []],
  Plyometrics: ['plyometric', ['quads']],
  Olympic: ['olympic', ['quads', 'upper_back']],
  Functional: ['carry', ['abs', 'forearms']],
};

/** Name patterns that override the category's movement pattern. Ordered: first match wins. */
const PATTERN_OVERRIDES: [test: RegExp, pattern: string][] = [
  [/deadlift|good morning|hyperextension|rack pull|hip thrust|glute bridge|swing|romanian/i, 'hinge'],
  [/pull-?up|chin-?up|pulldown|pullover/i, 'vertical_pull'],
  [/\brow\b/i, 'horizontal_pull'],
  [/lunge|split squat|step-?up/i, 'lunge'],
  [/squat|leg press|hack/i, 'squat'],
  [/overhead press|shoulder press|push press|military|arnold|landmine press|pike push/i, 'vertical_push'],
  [/bench press|chest press|push-?up|\bfly|flye|dip\b|crossover|pec deck/i, 'horizontal_push'],
  [/carry|farmer|suitcase|yoke/i, 'carry'],
  [/twist|woodchop|rotation|pallof|russian/i, 'rotation'],
  [/plank|crunch|sit-?up|leg raise|dead bug|hollow|ab wheel|rollout|bicycle|mountain climber/i, 'core'],
  [/clean|snatch|jerk/i, 'olympic'],
  [/jump|bound|hop|burpee|box/i, 'plyometric'],
  [/stretch|foam roll|mobility|circle|cat-?cow|world.?s greatest|roll/i, 'mobility'],
  [/run|sprint|row erg|bike|treadmill|elliptical|stair|jog|jump rope/i, 'conditioning'],
];

/** Extra primary muscles implied by the name, beyond the category default. */
const MUSCLE_HINTS: [test: RegExp, muscles: string[]][] = [
  [/incline/i, ['front_delts']],
  [/deadlift|romanian|good morning/i, ['hamstrings', 'glutes', 'lower_back']],
  [/hip thrust|glute bridge/i, ['glutes']],
  [/pull-?up|chin-?up|pulldown/i, ['lats']],
  [/\brow\b|face pull|rear delt/i, ['upper_back']],
  [/lateral raise/i, ['side_delts']],
  [/rear delt|reverse pec/i, ['rear_delts']],
  [/curl/i, ['biceps']],
  [/tricep|pushdown|skull|overhead extension|kickback|close-?grip/i, ['triceps']],
  [/calf|calve/i, ['calves']],
  [/oblique|twist|woodchop|side plank/i, ['obliques']],
  [/squat|leg press|leg extension|lunge/i, ['quads']],
  [/leg curl|hamstring/i, ['hamstrings']],
];

/** equipment label -> equipment class key (null = bodyweight, always available) */
const EQUIPMENT_CLASS: Record<string, string | null> = {
  Barbell: 'barbell',
  Dumbbell: 'dumbbell',
  Cable: 'cable_stack',
  Bodyweight: null,
  Kettlebell: 'kettlebell',
  Band: 'resistance_band',
  Plate: 'weight_plate',
  'Ab Wheel': 'ab_wheel',
  'Medicine Ball': 'medicine_ball',
  'Foam Roller': 'foam_roller',
  'Lacrosse Ball': 'lacrosse_ball',
  Rope: 'battle_rope',
  Sandbag: 'sandbag',
  Stone: 'atlas_stone',
  Tire: 'tire',
  Equipment: null, // vague source value; treat as needing nothing specific
  Machine: 'machine_generic', // refined by name below
};

/** Machine exercises resolved to the specific machine they need. */
const MACHINE_BY_NAME: [test: RegExp, cls: string][] = [
  [/lat pulldown/i, 'lat_pulldown_machine'],
  [/seated (cable )?row|machine row/i, 'seated_row_machine'],
  [/leg press/i, 'leg_press_machine'],
  [/leg curl/i, 'leg_curl_machine'],
  [/leg extension/i, 'leg_extension_machine'],
  [/chest press/i, 'chest_press_machine'],
  [/shoulder press/i, 'shoulder_press_machine'],
  [/pec deck|reverse pec/i, 'pec_deck_machine'],
  [/hack squat/i, 'hack_squat_machine'],
  [/smith/i, 'smith_machine'],
  [/calf raise/i, 'calf_raise_machine'],
  [/treadmill/i, 'treadmill'],
  [/(stationary |assault |air )?bike|cycling/i, 'bike'],
  [/row(ing)? (machine|erg)|concept/i, 'rower'],
  [/elliptical/i, 'elliptical'],
  [/stair|step mill/i, 'stair_climber'],
  [/glute ham|ghd/i, 'ghd'],
  [/preacher/i, 'preacher_bench'],
  [/hyperextension|back extension/i, 'hyperextension_bench'],
];

/** Rough difficulty: technical lifts are harder, machines and bodyweight basics easier. */
function difficultyFor(name: string, category: string, equipment: string): number {
  if (/snatch|clean|jerk/i.test(name)) return 5;
  if (/deadlift|front squat|overhead press|muscle-?up|pistol/i.test(name)) return 4;
  if (/squat|bench press|\brow\b|pull-?up|chin-?up|dip\b/i.test(name)) return 3;
  if (category === 'Mobility' || equipment === 'Foam Roller' || equipment === 'Lacrosse Ball') return 1;
  if (equipment === 'Machine' || equipment === 'Cable') return 1;
  if (equipment === 'Bodyweight') return 2;
  return 2;
}

export function mapExercise(name: string, category: string, equipment: string): MappedExercise {
  const [defaultPattern, defaultPrimary] = CATEGORY_DEFAULT[category] ?? ['isolation', []];

  let pattern = defaultPattern;
  for (const [test, p] of PATTERN_OVERRIDES) {
    if (test.test(name)) {
      pattern = p;
      break;
    }
  }

  let equipmentClass = EQUIPMENT_CLASS[equipment] ?? null;
  if (equipmentClass === 'machine_generic') {
    const match = MACHINE_BY_NAME.find(([test]) => test.test(name));
    // an unrecognised machine keeps the generic class rather than silently
    // becoming "no equipment needed", which would fake availability
    equipmentClass = match ? match[1] : 'machine_generic';
  }

  const primary = new Set(defaultPrimary);
  const secondary = new Set<string>();
  for (const [test, muscles] of MUSCLE_HINTS) {
    if (test.test(name)) for (const m of muscles) primary.add(m);
  }
  // keep the primary set tight; extras become secondary
  const primaryList = [...primary].slice(0, 2);
  for (const m of [...primary].slice(2)) secondary.add(m);

  return {
    name,
    pattern,
    equipmentClass,
    primary: primaryList,
    secondary: [...secondary],
    difficulty: difficultyFor(name, category, equipment),
  };
}
