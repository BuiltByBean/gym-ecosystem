import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Badge, Button, Card, Input, PageHeader, Spinner, toast } from '../../components/ui';
import { timeOnly } from '../../lib/format';

/** Front desk: search → check in → today's sessions. No health, no notes, no money. */
export function FrontDesk() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const members = useQuery({
    queryKey: ['members', search, ''],
    queryFn: () => api.members.list.query({ search: search || undefined }),
    enabled: search.length >= 2,
  });
  const recent = useQuery({ queryKey: ['recentCheckins'], queryFn: () => api.scheduling.recentCheckins.query() });
  const today = useQuery({
    queryKey: ['bookings', 'today'],
    queryFn: () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400_000);
      return api.scheduling.list.query({ from: start.toISOString(), to: end.toISOString() });
    },
  });

  const checkin = useMutation({
    mutationFn: (v: { memberId: string; bookingId?: string }) => api.scheduling.checkin.mutate(v),
    onSuccess: () => {
      toast('Checked in');
      setSearch('');
      qc.invalidateQueries({ queryKey: ['recentCheckins'] });
      qc.invalidateQueries({ queryKey: ['bookings', 'today'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <>
      <PageHeader title="Front desk" sub="Check members in and manage today's sessions" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-display font-bold">Check-in</h3>
          <Input
            autoFocus
            placeholder="Start typing a member's name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!h-13 text-lg"
          />
          {members.isFetching && <Spinner />}
          <ul className="mt-2 space-y-1">
            {search.length >= 2 &&
              members.data?.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => checkin.mutate({ memberId: m.id! })}
                    className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-3 text-left hover:border-brand"
                  >
                    <span className="font-semibold">{m.firstName} {m.lastName}</span>
                    <Badge tone={m.status === 'active' ? 'signal' : 'alarm'}>{m.status}</Badge>
                  </button>
                </li>
              ))}
          </ul>
          <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-steel">Recent</h4>
          <ul className="mt-1 divide-y divide-line/60 text-sm">
            {recent.data?.map((c) => (
              <li key={c.id} className="flex justify-between py-1.5">
                <span>{c.firstName} {c.lastName}</span>
                <span className="text-steel">{timeOnly(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="mb-2 font-display font-bold">Today's sessions</h3>
          {today.isLoading ? (
            <Spinner />
          ) : today.data?.length ? (
            <ul className="space-y-2">
              {today.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <div>
                    <span className="score">{timeOnly(b.startsAt)}</span>
                    <span className="ml-2 text-sm font-semibold">{b.sessionTypeName}</span>
                    <span className="ml-2 text-sm text-steel">{b.trainerName}</span>
                    <div className="text-xs text-steel">{b.attendees.map((a) => `${a.firstName} ${a.lastName}`).join(', ')}</div>
                  </div>
                  {b.status === 'booked' && b.attendees.some((a) => a.status === 'booked') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => checkin.mutate({ memberId: b.attendees[0]!.memberId, bookingId: b.id })}
                    >
                      Check in
                    </Button>
                  )}
                  {b.attendees.some((a) => a.status === 'checked_in') && <Badge tone="signal">here</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-steel">No sessions today.</p>
          )}
        </Card>
      </div>
    </>
  );
}
