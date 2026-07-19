import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Tile, toast } from '../../components/ui';
import { LineChart, StackedWeeklyBars } from '../../components/charts';
import { kgToDisplay, shortDate } from '../../lib/format';

export function Progress() {
  const { units } = useMe();
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['progressSummary'], queryFn: () => api.logging.progressSummary.query({}), retry: false });
  const volume = useQuery({ queryKey: ['volume'], queryFn: () => api.logging.volumeBreakdown.query({}), retry: false });
  const metrics = useQuery({ queryKey: ['bodyMetrics'], queryFn: () => api.logging.bodyMetrics.query({}), retry: false });

  const trackedExercises = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pr of summary.data?.recentPrs ?? []) seen.set(pr.exerciseId, pr.exerciseName);
    return [...seen.entries()];
  }, [summary.data]);
  const [exerciseId, setExerciseId] = useState('');
  const effectiveExercise = exerciseId || trackedExercises[0]?.[0] || '';
  const trend = useQuery({
    queryKey: ['trend', effectiveExercise],
    queryFn: () => api.logging.exerciseTrend.query({ exerciseId: effectiveExercise }),
    enabled: Boolean(effectiveExercise),
    retry: false,
  });

  const volumeWeeks = useMemo(() => {
    const byWeek = new Map<string, Record<string, number>>();
    for (const r of volume.data?.byRegion ?? []) {
      const w = byWeek.get(r.week) ?? {};
      w[r.key] = (w[r.key] ?? 0) + r.volume;
      byWeek.set(r.week, w);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, values]) => ({ label: shortDate(week), values }));
  }, [volume.data]);
  const regions = useMemo(
    () => [...new Set((volume.data?.byRegion ?? []).map((r) => r.key))].sort(),
    [volume.data],
  );

  const [showWeight, setShowWeight] = useState(false);
  const [weight, setWeight] = useState('');
  const addMetric = useMutation({
    mutationFn: () =>
      api.logging.bodyMetricAdd.mutate({
        weightKg: units === 'kg' ? Number(weight) : Number(weight) * 0.45359237,
      }),
    onSuccess: () => {
      toast('Logged');
      setShowWeight(false);
      setWeight('');
      qc.invalidateQueries({ queryKey: ['bodyMetrics'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (summary.isLoading) return <Spinner />;
  const s = summary.data;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Progress</h1>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Week streak" value={s?.streak.current ?? 0} sub={`best ${s?.streak.best ?? 0}`} tone={s && s.streak.current > 0 ? 'signal' : undefined} />
        <Tile label="Last 30 days" value={s?.sessions30d ?? 0} sub="workouts" />
        <Tile label="All time" value={s?.totalSessions ?? 0} sub="workouts" />
      </div>

      {s && s.recentPrs.length > 0 && (
        <Card>
          <h3 className="mb-2 font-display font-bold">Recent records</h3>
          <ul className="space-y-1.5">
            {s.recentPrs.slice(0, 5).map((pr) => (
              <li key={pr.id} className="flex items-center justify-between text-sm">
                <span className="font-semibold">{pr.exerciseName}</span>
                <span className="score text-signal">
                  {kgToDisplay(Number(pr.value), units)} {units}
                  <span className="ml-1 text-xs text-steel">{pr.kind === 'e1rm' ? 'e1RM' : 'top set'}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {trackedExercises.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-display font-bold">Strength trend</h3>
            <Select className="!h-9 w-44 text-sm" value={effectiveExercise} onChange={(e) => setExerciseId(e.target.value)}>
              {trackedExercises.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </div>
          <p className="mb-2 text-xs text-steel">Estimated 1-rep max per session — you care that it's more than last month.</p>
          {trend.isFetching ? (
            <Spinner />
          ) : (
            <LineChart
              points={(trend.data ?? []).map((t) => ({ label: shortDate(t.date), value: t.e1rmKg ?? t.topWeightKg ?? 0 }))}
              format={(v) => `${kgToDisplay(v, units)}`}
            />
          )}
        </Card>
      )}

      {volumeWeeks.length > 0 && (
        <Card>
          <h3 className="mb-2 font-display font-bold">Weekly volume by muscle group</h3>
          <StackedWeeklyBars
            weeks={volumeWeeks}
            categories={regions}
            format={(v) => `${kgToDisplay(v, units)} ${units}`}
          />
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold">Bodyweight</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowWeight(true)}>Log</Button>
        </div>
        {metrics.data && metrics.data.length > 0 ? (
          <LineChart
            points={[...metrics.data]
              .reverse()
              .filter((m) => m.weightKg != null)
              .map((m) => ({ label: shortDate(m.measuredAt), value: Number(m.weightKg) }))}
            format={(v) => `${kgToDisplay(v, units)}`}
            height={120}
          />
        ) : (
          <p className="mt-1 text-sm text-steel">Log a weigh-in to start the trend. Only you and trainers you allow can see this.</p>
        )}
      </Card>

      <Modal open={showWeight} onClose={() => setShowWeight(false)} title="Log bodyweight">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addMetric.mutate();
          }}
        >
          <Field label={`Weight (${units})`}>
            <Input type="number" step="0.1" min={1} required value={weight} onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" disabled={addMetric.isPending}>Save</Button>
        </form>
      </Modal>
    </div>
  );
}
