/* "Not feeling it today" — member-initiated adaptation of a single session.
 *
 * Ported in spirit from the earlier Personal-Trainer project, with two
 * corrections. That version rewrote exercise_id on the shared workout plan, so
 * one sore shoulder permanently altered the program for every future week (and
 * for anyone else assigned to it). Here the swap is session-scoped: it is
 * returned to the client, logged as a substitution op against the workout, and
 * the program version is never touched. It also picked substitutes with an
 * unordered "first row that matches" query; this routes through the same ranked
 * substitution graph the rest of the product uses.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@gym/db';
import { findSubstitutes, type SubstituteCandidate } from './substitution.js';

export type AdjustReason = 'soreness' | 'injury' | 'equipment';

/** Body area a member reports -> muscles that area is loaded by. */
export const BODY_AREA_MUSCLES: Record<string, string[]> = {
  shoulder: ['front_delts', 'side_delts', 'rear_delts', 'chest'],
  elbow: ['biceps', 'triceps', 'forearms'],
  wrist: ['forearms', 'biceps', 'triceps'],
  back: ['lats', 'upper_back', 'lower_back'],
  hip: ['glutes', 'hamstrings', 'quads'],
  knee: ['quads', 'hamstrings', 'calves'],
  ankle: ['calves'],
  neck: ['upper_back', 'rear_delts'],
};

/** Movement patterns to avoid entirely when an area is hurting. */
const BODY_AREA_PATTERNS: Record<string, string[]> = {
  shoulder: ['vertical_push', 'horizontal_push'],
  knee: ['squat', 'lunge', 'plyometric'],
  back: ['hinge'],
  hip: ['hinge', 'lunge'],
  ankle: ['plyometric'],
  elbow: [],
  wrist: [],
  neck: [],
};

export interface AdjustSuggestion {
  itemId: string;
  exerciseId: string;
  exerciseName: string;
  /** why this item was flagged */
  reason: string;
  replacement: SubstituteCandidate | null;
  alternatives: SubstituteCandidate[];
}

export interface AdjustInput {
  reason: AdjustReason;
  /** soreness: muscle keys ('chest'); injury: body area ('shoulder'); equipment: model id */
  muscleKeys?: string[];
  bodyArea?: string;
  equipmentModelId?: string;
  memberId: string;
}

/**
 * Look at a day's exercises and propose swaps for the ones the member can't or
 * shouldn't do today. Returns suggestions only — nothing is written here.
 */
export async function suggestAdjustments(
  tx: Tx,
  dayItems: { id: string; exerciseId: string }[],
  input: AdjustInput,
): Promise<AdjustSuggestion[]> {
  if (dayItems.length === 0) return [];

  const exerciseIds = [...new Set(dayItems.map((i) => i.exerciseId))];
  const exercises = await tx
    .select({
      id: schema.exercises.id,
      name: schema.exercises.name,
      patternId: schema.exercises.movementPatternId,
      patternKey: schema.movementPatterns.key,
    })
    .from(schema.exercises)
    .innerJoin(schema.movementPatterns, eq(schema.movementPatterns.id, schema.exercises.movementPatternId))
    .where(inArray(schema.exercises.id, exerciseIds));
  const byId = new Map(exercises.map((e) => [e.id, e]));

  // which exercises load the muscles in question
  const targetMuscleKeys =
    input.reason === 'injury' && input.bodyArea
      ? (BODY_AREA_MUSCLES[input.bodyArea] ?? [])
      : (input.muscleKeys ?? []);

  const musclesHit = new Set<string>();
  if (targetMuscleKeys.length > 0) {
    const rows = await tx
      .select({ exerciseId: schema.exerciseMuscles.exerciseId })
      .from(schema.exerciseMuscles)
      .innerJoin(schema.muscles, eq(schema.muscles.id, schema.exerciseMuscles.muscleId))
      .where(
        and(
          inArray(schema.exerciseMuscles.exerciseId, exerciseIds),
          inArray(schema.muscles.key, targetMuscleKeys),
          // soreness cares about what an exercise mainly trains; an injury has
          // to avoid anything that loads the area at all
          ...(input.reason === 'soreness' ? [eq(schema.exerciseMuscles.role, 'primary')] : []),
        ),
      );
    for (const r of rows) musclesHit.add(r.exerciseId);
  }

  const avoidPatterns = new Set(
    input.reason === 'injury' && input.bodyArea ? (BODY_AREA_PATTERNS[input.bodyArea] ?? []) : [],
  );

  // equipment: which exercises need the busy machine
  const equipmentHit = new Set<string>();
  if (input.reason === 'equipment' && input.equipmentModelId) {
    const links = await tx
      .select({ exerciseId: schema.equipmentExerciseLinks.exerciseId })
      .from(schema.equipmentExerciseLinks)
      .where(eq(schema.equipmentExerciseLinks.modelId, input.equipmentModelId));
    for (const l of links) equipmentHit.add(l.exerciseId);
  }

  const suggestions: AdjustSuggestion[] = [];
  for (const item of dayItems) {
    const ex = byId.get(item.exerciseId);
    if (!ex) continue;

    let reason: string | null = null;
    if (equipmentHit.has(item.exerciseId)) reason = 'That machine is busy';
    else if (musclesHit.has(item.exerciseId)) {
      reason = input.reason === 'injury' ? 'Loads the area you flagged' : 'Trains the muscle you said is sore';
    } else if (avoidPatterns.has(ex.patternKey)) {
      reason = `${ex.patternKey.replace(/_/g, ' ')} movement is hard on that area`;
    }
    if (!reason) continue;

    // Reuse the ranked graph. For injury/soreness the whole point is to move
    // AWAY from the pattern, so pattern preservation is relaxed there.
    const candidates = await findSubstitutes(tx, {
      exerciseId: item.exerciseId,
      memberId: input.memberId,
      preservePattern: input.reason === 'equipment',
      limit: 12,
    });

    // never suggest something that hits the same problem
    const safe: SubstituteCandidate[] = [];
    for (const c of candidates) {
      if (equipmentHit.has(c.exerciseId)) continue;
      if (musclesHit.has(c.exerciseId)) continue;
      if (avoidPatterns.size > 0) {
        const cand = await tx
          .select({ key: schema.movementPatterns.key })
          .from(schema.movementPatterns)
          .where(eq(schema.movementPatterns.id, c.movementPatternId))
          .limit(1);
        if (cand[0] && avoidPatterns.has(cand[0].key)) continue;
      }
      if (targetMuscleKeys.length > 0) {
        const loads = await tx
          .select({ id: schema.exerciseMuscles.id })
          .from(schema.exerciseMuscles)
          .innerJoin(schema.muscles, eq(schema.muscles.id, schema.exerciseMuscles.muscleId))
          .where(
            and(
              eq(schema.exerciseMuscles.exerciseId, c.exerciseId),
              inArray(schema.muscles.key, targetMuscleKeys),
            ),
          )
          .limit(1);
        if (loads.length > 0) continue;
      }
      safe.push(c);
      if (safe.length >= 4) break;
    }

    suggestions.push({
      itemId: item.id,
      exerciseId: item.exerciseId,
      exerciseName: ex.name,
      reason,
      replacement: safe[0] ?? null,
      alternatives: safe,
    });
  }

  return suggestions;
}
