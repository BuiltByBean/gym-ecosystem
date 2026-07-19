import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, TextArea, Td, Table, toast } from '../../components/ui';
import { dateTime, money, shortDate, weightLabel } from '../../lib/format';

type Tab = 'profile' | 'health' | 'training' | 'packages' | 'activity';

export function MemberDetail() {
  const { memberId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('profile');
  const { isAdminish, isFrontDesk } = useMe();
  const qc = useQueryClient();

  const member = useQuery({
    queryKey: ['member', memberId],
    queryFn: () => api.members.get.query({ memberId }),
  });

  const invite = useMutation({
    mutationFn: () => api.members.invite.mutate({ memberId }),
    onSuccess: async (r) => {
      await navigator.clipboard.writeText(r.inviteUrl).catch(() => {});
      toast('Invite link copied to clipboard');
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (member.isLoading) return <Spinner />;
  if (!member.data) return <PageHeader title="Member not found" />;
  const m = member.data;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(!isFrontDesk || isAdminish ? ([{ key: 'health', label: 'Health' }] as const) : []),
    { key: 'training', label: 'Training' },
    { key: 'packages', label: 'Packages' },
    ...(!isFrontDesk || isAdminish ? ([{ key: 'activity', label: 'Activity' }] as const) : []),
  ];

  return (
    <>
      <PageHeader
        title={`${m.firstName} ${m.lastName}`}
        sub={`${m.status}${m.membershipType ? ` · ${m.membershipType}` : ''}`}
        actions={
          <>
            {!m.hasLogin && m.email && isAdminish && (
              <Button variant="ghost" onClick={() => invite.mutate()} disabled={invite.isPending}>
                {invite.isPending ? 'Creating…' : 'Invite to app'}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={m.waiverSigned ? 'signal' : 'alarm'}>{m.waiverSigned ? 'Waiver signed' : 'Waiver missing'}</Badge>
        <Badge tone={m.screeningDone ? 'signal' : 'steel'}>{m.screeningDone ? 'Screening done' : 'No screening'}</Badge>
        {m.screeningFlagged && <Badge tone="alarm">Screening flagged</Badge>}
        {(m.assignedTrainers ?? []).map((t) => (
          <Badge key={t.trainerUserId} tone="brand">Trainer: {t.trainerName}</Badge>
        ))}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <ProfileTab memberId={memberId} m={m} readOnly={!isAdminish} />}
      {tab === 'health' && <HealthTab memberId={memberId} />}
      {tab === 'training' && <TrainingTab memberId={memberId} m={m} />}
      {tab === 'packages' && <PackagesTab memberId={memberId} />}
      {tab === 'activity' && <ActivityTab memberId={memberId} />}
    </>
  );
}

function ProfileTab({ memberId, m, readOnly }: { memberId: string; m: Record<string, unknown>; readOnly: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: String(m.firstName ?? ''),
    lastName: String(m.lastName ?? ''),
    email: String(m.email ?? ''),
    phone: String(m.phone ?? ''),
    status: String(m.status ?? 'active'),
    membershipType: String(m.membershipType ?? ''),
    emergencyName: String(m.emergencyName ?? ''),
    emergencyPhone: String(m.emergencyPhone ?? ''),
    goalsNote: String(m.goalsNote ?? ''),
  });
  const save = useMutation({
    mutationFn: () =>
      api.members.update.mutate({
        memberId,
        patch: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || null,
          phone: form.phone || null,
          status: form.status as never,
          membershipType: form.membershipType || null,
          emergencyName: form.emergencyName || null,
          emergencyPhone: form.emergencyPhone || null,
          goalsNote: form.goalsNote || null,
        },
      }),
    onSuccess: () => {
      toast('Saved');
      qc.invalidateQueries({ queryKey: ['member', memberId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <Card className="max-w-2xl">
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="First name"><Input disabled={readOnly} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
        <Field label="Last name"><Input disabled={readOnly} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
        <Field label="Email"><Input disabled={readOnly} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><Input disabled={readOnly} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Status">
          <Select disabled={readOnly} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {['prospect', 'active', 'frozen', 'inactive', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Membership type"><Input disabled={readOnly} value={form.membershipType} onChange={(e) => setForm({ ...form, membershipType: e.target.value })} /></Field>
        <Field label="Emergency contact"><Input disabled={readOnly} value={form.emergencyName} onChange={(e) => setForm({ ...form, emergencyName: e.target.value })} /></Field>
        <Field label="Emergency phone"><Input disabled={readOnly} value={form.emergencyPhone} onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })} /></Field>
        {'goalsNote' in m && (
          <div className="sm:col-span-2">
            <Field label="Goals"><TextArea disabled={readOnly} value={form.goalsNote} onChange={(e) => setForm({ ...form, goalsNote: e.target.value })} /></Field>
          </div>
        )}
        {!readOnly && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function HealthTab({ memberId }: { memberId: string }) {
  const qc = useQueryClient();
  const limitations = useQuery({
    queryKey: ['limitations', memberId],
    queryFn: () => api.members.limitations.query({ memberId }),
    retry: false,
  });
  const screening = useQuery({
    queryKey: ['screening', memberId],
    queryFn: () => api.members.screeningGet.query({ memberId }),
    retry: false,
  });
  const taxonomies = useQuery({ queryKey: ['taxonomies'], queryFn: () => api.exercises.taxonomies.query() });

  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState('');
  const [patterns, setPatterns] = useState<string[]>([]);
  const addLimitation = useMutation({
    mutationFn: () =>
      api.members.limitationCreate.mutate({ memberId, description: desc, excludedPatternIds: patterns, excludedExerciseIds: [] }),
    onSuccess: () => {
      toast('Limitation recorded');
      setShowAdd(false);
      setDesc('');
      setPatterns([]);
      qc.invalidateQueries({ queryKey: ['limitations', memberId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (limitations.isError || screening.isError) {
    return <Card>You don’t have access to this member’s health data. The member controls trainer access from their profile.</Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display font-bold">Limitations & injuries</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowAdd(true)}>Add</Button>
        </div>
        {limitations.data?.length ? (
          <ul className="space-y-2">
            {limitations.data.map((l) => (
              <li key={l.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">{l.description}</p>
                  {!l.resolvedAt && (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        api.members.limitationResolve.mutate({ memberId, limitationId: l.id }).then(() => {
                          qc.invalidateQueries({ queryKey: ['limitations', memberId] });
                        })
                      }
                    >
                      Resolve
                    </Button>
                  )}
                </div>
                {l.resolvedAt && <Badge>resolved {shortDate(l.resolvedAt)}</Badge>}
                {l.excludedPatternIds.length > 0 && taxonomies.data && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.excludedPatternIds.map((pid) => (
                      <Badge key={pid} tone="alarm">
                        no {taxonomies.data.movementPatterns.find((p) => p.id === pid)?.name ?? 'pattern'}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-steel">None recorded. Substitutions automatically respect anything added here.</p>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-display font-bold">Health screening (PAR-Q)</h3>
        {screening.data ? (
          <>
            <div className="mb-2 flex gap-2">
              <Badge tone={screening.data.flagged ? 'alarm' : 'signal'}>
                {screening.data.flagged ? 'Flagged — physician clearance advised' : 'No flags'}
              </Badge>
              <span className="text-xs text-steel">signed {dateTime(screening.data.signedAt)}</span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {screening.data.questions.map((q) => (
                <li key={q.key} className="flex items-start justify-between gap-3">
                  <span className="text-steel">{q.text}</span>
                  <Badge tone={screening.data!.answers[q.key] ? (q.flagOnYes ? 'alarm' : 'steel') : 'steel'}>
                    {screening.data!.answers[q.key] ? 'Yes' : 'No'}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-steel">Not completed yet — the member fills this in from their app on first login.</p>
        )}
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Record a limitation">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addLimitation.mutate();
          }}
        >
          <Field label="Description" hint="Stored encrypted; visible only with health access.">
            <TextArea required value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Right shoulder impingement — avoid overhead pressing for 6 weeks" />
          </Field>
          <Field label="Exclude movement patterns" hint="Substitutions will steer around these.">
            <div className="flex flex-wrap gap-1.5">
              {taxonomies.data?.movementPatterns.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setPatterns((ps) => (ps.includes(p.id) ? ps.filter((x) => x !== p.id) : [...ps, p.id]))}
                  className={
                    patterns.includes(p.id)
                      ? 'rounded-full bg-alarm px-3 py-1 text-xs font-semibold text-white'
                      : 'rounded-full border border-line px-3 py-1 text-xs font-semibold text-steel'
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
          </Field>
          <Button type="submit" className="w-full" disabled={addLimitation.isPending}>Save</Button>
        </form>
      </Modal>
    </div>
  );
}

function TrainingTab({ memberId, m }: { memberId: string; m: { assignedTrainers?: { trainerUserId: string; trainerName: string }[] } }) {
  const qc = useQueryClient();
  const trainers = useQuery({ queryKey: ['trainers'], queryFn: () => api.scheduling.trainers.query() });
  const assignments = useQuery({ queryKey: ['programs'], queryFn: () => api.programs.list.query() });
  const { isAdminish } = useMe();
  const [trainerId, setTrainerId] = useState('');
  const [programId, setProgramId] = useState('');

  const assignTrainer = useMutation({
    mutationFn: () => api.members.assignTrainer.mutate({ memberId, trainerUserId: trainerId || null }),
    onSuccess: () => {
      toast('Trainer updated');
      qc.invalidateQueries({ queryKey: ['member', memberId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const assignProgram = useMutation({
    mutationFn: () => api.programs.assign.mutate({ programId, memberIds: [memberId] }),
    onSuccess: () => toast('Program assigned'),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-display font-bold">Assigned trainer</h3>
        <p className="mb-3 text-sm text-steel">
          {m.assignedTrainers?.length ? `Currently: ${m.assignedTrainers.map((t) => t.trainerName).join(', ')}` : 'No trainer assigned.'}
        </p>
        {isAdminish && (
          <div className="flex gap-2">
            <Select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">— remove trainer —</option>
              {trainers.data?.map((t) => (
                <option key={t.userId} value={t.userId}>{t.displayName}</option>
              ))}
            </Select>
            <Button onClick={() => assignTrainer.mutate()} disabled={assignTrainer.isPending}>Set</Button>
          </div>
        )}
        <p className="mt-2 text-xs text-steel">Assigning a trainer grants them health access by default; the member can revoke it anytime.</p>
      </Card>
      <Card>
        <h3 className="mb-3 font-display font-bold">Assign a program</h3>
        <div className="flex gap-2">
          <Select value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">Choose a published program…</option>
            {assignments.data?.filter((p) => p.status === 'published').map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Button onClick={() => assignProgram.mutate()} disabled={!programId || assignProgram.isPending}>Assign</Button>
        </div>
      </Card>
    </div>
  );
}

function PackagesTab({ memberId }: { memberId: string }) {
  const qc = useQueryClient();
  const packages = useQuery({ queryKey: ['memberPackages', memberId], queryFn: () => api.money.memberPackages.query({ memberId }) });
  const catalog = useQuery({ queryKey: ['packages'], queryFn: () => api.money.packages.query(), retry: false });
  const [pkgId, setPkgId] = useState('');
  const { me } = useMe();
  const sell = useMutation({
    mutationFn: () => api.money.sell.mutate({ packageId: pkgId, memberId }),
    onSuccess: () => {
      toast('Package sold');
      qc.invalidateQueries({ queryKey: ['memberPackages', memberId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <div className="space-y-4">
      {catalog.data && (
        <Card>
          <h3 className="mb-3 font-display font-bold">Sell a package</h3>
          <div className="flex gap-2">
            <Select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
              <option value="">Choose…</option>
              {catalog.data.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.quantity} sessions, {money(p.priceCents, me?.gym?.currency)}
                </option>
              ))}
            </Select>
            <Button onClick={() => sell.mutate()} disabled={!pkgId || sell.isPending}>
              {sell.isPending ? 'Processing…' : 'Sell (dev payment)'}
            </Button>
          </div>
        </Card>
      )}
      <Table head={['Package', 'Balance', 'Purchased', 'Expires', 'Paid']}>
        {(packages.data ?? []).map((p) => (
          <tr key={p.id}>
            <Td className="font-semibold">{p.name}</Td>
            <Td><span className="score text-lg">{p.balance}</span> <span className="text-steel">/ {p.quantity}</span></Td>
            <Td className="text-steel">{shortDate(p.purchased_at)}</Td>
            <Td className="text-steel">{p.expires_at ? shortDate(p.expires_at) : 'never'}</Td>
            <Td className="text-steel">{money(p.price_paid_cents, me?.gym?.currency)}</Td>
          </tr>
        ))}
      </Table>
      {packages.data?.length === 0 && <p className="text-sm text-steel">No packages yet.</p>}
    </div>
  );
}

function ActivityTab({ memberId }: { memberId: string }) {
  const { units } = useMe();
  const history = useQuery({
    queryKey: ['history', memberId],
    queryFn: () => api.logging.history.query({ memberId }),
    retry: false,
  });
  if (history.isError) return <Card>Workout data requires trainer assignment or admin access.</Card>;
  if (history.isLoading) return <Spinner />;
  return history.data?.length ? (
    <Table head={['Date', 'Workout', 'Sets', 'Volume', 'Felt']}>
      {history.data.map((s) => (
        <tr key={s.id}>
          <Td className="text-steel">{dateTime(s.startedAt)}</Td>
          <Td className="font-semibold">{s.title ?? 'Workout'}</Td>
          <Td>{s.setCount}</Td>
          <Td>{weightLabel(s.volumeKg, units)}</Td>
          <Td>{s.feltRating ? `${s.feltRating}/5` : '—'}</Td>
        </tr>
      ))}
    </Table>
  ) : (
    <p className="text-sm text-steel">No completed workouts yet.</p>
  );
}
