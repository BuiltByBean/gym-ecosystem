import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, toast } from '../../components/ui';

export function Exercises() {
  const [search, setSearch] = useState('');
  const [patternId, setPatternId] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { isAdminish } = useMe();
  const qc = useQueryClient();

  const taxonomies = useQuery({ queryKey: ['taxonomies'], queryFn: () => api.exercises.taxonomies.query() });
  const list = useQuery({
    queryKey: ['exercises', search, patternId, onlyAvailable],
    queryFn: () => api.exercises.list.query({ search: search || undefined, patternId: patternId || undefined, onlyAvailable }),
  });

  const [form, setForm] = useState({ name: '', movementPatternId: '', equipmentClassId: '', difficulty: 2 });
  const create = useMutation({
    mutationFn: () =>
      api.exercises.create.mutate({
        name: form.name,
        movementPatternId: form.movementPatternId,
        equipmentClassId: form.equipmentClassId || null,
        difficulty: form.difficulty,
      }),
    onSuccess: () => {
      toast('Exercise added to your gym library');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['exercises'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <>
      <PageHeader
        title="Exercise library"
        sub="Platform library + your gym's own exercises and demo videos"
        actions={isAdminish ? <Button onClick={() => setShowCreate(true)}>New gym exercise</Button> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="max-w-48" value={patternId} onChange={(e) => setPatternId(e.target.value)}>
          <option value="">All patterns</option>
          {taxonomies.data?.movementPatterns.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-steel">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          Performable here
        </label>
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : (
        <Table head={['Exercise', 'Pattern', 'Source', 'Difficulty', 'Availability', 'Demo']}>
          {(list.data ?? []).map((e) => (
            <tr key={e.id} className="hover:bg-paper/60">
              <Td className="font-semibold">
                <Link className="hover:text-brand" to={`/staff/exercises/${e.id}`}>{e.name}</Link>
              </Td>
              <Td className="text-steel">
                {taxonomies.data?.movementPatterns.find((p) => p.id === e.movementPatternId)?.name}
              </Td>
              <Td><Badge tone={e.source === 'gym' ? 'brand' : 'steel'}>{e.source}</Badge></Td>
              <Td>{'●'.repeat(e.difficulty)}{'○'.repeat(5 - e.difficulty)}</Td>
              <Td>
                <Badge tone={e.available ? 'signal' : 'alarm'}>{e.available ? 'available' : 'no equipment'}</Badge>
              </Td>
              <Td>{e.videoGroupId ? <Badge tone="signal">video</Badge> : <span className="text-xs text-steel">—</span>}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New gym exercise">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Movement pattern">
            <Select required value={form.movementPatternId} onChange={(e) => setForm({ ...form, movementPatternId: e.target.value })}>
              <option value="">Choose…</option>
              {taxonomies.data?.movementPatterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Equipment class" hint="Leave empty for bodyweight.">
            <Select value={form.equipmentClassId} onChange={(e) => setForm({ ...form, equipmentClassId: e.target.value })}>
              <option value="">None / bodyweight</option>
              {taxonomies.data?.equipmentClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Difficulty (1–5)">
            <Input type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
          </Field>
          <Button type="submit" className="w-full" disabled={create.isPending}>Create</Button>
        </form>
      </Modal>
    </>
  );
}
