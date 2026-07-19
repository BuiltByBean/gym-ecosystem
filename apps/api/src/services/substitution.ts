import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, uuidArrayLiteral, type Tx } from '@gym/db';

export interface SubstituteCandidate {
  exerciseId: string;
  name: string;
  difficulty: number;
  movementPatternId: string;
  patternName: string;
  source: 'curated' | 'pattern';
  rank: number;
  reason: string;
  availableOn: string | null; // model name, null = bodyweight/no equipment needed
  videoGroupId: string | null;
}

/**
 * Ranked substitutes for an exercise, constrained by (spec §4.4):
 *  - equipment actually in service at this gym right now
 *  - the member's flagged limitations (excluded exercises / movement patterns)
 *  - movement pattern preservation (relaxable)
 * One mechanism serves "the machine is taken", "I can't do that movement",
 * the builder's alternate picker, and the out-of-service trigger.
 */
export async function findSubstitutes(
  tx: Tx,
  opts: {
    exerciseId: string;
    memberId?: string | null;
    preservePattern?: boolean;
    limit?: number;
  },
): Promise<SubstituteCandidate[]> {
  const limit = opts.limit ?? 8;

  const targetRows = await tx
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.id, opts.exerciseId))
    .limit(1);
  const target = targetRows[0];
  if (!target) return [];

  let excludedExercises: string[] = [];
  let excludedPatterns: string[] = [];
  if (opts.memberId) {
    const lims = await tx
      .select({
        ex: schema.memberLimitations.excludedExerciseIds,
        pat: schema.memberLimitations.excludedPatternIds,
      })
      .from(schema.memberLimitations)
      .where(and(eq(schema.memberLimitations.memberId, opts.memberId), isNull(schema.memberLimitations.resolvedAt)));
    excludedExercises = lims.flatMap((l) => l.ex);
    excludedPatterns = lims.flatMap((l) => l.pat);
  }

  const preservePattern = opts.preservePattern ?? true;

  // RLS scopes every table here to platform rows + this gym automatically.
  const result = await tx.execute(sql`
    WITH available AS (
      SELECT e.id,
        (SELECT em.name FROM equipment_exercise_links l
           JOIN equipment_units u ON u.model_id = l.model_id AND u.status = 'in_service'
           JOIN equipment_models em ON em.id = l.model_id
          WHERE l.exercise_id = e.id LIMIT 1) AS via_model
      FROM exercises e
      WHERE e.archived_at IS NULL AND (
        e.equipment_class_id IS NULL
        OR EXISTS (SELECT 1 FROM equipment_exercise_links l
                     JOIN equipment_units u ON u.model_id = l.model_id AND u.status = 'in_service'
                    WHERE l.exercise_id = e.id)
        OR EXISTS (SELECT 1 FROM equipment_model_classes mc
                     JOIN equipment_units u2 ON u2.model_id = mc.model_id AND u2.status = 'in_service'
                    WHERE mc.class_id = e.equipment_class_id)
      )
    ),
    curated AS (
      SELECT r.to_exercise_id AS id, 0 AS priority, r.rank AS edge_rank, r.reason
      FROM exercise_relationships r
      WHERE r.from_exercise_id = ${opts.exerciseId} AND r.kind = 'substitutes_for'
    ),
    pattern_mates AS (
      SELECT e.id, 1 AS priority, 100 + abs(e.difficulty - ${target.difficulty}) * 10 AS edge_rank,
             NULL::text AS reason
      FROM exercises e
      WHERE e.movement_pattern_id = ${target.movementPatternId}
        AND e.id <> ${opts.exerciseId}
        AND e.archived_at IS NULL
    ),
    candidates AS (
      SELECT DISTINCT ON (c.id) c.id, c.priority, c.edge_rank, c.reason
      FROM (SELECT * FROM curated UNION ALL SELECT * FROM pattern_mates) c
      ORDER BY c.id, c.priority, c.edge_rank
    )
    SELECT e.id AS exercise_id, e.name, e.difficulty, e.movement_pattern_id, mp.name AS pattern_name,
           c.priority, c.edge_rank, c.reason, a.via_model, e.video_group_id, e.equipment_class_id
    FROM candidates c
    JOIN exercises e ON e.id = c.id
    JOIN movement_patterns mp ON mp.id = e.movement_pattern_id
    JOIN available a ON a.id = e.id
    WHERE e.id <> ${opts.exerciseId}
      ${excludedExercises.length ? sql`AND e.id <> ALL(${uuidArrayLiteral(excludedExercises)}::uuid[])` : sql``}
      ${excludedPatterns.length ? sql`AND e.movement_pattern_id <> ALL(${uuidArrayLiteral(excludedPatterns)}::uuid[])` : sql``}
      ${preservePattern ? sql`AND (c.priority = 0 OR e.movement_pattern_id = ${target.movementPatternId})` : sql``}
    ORDER BY c.priority, c.edge_rank, e.name
    LIMIT ${limit}
  `);

  const rows = result.rows as Array<{
    exercise_id: string;
    name: string;
    difficulty: number;
    movement_pattern_id: string;
    pattern_name: string;
    priority: number;
    edge_rank: number;
    reason: string | null;
    via_model: string | null;
    video_group_id: string | null;
    equipment_class_id: string | null;
  }>;

  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    name: r.name,
    difficulty: r.difficulty,
    movementPatternId: r.movement_pattern_id,
    patternName: r.pattern_name,
    source: r.priority === 0 ? 'curated' : 'pattern',
    rank: r.edge_rank,
    reason:
      r.reason ??
      (r.priority === 0
        ? 'Curated substitute'
        : `Same ${r.pattern_name.toLowerCase()} pattern${r.equipment_class_id === null ? ', no equipment needed' : ''}`),
    availableOn: r.via_model,
    videoGroupId: r.video_group_id,
  }));
}

/** Exercise ids that are performable at the gym right now (for the builder + flags). */
export async function availableExerciseIds(tx: Tx): Promise<Set<string>> {
  const result = await tx.execute(sql`
    SELECT e.id FROM exercises e
    WHERE e.archived_at IS NULL AND (
      e.equipment_class_id IS NULL
      OR EXISTS (SELECT 1 FROM equipment_exercise_links l
                   JOIN equipment_units u ON u.model_id = l.model_id AND u.status = 'in_service'
                  WHERE l.exercise_id = e.id)
      OR EXISTS (SELECT 1 FROM equipment_model_classes mc
                   JOIN equipment_units u2 ON u2.model_id = mc.model_id AND u2.status = 'in_service'
                  WHERE mc.class_id = e.equipment_class_id)
    )
  `);
  return new Set((result.rows as Array<{ id: string }>).map((r) => r.id));
}
