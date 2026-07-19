import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../state/me';
import { Card, EmptyState, Spinner } from '../../components/ui';
import { dateTime, weightLabel } from '../../lib/format';

export function History() {
  const { units } = useMe();
  const history = useQuery({ queryKey: ['history', 'me'], queryFn: () => api.logging.history.query({}), retry: false });

  if (history.isLoading) return <Spinner />;
  if (!history.data?.length) {
    return <EmptyState title="No workouts yet" body="Your completed sessions land here — including everything logged offline." />;
  }
  return (
    <div className="space-y-2">
      <h1 className="font-display text-xl font-bold">History</h1>
      {history.data.map((s) => (
        <Link key={s.id} to={`/me/history/${s.id}`} className="block">
          <Card className="flex items-center justify-between py-3 hover:border-brand">
            <div>
              <div className="font-semibold">{s.title ?? 'Workout'}</div>
              <div className="text-xs text-steel">{dateTime(s.startedAt)}</div>
            </div>
            <div className="text-right">
              <div className="score">{s.setCount} sets</div>
              <div className="text-xs text-steel">{weightLabel(s.volumeKg, units)} total</div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
