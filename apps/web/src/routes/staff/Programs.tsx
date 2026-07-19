import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, toast } from '../../components/ui';

export function Programs() {
  const list = useQuery({ queryKey: ['programs'], queryFn: () => api.programs.list.query() });
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () => api.programs.create.mutate({ name }),
    onSuccess: (r) => navigate(`/staff/programs/${r.programId}`),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (list.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Programs"
        sub="Templates, trainer programs, and free gym offerings"
        actions={<Button onClick={() => setShowCreate(true)}>New program</Button>}
      />
      {!list.data?.length ? (
        <EmptyState
          title="No programs yet"
          body="Build your first program: weeks, days, exercises with sets, reps, and load prescriptions. Publish it to assign it — or offer it free to every member."
          action={<Button onClick={() => setShowCreate(true)}>Create a program</Button>}
        />
      ) : (
        <Table head={['Program', 'Source', 'Status', 'Active assignments', 'Member offering', '']}>
          {list.data.map((p) => (
            <tr key={p.id} className="hover:bg-paper/60">
              <Td className="font-semibold">
                <Link className="hover:text-brand" to={`/staff/programs/${p.id}`}>{p.name}</Link>
                {p.ownerName && <span className="ml-2 text-xs text-steel">by {p.ownerName}</span>}
              </Td>
              <Td><Badge tone={p.source === 'trainer' ? 'brand' : 'steel'}>{p.source}</Badge></Td>
              <Td><Badge tone={p.status === 'published' ? 'signal' : 'steel'}>{p.status}</Badge></Td>
              <Td className="score">{p.activeAssignments}</Td>
              <Td>{p.publishedToMembers ? <Badge tone="signal">free for members</Badge> : <span className="text-xs text-steel">—</span>}</Td>
              <Td className="text-right"><Link to={`/staff/programs/${p.id}`} className="text-sm font-semibold text-brand">Open</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New program">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Program name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Beginner Strength — 8 weeks" />
          </Field>
          <Button type="submit" className="w-full" disabled={create.isPending}>Create and open builder</Button>
        </form>
      </Modal>
    </>
  );
}
