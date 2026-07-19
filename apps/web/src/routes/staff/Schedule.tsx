import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Td, Table, toast } from '../../components/ui';
import { WEEKDAYS, dateTime, minutesToTime, money, timeOnly } from '../../lib/format';

export function Schedule() {
  const { isAdminish, isTrainer } = useMe();
  const [tab, setTab] = useState<'bookings' | 'availability' | 'types' | 'incidents'>('bookings');
  const tabs = [
    { key: 'bookings' as const, label: 'Bookings' },
    ...(isTrainer || isAdminish ? [{ key: 'availability' as const, label: 'Availability' }] : []),
    ...(isAdminish ? [{ key: 'types' as const, label: 'Session types' }, { key: 'incidents' as const, label: 'Incidents' }] : []),
  ];
  return (
    <>
      <PageHeader title="Schedule" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'bookings' && <Bookings />}
      {tab === 'availability' && <Availability />}
      {tab === 'types' && <SessionTypes />}
      {tab === 'incidents' && <Incidents />}
    </>
  );
}

function weekRange(offset: number): { from: string; to: string; label: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(end.getTime() - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
  };
}

function Bookings() {
  const qc = useQueryClient();
  const { me } = useMe();
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => weekRange(offset), [offset]);
  const bookings = useQuery({
    queryKey: ['bookings', range.from],
    queryFn: () => api.scheduling.list.query({ from: range.from, to: range.to }),
  });
  const [showBook, setShowBook] = useState(false);

  const cancel = useMutation({
    mutationFn: (bookingId: string) => api.scheduling.cancel.mutate({ bookingId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const complete = useMutation({
    mutationFn: (bookingId: string) => api.scheduling.complete.mutate({ bookingId, noShowMemberIds: [] }),
    onSuccess: () => {
      toast('Completed — package credit redeemed if attached');
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const noShow = useMutation({
    mutationFn: (v: { bookingId: string; memberIds: string[] }) =>
      api.scheduling.complete.mutate({ bookingId: v.bookingId, noShowMemberIds: v.memberIds }),
    onSuccess: () => {
      toast('Marked no-show; fee posted');
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof bookings.data>>();
    for (const b of bookings.data ?? []) {
      const day = new Date(b.startsAt).toDateString();
      map.set(day, [...(map.get(day) ?? []), b]);
    }
    return [...map.entries()];
  }, [bookings.data]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOffset(offset - 1)}>←</Button>
          <span className="font-display font-bold">{range.label}</span>
          <Button size="sm" variant="ghost" onClick={() => setOffset(offset + 1)}>→</Button>
        </div>
        <Button onClick={() => setShowBook(true)}>Book session</Button>
      </div>
      {bookings.isLoading ? (
        <Spinner />
      ) : byDay.length === 0 ? (
        <Card className="py-8 text-center text-sm text-steel">No sessions this week.</Card>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, list]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-bold text-steel">{day}</h3>
              <div className="space-y-2">
                {list!.map((b) => (
                  <Card key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <span className="score text-lg">{timeOnly(b.startsAt)}</span>
                      <span className="ml-2 font-semibold">{b.sessionTypeName}</span>
                      <span className="ml-2 text-sm text-steel">
                        {b.trainerName} · {b.attendees.map((a) => `${a.firstName} ${a.lastName}`).join(', ')}
                      </span>
                      {b.rateAppliedCents != null && (
                        <span className="ml-2 text-xs text-steel">{money(b.rateAppliedCents, me?.gym?.currency)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={b.status === 'booked' ? 'brand' : b.status === 'completed' ? 'signal' : 'alarm'}>
                        {b.status.replace('_', ' ')}
                      </Badge>
                      {b.status === 'booked' && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => complete.mutate(b.id)}>Complete</Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => noShow.mutate({ bookingId: b.id, memberIds: b.attendees.map((a) => a.memberId) })}
                          >
                            No-show
                          </Button>
                          <Button size="sm" variant="quiet" onClick={() => cancel.mutate(b.id)}>Cancel</Button>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <BookModal open={showBook} onClose={() => setShowBook(false)} />
    </>
  );
}

function BookModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const trainers = useQuery({ queryKey: ['trainers'], queryFn: () => api.scheduling.trainers.query() });
  const types = useQuery({ queryKey: ['sessionTypes'], queryFn: () => api.scheduling.sessionTypes.query() });
  const members = useQuery({ queryKey: ['members', '', ''], queryFn: () => api.members.list.query({}) });
  const [form, setForm] = useState({ trainerUserId: '', sessionTypeId: '', memberId: '', date: new Date().toISOString().slice(0, 10) });

  const slots = useQuery({
    queryKey: ['slots', form.trainerUserId, form.sessionTypeId, form.date],
    queryFn: () =>
      api.scheduling.slots.query({
        trainerUserId: form.trainerUserId,
        sessionTypeId: form.sessionTypeId,
        fromDate: form.date,
        days: 1,
      }),
    enabled: Boolean(form.trainerUserId && form.sessionTypeId && form.date),
  });

  const book = useMutation({
    mutationFn: (startsAt: string) =>
      api.scheduling.book.mutate({
        trainerUserId: form.trainerUserId,
        sessionTypeId: form.sessionTypeId,
        memberId: form.memberId,
        startsAt,
      }),
    onSuccess: () => {
      toast('Booked');
      qc.invalidateQueries({ queryKey: ['bookings'] });
      onClose();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Book a session">
      <div className="space-y-3">
        <Field label="Member">
          <Select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
            <option value="">Choose…</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trainer">
            <Select value={form.trainerUserId} onChange={(e) => setForm({ ...form, trainerUserId: e.target.value })}>
              <option value="">Choose…</option>
              {trainers.data?.map((t) => <option key={t.userId} value={t.userId}>{t.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Session type">
            <Select value={form.sessionTypeId} onChange={(e) => setForm({ ...form, sessionTypeId: e.target.value })}>
              <option value="">Choose…</option>
              {types.data?.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        {slots.data && (
          <div className="flex flex-wrap gap-1.5">
            {slots.data.length === 0 && <p className="text-sm text-steel">No open slots that day.</p>}
            {slots.data.map((s) => (
              <Button key={s.startsAt} size="sm" variant="ghost" disabled={!form.memberId || book.isPending} onClick={() => book.mutate(s.startsAt)}>
                {timeOnly(s.startsAt)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Availability() {
  const qc = useQueryClient();
  const { me, isAdminish } = useMe();
  const trainers = useQuery({ queryKey: ['trainers'], queryFn: () => api.scheduling.trainers.query() });
  const [trainerId, setTrainerId] = useState<string>('');
  const effective = trainerId || me?.user?.id || '';
  const avail = useQuery({
    queryKey: ['availability', effective],
    queryFn: () => api.scheduling.myAvailability.query({ trainerUserId: effective || undefined }),
    enabled: Boolean(effective),
  });
  const [rows, setRows] = useState<{ weekday: number; startMin: number; endMin: number }[] | null>(null);
  const current = rows ?? avail.data?.templates.map((t) => ({ weekday: t.weekday, startMin: t.startMin, endMin: t.endMin })) ?? [];

  const save = useMutation({
    mutationFn: () =>
      api.scheduling.availabilitySetTemplate.mutate({ trainerUserId: effective || undefined, rows: current }),
    onSuccess: () => {
      toast('Availability saved');
      setRows(null);
      qc.invalidateQueries({ queryKey: ['availability', effective] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <Card className="max-w-2xl">
      {isAdminish && (
        <Field label="Trainer">
          <Select value={trainerId} onChange={(e) => { setTrainerId(e.target.value); setRows(null); }}>
            <option value="">Myself</option>
            {trainers.data?.map((t) => <option key={t.userId} value={t.userId}>{t.displayName}</option>)}
          </Select>
        </Field>
      )}
      <div className="mt-3 space-y-2">
        {current.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              className="w-28"
              value={r.weekday}
              onChange={(e) => setRows(current.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}
            >
              {WEEKDAYS.map((d, wi) => <option key={d} value={wi}>{d}</option>)}
            </Select>
            <TimeSelect value={r.startMin} onChange={(v) => setRows(current.map((x, j) => (j === i ? { ...x, startMin: v } : x)))} />
            <span className="text-steel">to</span>
            <TimeSelect value={r.endMin} onChange={(v) => setRows(current.map((x, j) => (j === i ? { ...x, endMin: v } : x)))} />
            <Button size="sm" variant="quiet" onClick={() => setRows(current.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRows([...current, { weekday: 1, startMin: 9 * 60, endMin: 17 * 60 }])}>
          + window
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || rows === null}>Save</Button>
      </div>
      <p className="mt-3 text-xs text-steel">Members can self-book inside these windows. One-off blocks and time off can be layered on top (coming next).</p>
    </Card>
  );
}

function TimeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options: number[] = [];
  for (let m = 5 * 60; m <= 22 * 60; m += 30) options.push(m);
  return (
    <Select className="w-28" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((m) => <option key={m} value={m}>{minutesToTime(m)}</option>)}
    </Select>
  );
}

function SessionTypes() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['sessionTypes'], queryFn: () => api.scheduling.sessionTypes.query() });
  const [form, setForm] = useState({ name: '', durationMin: 60, requiresPackage: true });
  const save = useMutation({
    mutationFn: () => api.scheduling.sessionTypeSave.mutate({ ...form, capacity: 1, active: true }),
    onSuccess: () => {
      toast('Session type saved');
      setForm({ name: '', durationMin: 60, requiresPackage: true });
      qc.invalidateQueries({ queryKey: ['sessionTypes'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-display font-bold">New session type</h3>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Personal Training 60" /></Field>
          <Field label="Duration (min)">
            <Input type="number" min={15} max={240} step={15} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.requiresPackage} onChange={(e) => setForm({ ...form, requiresPackage: e.target.checked })} />
            Requires a session package to book
          </label>
          <Button type="submit" disabled={save.isPending}>Save</Button>
        </form>
      </Card>
      <div>
        <Table head={['Type', 'Duration', 'Package', 'Active']}>
          {(types.data ?? []).map((t) => (
            <tr key={t.id}>
              <Td className="font-semibold">{t.name}</Td>
              <Td>{t.durationMin} min</Td>
              <Td>{t.requiresPackage ? <Badge tone="brand">required</Badge> : <span className="text-xs text-steel">—</span>}</Td>
              <Td><Badge tone={t.active ? 'signal' : 'steel'}>{t.active ? 'yes' : 'no'}</Badge></Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

function Incidents() {
  const qc = useQueryClient();
  const { me } = useMe();
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api.scheduling.incidents.query({}) });
  const resolve = useMutation({
    mutationFn: (v: { incidentId: string; status: 'waived' | 'collected' }) => api.scheduling.incidentResolve.mutate(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
    onError: (e) => toast(errMessage(e), 'err'),
  });
  if (incidents.isLoading) return <Spinner />;
  return (
    <Table head={['Member', 'Kind', 'Session', 'Fee', 'Status', '']}>
      {(incidents.data ?? []).map((r) => (
        <tr key={r.incident.id}>
          <Td className="font-semibold">{r.firstName} {r.lastName}</Td>
          <Td><Badge tone="alarm">{r.incident.kind.replace('_', ' ')}</Badge></Td>
          <Td className="text-steel">{dateTime(r.startsAt)}</Td>
          <Td>{money(r.incident.feeCents, me?.gym?.currency)}</Td>
          <Td><Badge tone={r.incident.status === 'posted' ? 'alarm' : 'steel'}>{r.incident.status}</Badge></Td>
          <Td className="text-right">
            {r.incident.status === 'posted' && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ incidentId: r.incident.id, status: 'collected' })}>Collected</Button>
                <Button size="sm" variant="quiet" onClick={() => resolve.mutate({ incidentId: r.incident.id, status: 'waived' })}>Waive</Button>
              </div>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
