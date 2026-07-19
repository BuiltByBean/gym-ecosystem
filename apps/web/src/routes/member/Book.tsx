import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Badge, Button, Card, Select, Spinner, toast } from '../../components/ui';
import { dateTime, timeOnly } from '../../lib/format';

export function Book() {
  const qc = useQueryClient();
  const trainers = useQuery({ queryKey: ['trainers'], queryFn: () => api.scheduling.trainers.query(), retry: false });
  const types = useQuery({ queryKey: ['sessionTypes'], queryFn: () => api.scheduling.sessionTypes.query(), retry: false });
  const packages = useQuery({ queryKey: ['myPackages'], queryFn: () => api.money.memberPackages.query({}), retry: false });

  const [trainerUserId, setTrainerUserId] = useState('');
  const [sessionTypeId, setSessionTypeId] = useState('');

  const range = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 30);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const myBookings = useQuery({
    queryKey: ['myBookings'],
    queryFn: () => api.scheduling.list.query(range),
    retry: false,
  });

  const slots = useQuery({
    queryKey: ['slots', trainerUserId, sessionTypeId],
    queryFn: () =>
      api.scheduling.slots.query({
        trainerUserId,
        sessionTypeId,
        fromDate: new Date().toISOString().slice(0, 10),
        days: 10,
      }),
    enabled: Boolean(trainerUserId && sessionTypeId),
  });

  const book = useMutation({
    mutationFn: (startsAt: string) => api.scheduling.book.mutate({ trainerUserId, sessionTypeId, startsAt }),
    onSuccess: () => {
      toast('Booked — see you there');
      qc.invalidateQueries({ queryKey: ['myBookings'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const cancel = useMutation({
    mutationFn: (bookingId: string) => api.scheduling.cancel.mutate({ bookingId }),
    onSuccess: (r) => {
      toast(r.status === 'late_cancelled' ? 'Cancelled — inside the window, a late fee applies' : 'Cancelled');
      qc.invalidateQueries({ queryKey: ['myBookings'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const slotsByDay = useMemo(() => {
    const map = new Map<string, { startsAt: string }[]>();
    for (const s of slots.data ?? []) {
      const day = new Date(s.startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      map.set(day, [...(map.get(day) ?? []), s]);
    }
    return [...map.entries()];
  }, [slots.data]);

  const totalCredits = (packages.data ?? []).reduce((s, p) => s + Math.max(0, p.balance), 0);
  const upcoming = (myBookings.data ?? []).filter((b) => b.status === 'booked');

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Book training</h1>

      {upcoming.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-steel">Upcoming</h3>
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-semibold">{b.sessionTypeName} · {b.trainerName}</div>
                  <div className="text-xs text-steel">{dateTime(b.startsAt)}</div>
                </div>
                <Button size="sm" variant="quiet" onClick={() => cancel.mutate(b.id)}>Cancel</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display font-bold">Find a time</h3>
          <Badge tone={totalCredits > 0 ? 'signal' : 'steel'}>{totalCredits} session credits</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={trainerUserId} onChange={(e) => setTrainerUserId(e.target.value)}>
            <option value="">Trainer…</option>
            {trainers.data?.map((t) => (
              <option key={t.userId} value={t.userId}>{t.displayName}</option>
            ))}
          </Select>
          <Select value={sessionTypeId} onChange={(e) => setSessionTypeId(e.target.value)}>
            <option value="">Session…</option>
            {types.data?.filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
        {trainerUserId && sessionTypeId && (
          <div className="mt-3">
            {slots.isFetching && <Spinner />}
            {slotsByDay.length === 0 && !slots.isFetching && (
              <p className="text-sm text-steel">No open times in the next 10 days — try another trainer.</p>
            )}
            {slotsByDay.map(([day, daySlots]) => (
              <div key={day} className="mb-3">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-steel">{day}</div>
                <div className="flex flex-wrap gap-1.5">
                  {daySlots.map((s) => (
                    <Button key={s.startsAt} size="sm" variant="ghost" disabled={book.isPending} onClick={() => book.mutate(s.startsAt)}>
                      {timeOnly(s.startsAt)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {trainers.data?.length === 0 && <p className="text-sm text-steel">No trainers have published availability yet.</p>}
      </Card>
    </div>
  );
}
