import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, toast } from '../../components/ui';
import { useMe } from '../../state/me';

const STATUS_TONE: Record<string, 'signal' | 'steel' | 'alarm'> = {
  active: 'signal',
  prospect: 'steel',
  frozen: 'steel',
  inactive: 'steel',
  cancelled: 'alarm',
};

export function Members() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { isAdminish, isFrontDesk } = useMe();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['members', search, status],
    queryFn: () =>
      api.members.list.query({
        search: search || undefined,
        status: (status || undefined) as never,
      }),
  });

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', status: 'active' });
  const create = useMutation({
    mutationFn: () =>
      api.members.create.mutate({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || null,
        phone: form.phone || null,
        status: form.status as never,
      }),
    onSuccess: () => {
      toast('Member added');
      setShowCreate(false);
      setForm({ firstName: '', lastName: '', email: '', phone: '', status: 'active' });
      qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <>
      <PageHeader
        title="Members"
        sub={query.data ? `${query.data.length} shown` : undefined}
        actions={
          <>
            {isAdminish && (
              <Button variant="ghost" onClick={() => setShowCreate(true)}>
                Add member
              </Button>
            )}
            {(isAdminish || isFrontDesk) && (
              <Button onClick={() => setShowCreate(true)}>New member</Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select className="max-w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['active', 'prospect', 'frozen', 'inactive', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : !query.data || query.data.length === 0 ? (
        <EmptyState
          title="No members found"
          body={search ? 'Try a different search.' : 'Add your first member, or bulk-import your roster from a CSV export.'}
          action={isAdminish ? <Button onClick={() => setShowCreate(true)}>Add a member</Button> : undefined}
        />
      ) : (
        <Table head={['Name', 'Status', 'Email', 'Phone', 'Login', '']}>
          {query.data.map((m) => (
            <tr key={m.id} className="hover:bg-paper/60">
              <Td className="font-semibold">
                <Link className="hover:text-brand" to={`/staff/members/${m.id}`}>
                  {m.firstName} {m.lastName}
                </Link>
              </Td>
              <Td><Badge tone={STATUS_TONE[m.status ?? ''] ?? 'steel'}>{m.status}</Badge></Td>
              <Td className="text-steel">{m.email ?? '—'}</Td>
              <Td className="text-steel">{m.phone ?? '—'}</Td>
              <Td>{m.userId ? <Badge tone="signal">yes</Badge> : <Badge>no</Badge>}</Td>
              <Td className="text-right">
                <Link to={`/staff/members/${m.id}`} className="text-sm font-semibold text-brand">Open</Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New member">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
          </div>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['active', 'prospect'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="w-full" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add member'}
          </Button>
        </form>
      </Modal>
    </>
  );
}
