import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { schema, uuidv7, type Tx } from '@gym/db';
import { epleyE1rm, foldOps, workingSets, setOpSchema } from '@gym/sync';

// ---------------------------------------------------------------------------
// Tree types (the builder exchanges the full tree; publish freezes a version)
// ---------------------------------------------------------------------------

export interface ItemInput {
  exerciseId: string;
  orderNo: number;
  groupNo?: number | null;
  groupKind: schema.GroupKind;
  sets: number;
  reps: string;
  load: schema.LoadRx;
  tempo?: string | null;
  restS?: number | null;
  rpeTarget?: number | null;
  notes?: string | null;
  progressionRuleId?: string | null;
  alternates: { exerciseId: string; rank: number; reason?: string | null }[];
}

export interface DayInput {
  dayNo: number;
  name: string;
  focus?: string | null;
  items: ItemInput[];
}
export interface WeekInput {
  weekNo: number;
  name?: string | null;
  days: DayInput[];
}
export interface BlockInput {
  name: string;
  orderNo: number;
  weeks: WeekInput[];
}

/** Replace a draft version's entire tree (client sends the full structure). */
export async function writeVersionTree(
  tx: Tx,
  gymId: string | null,
  versionId: string,
  blocks: BlockInput[],
): Promise<void> {
  const oldBlocks = await tx
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(eq(schema.programBlocks.versionId, versionId));
  if (oldBlocks.length) {
    const blockIds = oldBlocks.map((b) => b.id);
    const oldWeeks = await tx
      .select({ id: schema.programWeeks.id })
      .from(schema.programWeeks)
      .where(inArray(schema.programWeeks.blockId, blockIds));
    if (oldWeeks.length) {
      const weekIds = oldWeeks.map((w) => w.id);
      const oldDays = await tx
        .select({ id: schema.programDays.id })
        .from(schema.programDays)
        .where(inArray(schema.programDays.weekId, weekIds));
      if (oldDays.length) {
        const dayIds = oldDays.map((d) => d.id);
        const oldItems = await tx
          .select({ id: schema.programDayItems.id })
          .from(schema.programDayItems)
          .where(inArray(schema.programDayItems.dayId, dayIds));
        if (oldItems.length) {
          await tx
            .delete(schema.programItemAlternates)
            .where(inArray(schema.programItemAlternates.itemId, oldItems.map((i) => i.id)));
          await tx.delete(schema.programDayItems).where(inArray(schema.programDayItems.dayId, dayIds));
        }
        await tx.delete(schema.programDays).where(inArray(schema.programDays.weekId, weekIds));
      }
      await tx.delete(schema.programWeeks).where(inArray(schema.programWeeks.blockId, blockIds));
    }
    await tx.delete(schema.programBlocks).where(eq(schema.programBlocks.versionId, versionId));
  }

  for (const block of blocks) {
    const blockId = uuidv7();
    await tx.insert(schema.programBlocks).values({
      id: blockId,
      gymId,
      versionId,
      name: block.name,
      orderNo: block.orderNo,
    });
    for (const week of block.weeks) {
      const weekId = uuidv7();
      await tx.insert(schema.programWeeks).values({
        id: weekId,
        gymId,
        blockId,
        weekNo: week.weekNo,
        name: week.name ?? null,
      });
      for (const day of week.days) {
        const dayId = uuidv7();
        await tx.insert(schema.programDays).values({
          id: dayId,
          gymId,
          weekId,
          dayNo: day.dayNo,
          name: day.name,
          focus: day.focus ?? null,
        });
        for (const item of day.items) {
          const itemId = uuidv7();
          await tx.insert(schema.programDayItems).values({
            id: itemId,
            gymId,
            dayId,
            orderNo: item.orderNo,
            exerciseId: item.exerciseId,
            groupNo: item.groupNo ?? null,
            groupKind: item.groupKind,
            sets: item.sets,
            reps: item.reps,
            load: item.load,
            tempo: item.tempo ?? null,
            restS: item.restS ?? null,
            rpeTarget: item.rpeTarget != null ? String(item.rpeTarget) : null,
            notes: item.notes ?? null,
            progressionRuleId: item.progressionRuleId ?? null,
          });
          if (item.alternates.length) {
            await tx.insert(schema.programItemAlternates).values(
              item.alternates.map((a) => ({
                id: uuidv7(),
                gymId,
                itemId,
                exerciseId: a.exerciseId,
                rank: a.rank,
                reason: a.reason ?? null,
              })),
            );
          }
        }
      }
    }
  }
}

export async function readVersionTree(tx: Tx, versionId: string) {
  const blocks = await tx
    .select()
    .from(schema.programBlocks)
    .where(eq(schema.programBlocks.versionId, versionId))
    .orderBy(asc(schema.programBlocks.orderNo));
  const blockIds = blocks.map((b) => b.id);
  const weeks = blockIds.length
    ? await tx.select().from(schema.programWeeks).where(inArray(schema.programWeeks.blockId, blockIds)).orderBy(asc(schema.programWeeks.weekNo))
    : [];
  const weekIds = weeks.map((w) => w.id);
  const days = weekIds.length
    ? await tx.select().from(schema.programDays).where(inArray(schema.programDays.weekId, weekIds)).orderBy(asc(schema.programDays.dayNo))
    : [];
  const dayIds = days.map((d) => d.id);
  const items = dayIds.length
    ? await tx.select().from(schema.programDayItems).where(inArray(schema.programDayItems.dayId, dayIds)).orderBy(asc(schema.programDayItems.orderNo))
    : [];
  const itemIds = items.map((i) => i.id);
  const alternates = itemIds.length
    ? await tx.select().from(schema.programItemAlternates).where(inArray(schema.programItemAlternates.itemId, itemIds)).orderBy(asc(schema.programItemAlternates.rank))
    : [];

  const exerciseIds = [...new Set([...items.map((i) => i.exerciseId), ...alternates.map((a) => a.exerciseId)])];
  const exercises = exerciseIds.length
    ? await tx
        .select({
          id: schema.exercises.id,
          name: schema.exercises.name,
          videoGroupId: schema.exercises.videoGroupId,
          movementPatternId: schema.exercises.movementPatternId,
        })
        .from(schema.exercises)
        .where(inArray(schema.exercises.id, exerciseIds))
    : [];
  const exName = new Map(exercises.map((e) => [e.id, e]));

  return blocks.map((b) => ({
    id: b.id,
    name: b.name,
    orderNo: b.orderNo,
    weeks: weeks
      .filter((w) => w.blockId === b.id)
      .map((w) => ({
        id: w.id,
        weekNo: w.weekNo,
        name: w.name,
        days: days
          .filter((d) => d.weekId === w.id)
          .map((d) => ({
            id: d.id,
            dayNo: d.dayNo,
            name: d.name,
            focus: d.focus,
            items: items
              .filter((i) => i.dayId === d.id)
              .map((i) => ({
                ...i,
                exercise: exName.get(i.exerciseId) ?? null,
                alternates: alternates
                  .filter((a) => a.itemId === i.id)
                  .map((a) => ({ ...a, exercise: exName.get(a.exerciseId) ?? null })),
              })),
          })),
      })),
  }));
}

// ---------------------------------------------------------------------------
// Load resolution + progression (rules are data, not code — spec §4.6)
// ---------------------------------------------------------------------------

const KG_PER_LB = 0.45359237;

export function roundLoad(kg: number, unit: 'lb' | 'kg'): number {
  if (unit === 'kg') return Math.round(kg / 2.5) * 2.5;
  const lb = kg / KG_PER_LB;
  return Math.round(lb / 5) * 5 * KG_PER_LB; // round in lb, return kg
}

export interface ResolvedLoad {
  kind: 'weight' | 'rpe' | 'bodyweight';
  weightKg: number | null;
  display: string;
  explain: string | null;
}

export async function latestMaxKg(tx: Tx, memberId: string, exerciseId: string): Promise<number | null> {
  const rows = await tx
    .select()
    .from(schema.memberMaxes)
    .where(and(eq(schema.memberMaxes.memberId, memberId), eq(schema.memberMaxes.exerciseId, exerciseId)))
    .orderBy(desc(schema.memberMaxes.measuredAt), desc(schema.memberMaxes.createdAt))
    .limit(1);
  return rows[0] ? Number(rows[0].valueKg) : null;
}

interface LastPerf {
  topWeightKg: number | null;
  setsAtTop: number;
  allRepsAtTop: number[];
}

/** The member's most recent working performance of an exercise (smart defaults). */
export async function lastPerformance(tx: Tx, memberId: string, exerciseId: string): Promise<LastPerf | null> {
  const sessions = await tx
    .select({ id: schema.workoutSessions.id })
    .from(schema.workoutSessions)
    .where(and(eq(schema.workoutSessions.memberId, memberId), eq(schema.workoutSessions.status, 'completed')))
    .orderBy(desc(schema.workoutSessions.startedAt))
    .limit(15);
  if (sessions.length === 0) return null;
  const ops = await tx
    .select()
    .from(schema.setLog)
    .where(and(inArray(schema.setLog.sessionId, sessions.map((s) => s.id)), eq(schema.setLog.exerciseId, exerciseId)));
  if (ops.length === 0) return null;
  const parsed = ops.map((o) =>
    setOpSchema.parse({
      opId: o.opId,
      sessionId: o.sessionId,
      kind: o.kind,
      amends: o.amends,
      exerciseId: o.exerciseId,
      programItemId: o.programItemId,
      setNo: o.setNo,
      payload: o.payload,
      deviceId: o.deviceId,
      clientSeq: o.clientSeq,
      clientTs: o.clientTs,
      hlc: o.hlc,
    }),
  );
  // fold per session, newest session with working sets wins
  const bySession = new Map<string, typeof parsed>();
  for (const op of parsed) {
    const list = bySession.get(op.sessionId) ?? [];
    list.push(op);
    bySession.set(op.sessionId, list);
  }
  for (const s of sessions) {
    const sessionOps = bySession.get(s.id);
    if (!sessionOps) continue;
    const sets = workingSets(foldOps(sessionOps));
    if (sets.length === 0) continue;
    const top = Math.max(...sets.map((x) => x.payload.weightKg ?? 0));
    const atTop = sets.filter((x) => (x.payload.weightKg ?? 0) === top);
    return {
      topWeightKg: top || null,
      setsAtTop: atTop.length,
      allRepsAtTop: atTop.map((x) => x.payload.reps ?? 0),
    };
  }
  return null;
}

/**
 * Resolve a prescription into tonight's actual target.
 *  - absolute + linear rule: weight climbs by increment × (weekNo − 1)
 *  - percent_max: latest tested/e1rm max × percent
 *  - double progression: reps climb to repRangeMax, then weight bumps
 */
export async function resolveLoad(
  tx: Tx,
  opts: {
    item: typeof schema.programDayItems.$inferSelect;
    rule: typeof schema.progressionRules.$inferSelect | null;
    memberId: string;
    weekNo: number;
    unit: 'lb' | 'kg';
    exerciseName: string;
  },
): Promise<ResolvedLoad> {
  const { item, rule, memberId, weekNo, unit } = opts;
  const load = item.load;
  const fmt = (kg: number) =>
    unit === 'kg' ? `${Math.round(kg * 10) / 10} kg` : `${Math.round(kg / KG_PER_LB)} lb`;

  if (load.type === 'bodyweight') {
    return { kind: 'bodyweight', weightKg: null, display: 'Bodyweight', explain: null };
  }
  if (load.type === 'rpe') {
    return { kind: 'rpe', weightKg: null, display: `RPE ${load.rpe}`, explain: 'Pick a load that matches the target effort' };
  }
  if (load.type === 'percent_max') {
    const max = await latestMaxKg(tx, memberId, item.exerciseId);
    if (max == null) {
      return {
        kind: 'weight',
        weightKg: null,
        display: `${load.percent}% of max`,
        explain: `No tested max for ${opts.exerciseName} yet — log one to get exact targets`,
      };
    }
    const kg = roundLoad((load.percent / 100) * max, unit);
    return { kind: 'weight', weightKg: kg, display: fmt(kg), explain: `${load.percent}% of your ${fmt(max)} max` };
  }

  // absolute
  let kg = load.unit === 'kg' ? load.value : load.value * KG_PER_LB;
  let explain: string | null = null;

  if (rule?.kind === 'linear' && weekNo > 1) {
    const incKg = rule.params.incrementKg ?? (rule.params.incrementLb ?? 5) * KG_PER_LB;
    kg += incKg * (weekNo - 1);
    explain = `Week ${weekNo}: linear progression, +${fmt(incKg * (weekNo - 1))} over week 1`;
  } else if (rule?.kind === 'double') {
    const last = await lastPerformance(tx, memberId, item.exerciseId);
    const rangeMax = rule.params.repRangeMax ?? 12;
    const rangeMin = rule.params.repRangeMin ?? 8;
    if (last?.topWeightKg) {
      const hitTop = last.allRepsAtTop.length > 0 && last.allRepsAtTop.every((r) => r >= rangeMax);
      if (hitTop) {
        const incKg = rule.params.incrementKg ?? (rule.params.incrementLb ?? 5) * KG_PER_LB;
        kg = last.topWeightKg + incKg;
        explain = `You hit ${rangeMax}s last time — weight goes up, reps reset to ${rangeMin}`;
      } else {
        kg = last.topWeightKg;
        explain = `Same weight as last time — add a rep (target ${rangeMax} to move up)`;
      }
    }
  }

  kg = roundLoad(kg, unit);
  return { kind: 'weight', weightKg: kg, display: fmt(kg), explain };
}
