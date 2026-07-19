/* The workout player — used standing up, sweating, one hand, bad wifi.
 * Every interaction writes to IndexedDB first; sync is somebody else's problem. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { FoldResult } from '@gym/sync';
import { api, errMessage, mediaUrl, uploadMedia, type Outputs } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Modal, Spinner, TextArea, cx, toast } from '../../components/ui';
import { clockMMSS, displayToKg, kgToDisplay, platesPerSide } from '../../lib/format';
import { db, type LocalSession } from '../../offline/db';
import { activeSession, amendSet, foldSession, logSet, logSubstitution, updateSessionFields, voidSet } from '../../offline/workout';
import { syncNow, type SyncResult } from '../../offline/sync';

type Plan = Outputs['programs']['todayPlan'];
type PlanItem = Plan['items'][number];

interface WorkItem {
  key: string;
  exerciseId: string;
  exerciseName: string;
  programItemId: string | null;
  sets: number;
  reps: string;
  targetDisplay: string;
  targetKg: number | null;
  explain: string | null;
  restS: number;
  notes: string | null;
  videoGroupId?: string | null;
  substitutedFrom?: string;
}

export function WorkoutPlayer() {
  const { me, units } = useMe();
  const navigate = useNavigate();
  const gymId = me?.gym?.id ?? '';

  const [session, setSession] = useState<LocalSession | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [extras, setExtras] = useState<WorkItem[]>([]);
  const [subs, setSubs] = useState<Record<string, WorkItem>>({}); // key -> replacement
  const [fold, setFold] = useState<FoldResult>({ sets: [], substitutions: [] });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [rest, setRest] = useState<{ total: number; left: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [celebrate, setCelebrate] = useState<SyncResult['newPrs'] | null>(null);

  // load session + cached plan
  useEffect(() => {
    if (!gymId) return;
    void (async () => {
      const s = await activeSession(gymId);
      if (!s) {
        navigate('/me', { replace: true });
        return;
      }
      setSession(s);
      if (s.assignmentId) {
        const cached = await db.plans.get(s.assignmentId);
        if (cached) setPlan(cached.plan as Plan);
      }
      setFold(await foldSession(s.id));
    })();
  }, [gymId, navigate]);

  // wake lock while the player is open (capabilities adapter, web impl)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    void (async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<never> } }).wakeLock?.request?.('screen') ?? null;
      } catch {
        /* unsupported — fine */
      }
    })();
    return () => void lock?.release().catch(() => {});
  }, []);

  // rest timer
  useEffect(() => {
    if (!rest) return;
    if (rest.left <= 0) {
      if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
      if (Notification?.permission === 'granted') new Notification('Rest done — next set');
      setRest(null);
      return;
    }
    const t = setTimeout(() => setRest((r) => (r ? { ...r, left: r.left - 1 } : null)), 1000);
    return () => clearTimeout(t);
  }, [rest]);

  const items: WorkItem[] = useMemo(() => {
    const planItems: WorkItem[] = (plan?.items ?? []).map((i: PlanItem) => ({
      key: i.id,
      exerciseId: i.exerciseId,
      exerciseName: i.exercise?.name ?? 'Exercise',
      programItemId: i.id,
      sets: i.sets,
      reps: i.reps,
      targetDisplay: i.resolved.display,
      targetKg: i.resolved.weightKg,
      explain: i.resolved.explain,
      restS: i.restS ?? 90,
      notes: i.notes,
      videoGroupId: i.exercise?.videoGroupId,
    }));
    return [...planItems.map((p) => subs[p.key] ?? p), ...extras];
  }, [plan, extras, subs]);

  const refreshFold = useCallback(async () => {
    if (session) setFold(await foldSession(session.id));
  }, [session]);

  const setsFor = useCallback(
    (item: WorkItem) =>
      fold.sets.filter(
        (s) => !s.voided && (s.programItemId === item.programItemId ? s.exerciseId === item.exerciseId : s.exerciseId === item.exerciseId),
      ),
    [fold],
  );

  async function handleLog(item: WorkItem, weightKg: number | null, reps: number | null, isWarmup: boolean) {
    if (!session) return;
    const done = setsFor(item).length;
    await logSet({
      gymId,
      sessionId: session.id,
      exerciseId: item.exerciseId,
      programItemId: item.programItemId,
      setNo: done + 1,
      payload: { weightKg, reps, isWarmup },
    });
    await refreshFold();
    if (!isWarmup) setRest({ total: item.restS, left: item.restS });
    void syncNow();
  }

  async function handleFinish(feltRating: number, notes: string) {
    if (!session) return;
    await updateSessionFields(session.id, {
      status: 'completed',
      endedAt: new Date().toISOString(),
      feltRating: feltRating as never,
      notes: notes || null,
    });
    const result = await syncNow();
    if (result.newPrs.length > 0) {
      setCelebrate(result.newPrs);
    } else {
      toast('Workout saved 💪');
      navigate('/me', { replace: true });
    }
  }

  async function handleDiscard() {
    if (!session) return;
    await updateSessionFields(session.id, { status: 'discarded', endedAt: new Date().toISOString() });
    void syncNow();
    navigate('/me', { replace: true });
  }

  if (!session) return <Spinner />;

  if (celebrate) {
    return <Celebration prs={celebrate} units={units} onDone={() => navigate('/me', { replace: true })} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">{session.title ?? 'Workout'}</h1>
          <p className="text-xs text-steel">
            {fold.sets.filter((s) => !s.voided).length} sets logged · saved on-device instantly
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setFinishing(true)}>Finish</Button>
      </div>

      {rest && (
        <button
          className="w-full rounded-xl bg-ink p-4 text-center text-white"
          onClick={() => setRest(null)}
          aria-label="Skip rest"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-white/60">Rest — tap to skip</div>
          <div className="score text-6xl">{clockMMSS(rest.left)}</div>
          <div className="mx-auto mt-2 h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-white transition-all" style={{ width: `${(rest.left / rest.total) * 100}%` }} />
          </div>
        </button>
      )}

      {items.map((item) => (
        <ExerciseCard
          key={item.key}
          item={item}
          units={units}
          gymId={gymId}
          sessionId={session.id}
          sets={setsFor(item)}
          open={activeKey === item.key}
          onToggle={() => setActiveKey(activeKey === item.key ? null : item.key)}
          onLog={handleLog}
          onAmend={async (opId, patch) => {
            await amendSet({ gymId, sessionId: session.id, amends: opId, payload: patch });
            await refreshFold();
          }}
          onVoid={async (opId) => {
            await voidSet({ gymId, sessionId: session.id, amends: opId });
            await refreshFold();
          }}
          onSubstitute={(replacement, reason) => {
            void logSubstitution({
              gymId,
              sessionId: session.id,
              fromExerciseId: item.exerciseId,
              toExerciseId: replacement.exerciseId,
              reason,
            });
            setSubs((s) => ({ ...s, [item.key]: { ...replacement, key: item.key, programItemId: item.programItemId, substitutedFrom: item.exerciseName } }));
            setActiveKey(item.key);
          }}
        />
      ))}

      <AddExercise
        onAdd={(ex) =>
          setExtras((x) => [
            ...x,
            {
              key: `extra-${ex.id}-${x.length}`,
              exerciseId: ex.id,
              exerciseName: ex.name,
              programItemId: null,
              sets: 3,
              reps: '8',
              targetDisplay: '—',
              targetKg: null,
              explain: null,
              restS: 90,
              notes: null,
              videoGroupId: ex.videoGroupId,
            },
          ])
        }
      />

      <Button variant="quiet" className="w-full" onClick={() => void handleDiscard()}>
        Discard workout
      </Button>

      <Modal open={finishing} onClose={() => setFinishing(false)} title="Finish workout">
        <FinishForm onFinish={handleFinish} />
      </Modal>
    </div>
  );
}

function ExerciseCard({
  item,
  units,
  sets,
  open,
  gymId,
  sessionId,
  onToggle,
  onLog,
  onAmend,
  onVoid,
  onSubstitute,
}: {
  item: WorkItem;
  units: 'lb' | 'kg';
  sets: FoldResult['sets'];
  open: boolean;
  gymId: string;
  sessionId: string;
  onToggle: () => void;
  onLog: (item: WorkItem, weightKg: number | null, reps: number | null, warmup: boolean) => Promise<void>;
  onAmend: (opId: string, patch: { weightKg?: number | null; reps?: number | null }) => Promise<void>;
  onVoid: (opId: string) => Promise<void>;
  onSubstitute: (replacement: WorkItem, reason: string) => void;
}) {
  const last = sets[sets.length - 1];
  const [weight, setWeight] = useState<number>(() =>
    last?.payload.weightKg != null
      ? Number(kgToDisplay(last.payload.weightKg, units))
      : item.targetKg != null
        ? Number(kgToDisplay(item.targetKg, units))
        : 0,
  );
  const [reps, setReps] = useState<number>(() => last?.payload.reps ?? (parseInt(item.reps, 10) || 8));
  const [warmup, setWarmup] = useState(false);
  const [showPlates, setShowPlates] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = sets.filter((s) => !s.payload.isWarmup).length;
  const step = units === 'kg' ? 2.5 : 5;

  async function log() {
    setBusy(true);
    try {
      await onLog(item, weight > 0 ? displayToKg(weight, units) : null, reps > 0 ? reps : null, warmup);
      setWarmup(false);
    } finally {
      setBusy(false);
    }
  }

  async function recordFormCheck(file: File) {
    try {
      const mediaId = await uploadMedia(file, 'form');
      await api.logging.formReviewCreate.mutate({ setOpId: last?.opId ?? null, mediaId, note: item.exerciseName });
      toast('Sent to your trainer for form review');
    } catch (e) {
      toast(navigator.onLine ? errMessage(e) : 'Form videos need a connection — try after syncing', 'err');
    }
  }

  const plates = platesPerSide(displayToKg(weight, units), units);

  return (
    <Card className={cx('p-0 transition-colors', open && 'border-brand')}>
      <button className="flex w-full items-center justify-between gap-2 p-4 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <div className="truncate font-display text-base font-bold">
            {item.exerciseName}
            {item.substitutedFrom && <span className="ml-1 text-xs font-normal text-steel">(for {item.substitutedFrom})</span>}
          </div>
          <div className="text-xs text-steel">
            {item.sets}×{item.reps} · {item.targetDisplay}
            {item.explain && <span className="block">{item.explain}</span>}
          </div>
        </div>
        <div className="score text-2xl">
          {done}<span className="text-base text-steel">/{item.sets}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-line p-4">
          {sets.length > 0 && (
            <ul className="mb-3 space-y-1">
              {sets.map((s, i) => (
                <li key={s.opId} className="flex items-center justify-between text-sm">
                  <span className={cx('text-steel', s.payload.isWarmup && 'italic')}>
                    {s.payload.isWarmup ? 'warm-up' : `set ${i + 1 - sets.slice(0, i + 1).filter((x) => x.payload.isWarmup).length}`}
                  </span>
                  <span className="score">
                    {s.payload.weightKg != null ? `${kgToDisplay(s.payload.weightKg, units)} ${units} × ` : ''}
                    {s.payload.reps ?? '—'}
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="quiet" aria-label="Fix set" onClick={() => {
                      const w = prompt(`Weight (${units})`, s.payload.weightKg != null ? kgToDisplay(s.payload.weightKg, units) : '');
                      const r = prompt('Reps', String(s.payload.reps ?? ''));
                      if (w != null && r != null) {
                        void onAmend(s.opId, { weightKg: w ? displayToKg(Number(w), units) : null, reps: r ? Number(r) : null });
                      }
                    }}>✎</Button>
                    <Button size="sm" variant="quiet" aria-label="Remove set" onClick={() => void onVoid(s.opId)}>✕</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stepper label={`Weight (${units})`} value={weight} step={step} onChange={setWeight} onTap={() => setShowPlates(true)} />
            <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
          </div>

          <label className="mt-2 flex items-center gap-2 text-sm text-steel">
            <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
            Warm-up set
          </label>

          <Button size="lg" className="mt-3 w-full text-lg" onClick={() => void log()} disabled={busy}>
            Log set
          </Button>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="quiet" size="sm" onClick={() => setShowSubs(true)}>Machine taken?</Button>
            <Button variant="quiet" size="sm" onClick={() => fileRef.current?.click()}>Form check 🎥</Button>
            <Button variant="quiet" size="sm" onClick={() => setShowPlates(true)}>Plates</Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void recordFormCheck(f);
            }}
          />
        </div>
      )}

      <Modal open={showPlates} onClose={() => setShowPlates(false)} title="Plate math">
        <div className="text-center">
          <div className="score text-5xl">{weight} <span className="text-xl">{units}</span></div>
          {plates && plates.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-steel">per side, on a {units === 'kg' ? '20 kg' : '45 lb'} bar</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {plates.map((p) => (
                  <span key={p.plate} className="rounded-lg bg-ink px-3 py-2 font-display font-bold text-white">
                    {p.count} × {p.plate}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-steel">Lighter than the bar — no plates needed.</p>
          )}
        </div>
      </Modal>

      <SubstituteSheet
        open={showSubs}
        onClose={() => setShowSubs(false)}
        item={item}
        onPick={(rep, reason) => {
          setShowSubs(false);
          onSubstitute(rep, reason);
        }}
      />
    </Card>
  );
}

function Stepper({ label, value, step, onChange, onTap }: { label: string; value: number; step: number; onChange: (v: number) => void; onTap?: () => void }) {
  return (
    <div>
      <div className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-steel">{label}</div>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-line">
        <button className="min-w-12 bg-line/40 px-3 text-2xl font-bold active:bg-line" onClick={() => onChange(Math.max(0, +(value - step).toFixed(2)))} aria-label={`decrease ${label}`}>−</button>
        <button onClick={onTap} className="score flex-1 py-2 text-center text-3xl">{value}</button>
        <button className="min-w-12 bg-line/40 px-3 text-2xl font-bold active:bg-line" onClick={() => onChange(+(value + step).toFixed(2))} aria-label={`increase ${label}`}>＋</button>
      </div>
    </div>
  );
}

function SubstituteSheet({ open, onClose, item, onPick }: { open: boolean; onClose: () => void; item: WorkItem; onPick: (rep: WorkItem, reason: string) => void }) {
  const subs = useQuery({
    queryKey: ['substitutes', item.exerciseId],
    queryFn: () => api.equipment.substitutes.query({ exerciseId: item.exerciseId }),
    enabled: open && navigator.onLine,
    retry: false,
  });
  return (
    <Modal open={open} onClose={onClose} title="Swap this exercise">
      <p className="mb-3 text-xs text-steel">Ranked by your gym's graph — only equipment that's free and in service, filtered around your limitations.</p>
      {!navigator.onLine && <p className="mb-2 text-sm text-alarm">Offline — showing nothing new; use the program's planned alternates or keep the exercise.</p>}
      {subs.isFetching && <Spinner />}
      <ul className="space-y-2">
        {(subs.data ?? []).map((s) => (
          <li key={s.exerciseId}>
            <button
              className="w-full rounded-lg border border-line p-3 text-left hover:border-brand"
              onClick={() =>
                onPick(
                  {
                    key: item.key,
                    exerciseId: s.exerciseId,
                    exerciseName: s.name,
                    programItemId: item.programItemId,
                    sets: item.sets,
                    reps: item.reps,
                    targetDisplay: 'match effort',
                    targetKg: null,
                    explain: null,
                    restS: item.restS,
                    notes: null,
                    videoGroupId: s.videoGroupId,
                  },
                  s.reason,
                )
              }
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.name}</span>
                <Badge tone={s.source === 'curated' ? 'brand' : 'steel'}>{s.source}</Badge>
              </div>
              <p className="text-xs text-steel">{s.reason}{s.availableOn ? ` · on ${s.availableOn}` : ''}</p>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function AddExercise({ onAdd }: { onAdd: (ex: { id: string; name: string; videoGroupId: string | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const exercises = useQuery({
    queryKey: ['exercises', '', '', false],
    queryFn: () => api.exercises.list.query({}),
    enabled: open,
    retry: false,
  });
  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>+ Add exercise</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add exercise">
        <input
          autoFocus
          className="mb-2 h-11 w-full rounded-lg border border-line bg-card px-3"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {(exercises.data ?? [])
            .filter((e) => e.available && e.name.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 40)
            .map((e) => (
              <li key={e.id}>
                <button
                  className="w-full rounded-lg px-3 py-2.5 text-left font-semibold hover:bg-line/50"
                  onClick={() => {
                    onAdd({ id: e.id, name: e.name, videoGroupId: e.videoGroupId });
                    setOpen(false);
                  }}
                >
                  {e.name}
                </button>
              </li>
            ))}
        </ul>
      </Modal>
    </>
  );
}

function FinishForm({ onFinish }: { onFinish: (felt: number, notes: string) => Promise<void> }) {
  const [felt, setFelt] = useState(3);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-steel">How did it feel?</p>
        <div className="flex justify-between gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setFelt(n)}
              className={cx(
                'score h-13 min-h-12 flex-1 rounded-lg border text-xl',
                felt === n ? 'border-brand bg-brand text-brand-ink' : 'border-line',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-steel"><span>rough</span><span>unstoppable</span></div>
      </div>
      <TextArea placeholder="Session notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button
        size="lg"
        className="w-full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onFinish(felt, notes);
        }}
      >
        {busy ? 'Saving…' : 'Finish workout'}
      </Button>
    </div>
  );
}

function Celebration({ prs, units, onDone }: { prs: SyncResult['newPrs']; units: 'lb' | 'kg'; onDone: () => void }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
      <div className="pr-pop">
        <div className="text-sm font-bold uppercase tracking-[0.3em] text-signal">Personal record{prs.length > 1 ? 's' : ''}</div>
        {prs.slice(0, 3).map((p) => (
          <div key={`${p.exerciseName}-${p.kind}`} className="mt-4">
            <div className="font-display text-xl font-bold">{p.exerciseName}</div>
            <div className="score text-6xl text-signal">
              {kgToDisplay(p.value, units)}
              <span className="text-2xl"> {p.kind === 'e1rm' ? `${units} e1RM` : units}</span>
            </div>
            {p.previous != null && (
              <div className="text-sm text-steel">up from {kgToDisplay(p.previous, units)} {units}</div>
            )}
          </div>
        ))}
      </div>
      <Button size="lg" className="mt-10 w-full max-w-xs" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
