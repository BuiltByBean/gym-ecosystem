import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Card, Spinner } from '../../components/ui';
import { dateTime, kgToDisplay } from '../../lib/format';

export function SessionDetail() {
  const { sessionId = '' } = useParams();
  const { units } = useMe();
  const detail = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.logging.sessionDetail.query({ sessionId }),
    retry: false,
  });

  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return <p className="text-steel">Not found.</p>;
  const { session, sets, substitutions, exercises } = detail.data;
  const name = (id: string | null) => exercises.find((e) => e.id === id)?.name ?? 'Exercise';

  const byExercise = new Map<string, typeof sets>();
  for (const s of sets.filter((x) => !x.voided)) {
    const k = s.exerciseId ?? '?';
    byExercise.set(k, [...(byExercise.get(k) ?? []), s]);
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-xl font-bold">{session.title ?? 'Workout'}</h1>
        <p className="text-sm text-steel">
          {dateTime(session.startedAt)}
          {session.feltRating && ` · felt ${session.feltRating}/5`}
        </p>
        {session.notes && <p className="mt-1 text-sm">{session.notes}</p>}
      </div>
      {substitutions.length > 0 && (
        <Card className="py-3">
          {substitutions.map((s) => (
            <p key={s.opId} className="text-xs text-steel">
              Swapped {name(s.fromExerciseId)} → {name(s.toExerciseId)}
              {s.reason && ` (${s.reason})`}
            </p>
          ))}
        </Card>
      )}
      {[...byExercise.entries()].map(([exId, exSets]) => (
        <Card key={exId}>
          <h3 className="mb-2 font-display font-bold">{name(exId)}</h3>
          <ul className="space-y-1">
            {exSets.map((s, i) => (
              <li key={s.opId} className="flex justify-between text-sm">
                <span className="text-steel">
                  {s.payload.isWarmup ? <Badge>warm-up</Badge> : `Set ${i + 1}`}
                </span>
                <span className="score">
                  {s.payload.weightKg != null && `${kgToDisplay(s.payload.weightKg, units)} ${units} × `}
                  {s.payload.reps ?? '—'}
                  {s.payload.rpe != null && <span className="ml-1 text-xs text-steel">@{s.payload.rpe}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
