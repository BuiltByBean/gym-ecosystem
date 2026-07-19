import { describe, expect, it } from 'vitest';
import { createHlcClock, epleyE1rm, foldOps, hlcCompare, isUlid, ulid, type SetOp } from '../src/index.js';

describe('ulid', () => {
  it('generates valid, sortable, monotonic ids', () => {
    const ids = Array.from({ length: 500 }, () => ulid());
    for (const id of ids) expect(isUlid(id)).toBe(true);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids); // generation order == lexicographic order
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('hlc', () => {
  it('ticks monotonically even with a frozen wall clock', () => {
    let wall = 1000;
    const clock = createHlcClock('devA', () => wall);
    const a = clock.tick();
    const b = clock.tick();
    const c = clock.tick();
    expect(hlcCompare(a, b)).toBeLessThan(0);
    expect(hlcCompare(b, c)).toBeLessThan(0);
  });

  it('receive() jumps past remote stamps (skewed device catches up)', () => {
    let wall = 1000; // this device's clock is far behind
    const clock = createHlcClock('devB', () => wall);
    clock.tick();
    const merged = clock.receive('0000000005000-0002-devA');
    expect(hlcCompare(merged, '0000000005000-0002-devA')).toBeGreaterThan(0);
    const next = clock.tick();
    expect(hlcCompare(next, merged)).toBeGreaterThan(0);
  });
});

// --- fold ------------------------------------------------------------------

let seq = 0;
function op(partial: Partial<SetOp> & Pick<SetOp, 'kind'>): SetOp {
  seq++;
  return {
    opId: partial.opId ?? ulid(),
    sessionId: partial.sessionId ?? '00000000-0000-7000-8000-000000000001',
    kind: partial.kind,
    amends: partial.amends ?? null,
    exerciseId: partial.exerciseId ?? '00000000-0000-7000-8000-0000000000e1',
    programItemId: partial.programItemId ?? null,
    setNo: partial.setNo ?? seq,
    payload: partial.payload ?? { weightKg: 100, reps: 5 },
    deviceId: partial.deviceId ?? 'device-AAAA',
    clientSeq: partial.clientSeq ?? seq,
    clientTs: partial.clientTs ?? new Date(1700000000000 + seq * 1000).toISOString(),
    hlc: partial.hlc ?? `${String(1700000000000 + seq * 1000).padStart(13, '0')}-0000-devA`,
  };
}

describe('foldOps', () => {
  it('folds log → amend → void chains', () => {
    const s1 = op({ kind: 'set_logged', payload: { weightKg: 100, reps: 5 } });
    const s2 = op({ kind: 'set_logged', payload: { weightKg: 100, reps: 4 } });
    const amend = op({ kind: 'set_amended', amends: s2.opId, payload: { reps: 6 } });
    const s3 = op({ kind: 'set_logged', payload: { weightKg: 102.5, reps: 3 } });
    const voided = op({ kind: 'set_voided', amends: s3.opId, payload: {} });

    const { sets } = foldOps([s1, s2, amend, s3, voided]);
    expect(sets).toHaveLength(3);
    const folded2 = sets.find((s) => s.opId === s2.opId)!;
    expect(folded2.payload.reps).toBe(6);
    expect(folded2.payload.weightKg).toBe(100); // amend merges, not replaces
    expect(sets.find((s) => s.opId === s3.opId)!.voided).toBe(true);
  });

  it('is deterministic regardless of arrival order and duplicates', () => {
    const s1 = op({ kind: 'set_logged' });
    const s2 = op({ kind: 'set_logged' });
    const amend = op({ kind: 'set_amended', amends: s1.opId, payload: { rpe: 9 } });
    const inOrder = foldOps([s1, s2, amend]);
    const shuffledWithDupes = foldOps([amend, s2, s1, s1, amend, s2]);
    expect(shuffledWithDupes).toEqual(inOrder);
  });

  it('merges two devices logging the same session without losing either set', () => {
    // Member's phone and trainer's tablet, offline simultaneously.
    const phone = op({ kind: 'set_logged', deviceId: 'phone-000001', hlc: '0000000001000-0000-phone', clientSeq: 1 });
    const tablet = op({ kind: 'set_logged', deviceId: 'tablet-00001', hlc: '0000000001000-0000-tablet', clientSeq: 1 });
    const { sets } = foldOps([phone, tablet]);
    expect(sets).toHaveLength(2);
    expect(new Set(sets.map((s) => s.deviceId)).size).toBe(2);
  });

  it('conflicting amends resolve last-writer-wins by HLC', () => {
    const s = op({ kind: 'set_logged', payload: { weightKg: 60, reps: 8 }, hlc: '0000000001000-0000-devA' });
    const amendEarly = op({ kind: 'set_amended', amends: s.opId, payload: { reps: 9 }, hlc: '0000000002000-0000-devA' });
    const amendLate = op({ kind: 'set_amended', amends: s.opId, payload: { reps: 10 }, hlc: '0000000003000-0000-devB' });
    // arrival order reversed on purpose
    const { sets } = foldOps([s, amendLate, amendEarly]);
    expect(sets[0]!.payload.reps).toBe(10);
  });

  it('collects substitutions separately', () => {
    const sub = op({
      kind: 'substitution',
      payload: {
        fromExerciseId: '00000000-0000-7000-8000-0000000000e1',
        toExerciseId: '00000000-0000-7000-8000-0000000000e2',
        reason: 'machine taken',
      },
    });
    const { substitutions } = foldOps([sub]);
    expect(substitutions).toHaveLength(1);
    expect(substitutions[0]!.reason).toBe('machine taken');
  });
});

describe('epleyE1rm', () => {
  it('computes and guards ranges', () => {
    expect(epleyE1rm(100, 1)).toBe(100);
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.7, 1);
    expect(epleyE1rm(100, 13)).toBeNull();
    expect(epleyE1rm(null, 5)).toBeNull();
    expect(epleyE1rm(100, 0)).toBeNull();
  });
});
