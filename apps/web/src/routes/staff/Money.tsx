import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, toast } from '../../components/ui';
import { dateTime, money, shortDate } from '../../lib/format';

export function Money() {
  const [tab, setTab] = useState<'rates' | 'packages' | 'payments'>('rates');
  return (
    <>
      <PageHeader title="Money" sub="Rate cards, packages, and payments — every change is audited" />
      <Tabs
        tabs={[
          { key: 'rates', label: 'Rate cards' },
          { key: 'packages', label: 'Packages' },
          { key: 'payments', label: 'Payments' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'rates' && <Rates />}
      {tab === 'packages' && <Packages />}
      {tab === 'payments' && <Payments />}
    </>
  );
}

function Rates() {
  const qc = useQueryClient();
  const { me } = useMe();
  const cards = useQuery({ queryKey: ['rateCards'], queryFn: () => api.money.rateCards.query(), retry: false });
  const trainers = useQuery({ queryKey: ['trainers'], queryFn: () => api.scheduling.trainers.query() });
  const types = useQuery({ queryKey: ['sessionTypes'], queryFn: () => api.scheduling.sessionTypes.query() });
  const [form, setForm] = useState({ scope: 'session_type', sessionTypeId: '', trainerUserId: '', amount: '', reason: '' });

  const create = useMutation({
    mutationFn: () =>
      api.money.rateCardCreate.mutate({
        scope: form.scope as never,
        sessionTypeId: form.scope !== 'trainer' ? form.sessionTypeId || null : null,
        trainerUserId: form.scope !== 'session_type' ? form.trainerUserId || null : null,
        amountCents: Math.round(Number(form.amount) * 100),
        reason: form.reason || null,
      }),
    onSuccess: () => {
      toast('Rate card created — prior card superseded, history intact');
      qc.invalidateQueries({ queryKey: ['rateCards'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (cards.isError) return <Card>Financial visibility is off for admins at this gym (Owner setting).</Card>;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-3 font-display font-bold">New rate card</h3>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Scope">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="session_type">Session type</option>
              <option value="trainer">Trainer</option>
              <option value="trainer_session_type">Trainer × type</option>
            </Select>
          </Field>
          {form.scope !== 'trainer' && (
            <Field label="Session type">
              <Select required value={form.sessionTypeId} onChange={(e) => setForm({ ...form, sessionTypeId: e.target.value })}>
                <option value="">Choose…</option>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          {form.scope !== 'session_type' && (
            <Field label="Trainer">
              <Select required value={form.trainerUserId} onChange={(e) => setForm({ ...form, trainerUserId: e.target.value })}>
                <option value="">Choose…</option>
                {trainers.data?.map((t) => <option key={t.userId} value={t.userId}>{t.displayName}</option>)}
              </Select>
            </Field>
          )}
          <Field label={`Amount (${me?.gym?.currency ?? 'USD'})`}>
            <Input required type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Reason (for the audit trail)">
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <div className="self-end"><Button type="submit" disabled={create.isPending}>Create</Button></div>
        </form>
        <p className="mt-2 text-xs text-steel">Most specific wins: trainer × type → trainer → session type. Booked sessions keep the rate they were booked at.</p>
      </Card>
      <Table head={['Scope', 'Applies to', 'Amount', 'Effective', 'Superseded', 'Reason']}>
        {(cards.data ?? []).map((r) => (
          <tr key={r.card.id} className={r.card.supersededAt ? 'opacity-50' : ''}>
            <Td><Badge tone="steel">{r.card.scope.replace(/_/g, ' ')}</Badge></Td>
            <Td className="font-semibold">{[r.trainerName, r.sessionTypeName].filter(Boolean).join(' · ') || '—'}</Td>
            <Td className="score">{money(r.card.amountCents, r.card.currency)}</Td>
            <Td className="text-steel">{shortDate(r.card.effectiveAt)}</Td>
            <Td className="text-steel">{r.card.supersededAt ? shortDate(r.card.supersededAt) : <Badge tone="signal">current</Badge>}</Td>
            <Td className="text-steel">{r.card.reason ?? '—'}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Packages() {
  const qc = useQueryClient();
  const { me } = useMe();
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.money.packages.query() });
  const types = useQuery({ queryKey: ['sessionTypes'], queryFn: () => api.scheduling.sessionTypes.query() });
  const [form, setForm] = useState({ name: '', quantity: 10, price: '', expiresDays: '365' });

  const save = useMutation({
    mutationFn: () =>
      api.money.packageSave.mutate({
        name: form.name,
        quantity: form.quantity,
        priceCents: Math.round(Number(form.price) * 100),
        expiresDays: form.expiresDays ? Number(form.expiresDays) : null,
        sessionTypeIds: [],
        transferable: false,
        active: true,
      }),
    onSuccess: () => {
      toast('Package saved');
      setForm({ name: '', quantity: 10, price: '', expiresDays: '365' });
      qc.invalidateQueries({ queryKey: ['packages'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-display font-bold">New package</h3>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="10-Session PT Pack" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Sessions"><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
            <Field label={`Price (${me?.gym?.currency ?? 'USD'})`}><Input required type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Expires (days)"><Input type="number" min={1} value={form.expiresDays} onChange={(e) => setForm({ ...form, expiresDays: e.target.value })} /></Field>
          </div>
          <Button type="submit" disabled={save.isPending}>Save package</Button>
        </form>
        <p className="mt-2 text-xs text-steel">Balances are append-only ledgers — every credit and debit is traceable. Sell from a member's profile.</p>
      </Card>
      <div>
        <Table head={['Package', 'Sessions', 'Price', 'Expiry', 'Active']}>
          {(packages.data ?? []).map((p) => (
            <tr key={p.id}>
              <Td className="font-semibold">{p.name}</Td>
              <Td className="score">{p.quantity}</Td>
              <Td>{money(p.priceCents, me?.gym?.currency)}</Td>
              <Td className="text-steel">{p.expiresDays ? `${p.expiresDays}d` : 'never'}</Td>
              <Td><Badge tone={p.active ? 'signal' : 'steel'}>{p.active ? 'yes' : 'no'}</Badge></Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

function Payments() {
  const { me } = useMe();
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => api.money.payments.query(), retry: false });
  if (payments.isError) return <Card>Financial visibility is off for admins at this gym (Owner setting).</Card>;
  if (payments.isLoading) return <Spinner />;
  return (
    <Table head={['When', 'Member', 'Purpose', 'Amount', 'Provider', 'Status']}>
      {(payments.data ?? []).map((r) => (
        <tr key={r.payment.id}>
          <Td className="text-steel">{dateTime(r.payment.createdAt)}</Td>
          <Td className="font-semibold">{r.firstName} {r.lastName}</Td>
          <Td>{r.payment.purpose}</Td>
          <Td className="score">{money(r.payment.amountCents, me?.gym?.currency)}</Td>
          <Td><Badge tone={r.payment.provider === 'dev' ? 'steel' : 'brand'}>{r.payment.provider}</Badge></Td>
          <Td><Badge tone={r.payment.status === 'paid' ? 'signal' : 'alarm'}>{r.payment.status}</Badge></Td>
        </tr>
      ))}
    </Table>
  );
}
