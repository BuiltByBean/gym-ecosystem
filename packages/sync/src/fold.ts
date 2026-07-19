import { hlcCompare } from './hlc.js';
import type { SetOp, SetPayload } from './ops.js';

/** Current view of one logged set after folding its op chain. */
export interface FoldedSet {
  opId: string;
  exerciseId: string | null;
  programItemId: string | null;
  setNo: number | null;
  payload: SetPayload;
  voided: boolean;
  deviceId: string;
  clientTs: string;
  hlc: string;
  amendedBy: string[];
}

export interface FoldedSubstitution {
  opId: string;
  fromExerciseId: string | null;
  toExerciseId: string | null;
  reason: string | null;
  hlc: string;
}

export interface FoldResult {
  sets: FoldedSet[];
  substitutions: FoldedSubstitution[];
}

/**
 * Deterministic fold of an op chain into current state. Client and server run
 * this same function, so an offline phone and the trainer dashboard render the
 * exact same workout. Input order does not matter; duplicates are harmless.
 */
export function foldOps(ops: SetOp[]): FoldResult {
  // de-dup by opId, then order by (hlc, opId) for total determinism
  const byId = new Map<string, SetOp>();
  for (const op of ops) if (!byId.has(op.opId)) byId.set(op.opId, op);
  const ordered = [...byId.values()].sort(
    (a, b) => hlcCompare(a.hlc, b.hlc) || (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0),
  );

  const sets = new Map<string, FoldedSet>();
  const substitutions: FoldedSubstitution[] = [];

  for (const op of ordered) {
    switch (op.kind) {
      case 'set_logged': {
        if (sets.has(op.opId)) break;
        sets.set(op.opId, {
          opId: op.opId,
          exerciseId: op.exerciseId ?? null,
          programItemId: op.programItemId ?? null,
          setNo: op.setNo ?? null,
          payload: { ...op.payload },
          voided: false,
          deviceId: op.deviceId,
          clientTs: op.clientTs,
          hlc: op.hlc,
          amendedBy: [],
        });
        break;
      }
      case 'set_amended': {
        const target = op.amends ? sets.get(op.amends) : undefined;
        if (!target) break; // amend for an op we don't have (yet) — dropped; re-fold later
        const patch = Object.fromEntries(
          Object.entries(op.payload).filter(([, v]) => v !== undefined),
        );
        target.payload = { ...target.payload, ...patch };
        if (op.setNo != null) target.setNo = op.setNo;
        target.amendedBy.push(op.opId);
        break;
      }
      case 'set_voided': {
        const target = op.amends ? sets.get(op.amends) : undefined;
        if (!target) break;
        target.voided = true;
        target.amendedBy.push(op.opId);
        break;
      }
      case 'substitution': {
        substitutions.push({
          opId: op.opId,
          fromExerciseId: op.payload.fromExerciseId ?? null,
          toExerciseId: op.payload.toExerciseId ?? null,
          reason: op.payload.reason ?? null,
          hlc: op.hlc,
        });
        break;
      }
    }
  }

  return { sets: [...sets.values()], substitutions };
}

/** Visible (non-voided, non-warmup) working sets, for analytics. */
export function workingSets(result: FoldResult): FoldedSet[] {
  return result.sets.filter((s) => !s.voided && !s.payload.isWarmup);
}

/** Epley estimated 1RM in kg; null when the set can't support an estimate. */
export function epleyE1rm(weightKg: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weightKg || !reps || reps <= 0) return null;
  if (reps === 1) return weightKg;
  if (reps > 12) return null; // estimates degrade badly past ~12 reps
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}
