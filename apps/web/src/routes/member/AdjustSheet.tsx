/* "Not feeling it today" — the member says what's bothering them and the app
 * reworks this session only. Nothing is written to their program. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Outputs } from '../../api';
import { Badge, Button, Modal, Spinner, cx } from '../../components/ui';

type Reason = 'soreness' | 'injury' | 'equipment';
type Suggestion = Outputs['programs']['adjustDay'][number];

export function AdjustSheet({
  open,
  onClose,
  programVersionId,
  dayId,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  programVersionId: string;
  dayId: string;
  onApply: (swaps: { fromExerciseId: string; toExerciseId: string; toName: string; reason: string }[]) => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [muscleKey, setMuscleKey] = useState<string | null>(null);
  const [bodyArea, setBodyArea] = useState<string | null>(null);
  const [equipmentModelId, setEquipmentModelId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const options = useQuery({
    queryKey: ['adjustOptions', programVersionId, dayId],
    queryFn: () => api.programs.adjustOptions.query({ programVersionId, dayId }),
    enabled: open,
  });

  const ready =
    (reason === 'soreness' && muscleKey) ||
    (reason === 'injury' && bodyArea) ||
    (reason === 'equipment' && equipmentModelId);

  const suggestions = useQuery({
    queryKey: ['adjustDay', programVersionId, dayId, reason, muscleKey, bodyArea, equipmentModelId],
    queryFn: () =>
      api.programs.adjustDay.query({
        programVersionId,
        dayId,
        reason: reason!,
        muscleKeys: muscleKey ? [muscleKey] : undefined,
        bodyArea: bodyArea ?? undefined,
        equipmentModelId: equipmentModelId ?? undefined,
      }),
    enabled: open && Boolean(ready),
  });

  function reset() {
    setReason(null);
    setMuscleKey(null);
    setBodyArea(null);
    setEquipmentModelId(null);
    setChosen({});
  }

  function apply() {
    const list = (suggestions.data ?? [])
      .map((s: Suggestion) => {
        const toId = chosen[s.itemId] ?? s.replacement?.exerciseId;
        if (!toId) return null;
        const alt = s.alternatives.find((a) => a.exerciseId === toId) ?? s.replacement!;
        return { fromExerciseId: s.exerciseId, toExerciseId: toId, toName: alt.name, reason: s.reason };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    onApply(list);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Adjust today's workout"
    >
      {!reason && (
        <div className="space-y-2">
          <p className="text-sm text-steel">What's going on today?</p>
          {([
            ['soreness', '😮‍💨', 'Still sore', 'Something from your last session hasn’t recovered'],
            ['injury', '🤕', 'Something hurts', 'Work around a joint or area'],
            ['equipment', '⛔', 'Equipment is busy', 'Swap what you can’t get to right now'],
          ] as const).map(([key, icon, label, sub]) => (
            <button
              key={key}
              className="flex w-full items-center gap-3 rounded-lg border border-line p-3 text-left hover:border-brand"
              onClick={() => setReason(key)}
            >
              <span className="text-2xl" aria-hidden>{icon}</span>
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-steel">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {reason && !ready && (
        <div className="space-y-3">
          <button className="text-xs font-semibold text-steel" onClick={reset}>← back</button>
          {options.isLoading && <Spinner />}
          {reason === 'soreness' && (
            <>
              <p className="text-sm font-semibold">Which muscle is sore?</p>
              <div className="flex flex-wrap gap-1.5">
                {options.data?.muscles.map((m) => (
                  <button
                    key={m.key}
                    className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand"
                    onClick={() => setMuscleKey(m.key)}
                  >
                    {m.name}
                  </button>
                ))}
                {options.data?.muscles.length === 0 && (
                  <p className="text-sm text-steel">Today's work doesn't target a specific muscle group.</p>
                )}
              </div>
            </>
          )}
          {reason === 'injury' && (
            <>
              <p className="text-sm font-semibold">Where does it hurt?</p>
              <div className="flex flex-wrap gap-1.5">
                {options.data?.bodyAreas.map((a) => (
                  <button
                    key={a}
                    className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold capitalize hover:border-brand"
                    onClick={() => setBodyArea(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <p className="text-xs text-steel">
                If it's sharp or new, tell your trainer — this only reshuffles today.
              </p>
            </>
          )}
          {reason === 'equipment' && (
            <>
              <p className="text-sm font-semibold">What can't you get to?</p>
              <div className="flex flex-wrap gap-1.5">
                {options.data?.equipment.map((e) => (
                  <button
                    key={e.modelId}
                    className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand"
                    onClick={() => setEquipmentModelId(e.modelId)}
                  >
                    {e.name}
                  </button>
                ))}
                {options.data?.equipment.length === 0 && (
                  <p className="text-sm text-steel">Today's work doesn't depend on a specific machine.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {ready && (
        <div className="space-y-3">
          <button className="text-xs font-semibold text-steel" onClick={reset}>← start over</button>
          {suggestions.isFetching && <Spinner label="Reworking your session…" />}
          {suggestions.data?.length === 0 && (
            <p className="text-sm">
              Nothing in today's workout conflicts with that — you're good to go as planned.
            </p>
          )}
          {(suggestions.data ?? []).map((s: Suggestion) => {
            const selected = chosen[s.itemId] ?? s.replacement?.exerciseId ?? null;
            return (
              <div key={s.itemId} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold line-through decoration-alarm/60">{s.exerciseName}</span>
                  <Badge tone="alarm">{s.reason}</Badge>
                </div>
                {s.alternatives.length === 0 ? (
                  <p className="mt-1 text-xs text-steel">
                    No safe swap available — skip it today and mention it to your trainer.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {s.alternatives.map((a) => (
                      <button
                        key={a.exerciseId}
                        onClick={() => setChosen({ ...chosen, [s.itemId]: a.exerciseId })}
                        className={cx(
                          'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm',
                          selected === a.exerciseId ? 'border-brand bg-brand/10 font-semibold' : 'border-line',
                        )}
                      >
                        <span>{a.name}</span>
                        <span className="text-[11px] text-steel">{a.reason}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {(suggestions.data?.length ?? 0) > 0 && (
            <Button size="lg" className="w-full" onClick={apply}>
              Use these for today
            </Button>
          )}
          <p className="text-center text-xs text-steel">
            Only today's session changes — your program stays as written.
          </p>
        </div>
      )}
    </Modal>
  );
}
