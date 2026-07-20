import { describe, expect, it } from 'vitest';
import { IMPORTED_EXERCISES } from '../../../seeds/platform/imported-exercises.js';
import { mapExercise } from '../../../seeds/platform/mapping.js';

/** Vocabulary the platform seed actually creates. Kept in sync by these tests:
 *  a mapping that invents a pattern or class the seed never inserts would blow
 *  up at seed time, so assert it here instead. */
const PATTERNS = new Set([
  'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull',
  'vertical_pull', 'carry', 'core', 'rotation', 'isolation', 'conditioning',
  'mobility', 'plyometric', 'olympic',
]);

const CLASSES = new Set([
  'barbell_rack', 'barbell', 'bench_station', 'dumbbell', 'kettlebell', 'cable_stack',
  'lat_pulldown_machine', 'seated_row_machine', 'leg_press_machine', 'leg_curl_machine',
  'leg_extension_machine', 'chest_press_machine', 'shoulder_press_machine', 'pullup_bar',
  'dip_station', 'smith_machine', 'trap_bar', 'rower', 'bike', 'treadmill',
  'pec_deck_machine', 'hack_squat_machine', 'calf_raise_machine', 'elliptical',
  'stair_climber', 'ghd', 'preacher_bench', 'hyperextension_bench', 'resistance_band',
  'weight_plate', 'ab_wheel', 'medicine_ball', 'foam_roller', 'lacrosse_ball',
  'battle_rope', 'sandbag', 'atlas_stone', 'tire', 'machine_generic',
]);

const MUSCLES = new Set([
  'quads', 'hamstrings', 'glutes', 'calves', 'chest', 'lats', 'upper_back', 'lower_back',
  'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms', 'abs', 'obliques',
]);

describe('imported exercise library', () => {
  it('has no duplicate names', () => {
    const names = IMPORTED_EXERCISES.map(([n]) => n.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('maps every exercise to a movement pattern the seed creates', () => {
    for (const [name, cat, eq] of IMPORTED_EXERCISES) {
      const m = mapExercise(name, cat, eq);
      expect(PATTERNS.has(m.pattern), `${name}: unknown pattern "${m.pattern}"`).toBe(true);
    }
  });

  it('maps every exercise to a known equipment class or bodyweight', () => {
    for (const [name, cat, eq] of IMPORTED_EXERCISES) {
      const m = mapExercise(name, cat, eq);
      if (m.equipmentClass !== null) {
        expect(CLASSES.has(m.equipmentClass), `${name}: unknown class "${m.equipmentClass}"`).toBe(true);
      }
    }
  });

  it('only references muscles that exist', () => {
    for (const [name, cat, eq] of IMPORTED_EXERCISES) {
      const m = mapExercise(name, cat, eq);
      for (const key of [...m.primary, ...m.secondary]) {
        expect(MUSCLES.has(key), `${name}: unknown muscle "${key}"`).toBe(true);
      }
    }
  });

  it('gives every loaded exercise a sane difficulty', () => {
    for (const [name, cat, eq] of IMPORTED_EXERCISES) {
      const m = mapExercise(name, cat, eq);
      expect(m.difficulty, name).toBeGreaterThanOrEqual(1);
      expect(m.difficulty, name).toBeLessThanOrEqual(5);
    }
  });

  it('classifies the movements whose category would otherwise mislead', () => {
    // these are exactly the cases a naive category->pattern import gets wrong
    const expectations: [name: string, cat: string, eq: string, pattern: string][] = [
      ['Romanian Deadlift', 'Back', 'Barbell', 'hinge'],
      ['Sumo Deadlift', 'Back', 'Barbell', 'hinge'],
      ['Pull-Up', 'Back', 'Bodyweight', 'vertical_pull'],
      ['Lat Pulldown', 'Back', 'Cable', 'vertical_pull'],
      ['Barbell Row', 'Back', 'Barbell', 'horizontal_pull'],
      ['Good Morning', 'Back', 'Barbell', 'hinge'],
      ['Overhead Press', 'Shoulders', 'Barbell', 'vertical_push'],
      ['Bulgarian Split Squat', 'Quadriceps', 'Dumbbell', 'lunge'],
      ['Hip Thrust', 'Glutes', 'Barbell', 'hinge'],
    ];
    for (const [name, cat, eq, pattern] of expectations) {
      expect(mapExercise(name, cat, eq).pattern, name).toBe(pattern);
    }
  });

  it('routes machine exercises to the specific machine they need', () => {
    expect(mapExercise('Leg Press', 'Quadriceps', 'Machine').equipmentClass).toBe('leg_press_machine');
    expect(mapExercise('Pec Deck Machine', 'Chest', 'Machine').equipmentClass).toBe('pec_deck_machine');
    expect(mapExercise('Lat Pulldown', 'Back', 'Cable').equipmentClass).toBe('cable_stack');
    // an unrecognised machine must NOT become "no equipment needed" — that would
    // report it as available at every gym
    expect(mapExercise('Some Unknown Machine', 'Chest', 'Machine').equipmentClass).toBe('machine_generic');
  });

  it('leaves bodyweight work with no equipment requirement', () => {
    expect(mapExercise('Push-Up', 'Chest', 'Bodyweight').equipmentClass).toBeNull();
    expect(mapExercise('Plank', 'Core', 'Bodyweight').equipmentClass).toBeNull();
  });
});
