import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@gym/db';

export interface PlacedUnit {
  unitId: string;
  tagCode: string;
  modelId: string;
  modelName: string;
  category: string;
  status: schema.EquipmentStatus;
  xCm: number;
  yCm: number;
  rotationDeg: number;
  widthCm: number;
  heightCm: number;
  zoneId: string | null;
  zoneName: string | null;
}

/** Everything needed to draw one plan: geometry, zones, and placed machines. */
export async function readPlan(tx: Tx, planId: string) {
  const planRows = await tx.select().from(schema.floorPlans).where(eq(schema.floorPlans.id, planId)).limit(1);
  const plan = planRows[0];
  if (!plan) return null;

  const zones = await tx
    .select()
    .from(schema.gymZones)
    .where(eq(schema.gymZones.floorPlanId, planId))
    .orderBy(asc(schema.gymZones.name));

  const rows = await tx
    .select({
      unitId: schema.equipmentUnits.id,
      tagCode: schema.equipmentUnits.tagCode,
      status: schema.equipmentUnits.status,
      xCm: schema.equipmentUnits.xCm,
      yCm: schema.equipmentUnits.yCm,
      rotationDeg: schema.equipmentUnits.rotationDeg,
      zoneId: schema.equipmentUnits.zoneId,
      modelId: schema.equipmentModels.id,
      modelName: schema.equipmentModels.name,
      category: schema.equipmentModels.category,
      widthCm: schema.equipmentModels.footprintWCm,
      heightCm: schema.equipmentModels.footprintHCm,
    })
    .from(schema.equipmentUnits)
    .innerJoin(schema.equipmentModels, eq(schema.equipmentModels.id, schema.equipmentUnits.modelId))
    .where(and(eq(schema.equipmentUnits.floorPlanId, planId), isNotNull(schema.equipmentUnits.xCm)));

  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const placed: PlacedUnit[] = rows.map((r) => ({
    unitId: r.unitId,
    tagCode: r.tagCode,
    modelId: r.modelId,
    modelName: r.modelName,
    category: r.category,
    status: r.status,
    xCm: r.xCm ?? 0,
    yCm: r.yCm ?? 0,
    rotationDeg: r.rotationDeg,
    widthCm: r.widthCm,
    heightCm: r.heightCm,
    zoneId: r.zoneId,
    zoneName: r.zoneId ? (zoneName.get(r.zoneId) ?? null) : null,
  }));

  return { plan, zones, placed };
}

/** The zone a point falls inside, so a pin can be described in words. */
export function zoneAt(
  zones: (typeof schema.gymZones.$inferSelect)[],
  xCm: number,
  yCm: number,
): string | null {
  for (const z of zones) {
    if (z.xCm == null || z.yCm == null || z.widthCm == null || z.heightCm == null) continue;
    if (xCm >= z.xCm && xCm <= z.xCm + z.widthCm && yCm >= z.yCm && yCm <= z.yCm + z.heightCm) {
      return z.name;
    }
  }
  return null;
}

export interface Located {
  exerciseId: string;
  exerciseName: string;
  /** null when nothing that performs it is placed on a plan */
  planId: string | null;
  planName: string | null;
  units: {
    unitId: string;
    tagCode: string;
    modelName: string;
    status: schema.EquipmentStatus;
    xCm: number;
    yCm: number;
    zoneName: string | null;
  }[];
  /** short human sentence for the workout player */
  hint: string;
}

/**
 * Where can this exercise be performed? Resolves exercise → equipment models
 * (direct links, then equipment class) → placed units, preferring in-service
 * machines. Bodyweight work legitimately has no location.
 */
export async function locateExercise(tx: Tx, exerciseId: string): Promise<Located | null> {
  const exRows = await tx
    .select({
      id: schema.exercises.id,
      name: schema.exercises.name,
      classId: schema.exercises.equipmentClassId,
    })
    .from(schema.exercises)
    .where(eq(schema.exercises.id, exerciseId))
    .limit(1);
  const exercise = exRows[0];
  if (!exercise) return null;

  // An explicit exercise→model link is the gym saying "this is where you do
  // this", so it wins outright. Falling back to the equipment class only when
  // there is no link keeps "Deadlift" at the platform instead of scattering it
  // across every barbell station in the building.
  const linked = await tx
    .select({ modelId: schema.equipmentExerciseLinks.modelId })
    .from(schema.equipmentExerciseLinks)
    .where(eq(schema.equipmentExerciseLinks.exerciseId, exerciseId));
  const modelIds = new Set(linked.map((l) => l.modelId));

  if (modelIds.size === 0 && exercise.classId) {
    const byClass = await tx
      .select({ modelId: schema.equipmentModelClasses.modelId })
      .from(schema.equipmentModelClasses)
      .where(eq(schema.equipmentModelClasses.classId, exercise.classId));
    for (const m of byClass) modelIds.add(m.modelId);
  }

  const base = {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    planId: null,
    planName: null,
    units: [],
  };

  if (modelIds.size === 0) {
    return {
      ...base,
      hint: exercise.classId ? 'No machine at this gym is set up for this yet' : 'No equipment needed',
    };
  }

  const rows = await tx
    .select({
      unitId: schema.equipmentUnits.id,
      tagCode: schema.equipmentUnits.tagCode,
      status: schema.equipmentUnits.status,
      xCm: schema.equipmentUnits.xCm,
      yCm: schema.equipmentUnits.yCm,
      planId: schema.equipmentUnits.floorPlanId,
      modelName: schema.equipmentModels.name,
      planName: schema.floorPlans.name,
    })
    .from(schema.equipmentUnits)
    .innerJoin(schema.equipmentModels, eq(schema.equipmentModels.id, schema.equipmentUnits.modelId))
    .leftJoin(schema.floorPlans, eq(schema.floorPlans.id, schema.equipmentUnits.floorPlanId))
    .where(
      and(
        inArray(schema.equipmentUnits.modelId, [...modelIds]),
        isNotNull(schema.equipmentUnits.xCm),
        isNotNull(schema.equipmentUnits.floorPlanId),
      ),
    );

  if (rows.length === 0) {
    return { ...base, hint: 'Not placed on the floor plan yet — ask a trainer' };
  }

  // prefer working machines; keep the rest so a member can see all of them
  rows.sort((a, b) => Number(b.status === 'in_service') - Number(a.status === 'in_service'));
  const planId = rows[0]!.planId!;
  const onPlan = rows.filter((r) => r.planId === planId);

  const zones = await tx.select().from(schema.gymZones).where(eq(schema.gymZones.floorPlanId, planId));
  const units = onPlan.map((r) => ({
    unitId: r.unitId,
    tagCode: r.tagCode,
    modelName: r.modelName,
    status: r.status,
    xCm: r.xCm ?? 0,
    yCm: r.yCm ?? 0,
    zoneName: zoneAt(zones, r.xCm ?? 0, r.yCm ?? 0),
  }));

  // Several different machines can perform one exercise, so the count has to be
  // per model — "3x Power Rack", never a total across mixed equipment.
  const working = units.filter((u) => u.status === 'in_service');
  const pool = working.length > 0 ? working : units;
  const byModel = new Map<string, typeof pool>();
  for (const u of pool) byModel.set(u.modelName, [...(byModel.get(u.modelName) ?? []), u]);
  const [primaryName, primaryUnits] = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;

  const primary = primaryUnits[0]!;
  const where = primary.zoneName ? `in ${primary.zoneName}` : 'on the floor plan';
  const others = byModel.size - 1;
  const alsoAt = others > 0 ? ` (+${others} other option${others > 1 ? 's' : ''})` : '';
  const hint =
    working.length === 0
      ? `${primaryName} is out of service — tap for substitutes`
      : primaryUnits.length === 1
        ? `${primaryName}, ${where}${alsoAt}`
        : `${primaryUnits.length}× ${primaryName}, ${where}${alsoAt}`;

  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    planId,
    planName: onPlan[0]?.planName ?? null,
    units,
    hint,
  };
}

/** Ordered pins for a day's exercises — "your route for today". */
export async function locateMany(tx: Tx, exerciseIds: string[]): Promise<Located[]> {
  const out: Located[] = [];
  for (const id of exerciseIds) {
    const located = await locateExercise(tx, id);
    if (located) out.push(located);
  }
  return out;
}
