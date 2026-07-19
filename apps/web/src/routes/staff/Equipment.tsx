import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, errMessage, type Outputs } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, TextArea, toast, cx } from '../../components/ui';
import { dateTime } from '../../lib/format';

type Model = Outputs['equipment']['models'][number];

const STATUS_TONE = {
  in_service: 'signal',
  maintenance: 'alarm',
  out_of_service: 'alarm',
  retired: 'steel',
} as const;

export function Equipment() {
  const [tab, setTab] = useState<'inventory' | 'maintenance'>('inventory');
  return (
    <>
      <PageHeader title="Equipment" sub="Models, physical units, QR tags, and maintenance" />
      <Tabs
        tabs={[
          { key: 'inventory', label: 'Inventory' },
          { key: 'maintenance', label: 'Maintenance' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inventory' ? <Inventory /> : <Maintenance />}
    </>
  );
}

function Inventory() {
  const qc = useQueryClient();
  const { isAdminish } = useMe();
  const models = useQuery({ queryKey: ['equipment'], queryFn: () => api.equipment.models.query() });
  const [showCreate, setShowCreate] = useState(false);
  const [qrModel, setQrModel] = useState<Model | null>(null);

  const setStatus = useMutation({
    mutationFn: (v: { unitId: string; status: 'in_service' | 'maintenance' | 'out_of_service' | 'retired' }) =>
      api.equipment.unitSetStatus.mutate(v),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['equipment'] });
      if (r.affected && r.affected.programs.length > 0) {
        toast(`Heads up: ${r.affected.programs.length} active program(s) use this machine — substitutes surfaced`, 'err');
      } else {
        toast('Status updated');
      }
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const addUnit = useMutation({
    mutationFn: (modelId: string) => api.equipment.unitAdd.mutate({ modelId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipment'] }),
  });

  if (models.isLoading) return <Spinner />;

  return (
    <>
      <div className="mb-4 flex justify-end">
        {isAdminish && <Button onClick={() => setShowCreate(true)}>Add equipment</Button>}
      </div>
      {!models.data?.length ? (
        <EmptyState
          title="No equipment yet"
          body="Add your first machine or rack. Each physical unit gets a QR tag — members scan it to see the demo and start logging."
          action={isAdminish ? <Button onClick={() => setShowCreate(true)}>Add equipment</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {models.data.map((m) => (
            <Card key={m.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display font-bold">{m.name}</h3>
                  <p className="text-xs text-steel">
                    {m.category}{m.manufacturer ? ` · ${m.manufacturer}` : ''} · {m.exerciseIds.length} linked exercise{m.exerciseIds.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setQrModel(m)}>QR tags</Button>
                  {isAdminish && (
                    <Button size="sm" variant="quiet" onClick={() => addUnit.mutate(m.id)}>+ unit</Button>
                  )}
                </div>
              </div>
              <ul className="space-y-1.5">
                {m.units.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="font-mono text-xs">{u.tagCode}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[u.status]}>{u.status.replace(/_/g, ' ')}</Badge>
                      <Select
                        className="!h-8 w-36 text-xs"
                        value={u.status}
                        onChange={(e) => setStatus.mutate({ unitId: u.id, status: e.target.value as never })}
                      >
                        {(['in_service', 'maintenance', 'out_of_service', 'retired'] as const).map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </Select>
                    </div>
                  </li>
                ))}
                {m.units.length === 0 && <li className="text-xs text-steel">No physical units yet.</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <CreateModel open={showCreate} onClose={() => setShowCreate(false)} />
      {qrModel && <QrSheet model={qrModel} onClose={() => setQrModel(null)} />}
    </>
  );
}

function CreateModel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const classes = useQuery({ queryKey: ['equipmentClasses'], queryFn: () => api.equipment.classes.query() });
  const exercises = useQuery({ queryKey: ['exercises', '', ''], queryFn: () => api.exercises.list.query({}) });
  const [form, setForm] = useState({ name: '', category: 'machine', manufacturer: '', unitCount: 1 });
  const [classIds, setClassIds] = useState<string[]>([]);
  const [exerciseIds, setExerciseIds] = useState<string[]>([]);
  const [exSearch, setExSearch] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.equipment.modelCreate.mutate({
        name: form.name,
        category: form.category,
        manufacturer: form.manufacturer || null,
        unitCount: form.unitCount,
        classIds,
        exerciseIds,
      }),
    onSuccess: () => {
      toast('Equipment added');
      qc.invalidateQueries({ queryKey: ['equipment'] });
      onClose();
      setForm({ name: '', category: 'machine', manufacturer: '', unitCount: 1 });
      setClassIds([]);
      setExerciseIds([]);
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const filteredExercises = (exercises.data ?? []).filter((e) =>
    e.name.toLowerCase().includes(exSearch.toLowerCase()),
  );

  return (
    <Modal open={open} onClose={onClose} title="Add equipment" wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hammer Strength Leg Press" /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['machine', 'strength', 'cardio', 'free_weights', 'other'].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Manufacturer"><Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></Field>
          <Field label="How many units?"><Input type="number" min={0} max={50} value={form.unitCount} onChange={(e) => setForm({ ...form, unitCount: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Satisfies equipment classes" hint="Any exercise needing one of these classes becomes available.">
          <div className="flex flex-wrap gap-1.5">
            {classes.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClassIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
                className={cx(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  classIds.includes(c.id) ? 'bg-brand text-brand-ink' : 'border border-line text-steel',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Directly performs these exercises" hint="Shown on the machine's QR page.">
          <Input placeholder="Filter exercises…" value={exSearch} onChange={(e) => setExSearch(e.target.value)} className="mb-2" />
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {filteredExercises.slice(0, 40).map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={exerciseIds.includes(e.id)}
                  onChange={() =>
                    setExerciseIds((ids) => (ids.includes(e.id) ? ids.filter((x) => x !== e.id) : [...ids, e.id]))
                  }
                />
                {e.name}
              </label>
            ))}
          </div>
        </Field>
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add equipment'}
        </Button>
      </form>
    </Modal>
  );
}

/** Printable QR sheet for a model's units. */
function QrSheet({ model, onClose }: { model: Model; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`QR tags — ${model.name}`} wide>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
        {model.units.map((u) => (
          <QrTag key={u.id} tagCode={u.tagCode} modelName={model.name} />
        ))}
      </div>
      <Button className="mt-4 w-full" variant="ghost" onClick={() => window.print()}>
        Print
      </Button>
    </Modal>
  );
}

function QrTag({ tagCode, modelName }: { tagCode: string; modelName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const url = `${window.location.origin}/me/machine/${tagCode}`;
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 140, margin: 1 }).catch(() => {});
    }
  }, [tagCode]);
  return (
    <div className="flex flex-col items-center rounded-xl border border-line p-3 text-center">
      <canvas ref={canvasRef} />
      <div className="mt-1 font-mono text-xs">{tagCode}</div>
      <div className="text-[11px] text-steel">{modelName}</div>
    </div>
  );
}

function Maintenance() {
  const qc = useQueryClient();
  const { isAdminish } = useMe();
  const reports = useQuery({ queryKey: ['maintenance'], queryFn: () => api.equipment.maintenanceList.query({}) });
  const update = useMutation({
    mutationFn: (v: { reportId: string; status: 'open' | 'in_progress' | 'resolved'; resolution?: string }) =>
      api.equipment.maintenanceUpdate.mutate(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance'] }),
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');

  if (reports.isLoading) return <Spinner />;
  if (!reports.data?.length) {
    return <EmptyState title="No maintenance reports" body="Members can report a broken machine in two taps from its QR page; reports land here." />;
  }
  return (
    <div className="space-y-3">
      {reports.data.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{r.unit?.modelName ?? 'Unknown'}</span>
                <span className="font-mono text-xs text-steel">{r.unit?.tagCode}</span>
                <Badge tone={r.status === 'resolved' ? 'signal' : r.status === 'open' ? 'alarm' : 'steel'}>{r.status.replace('_', ' ')}</Badge>
              </div>
              <p className="mt-1 text-sm">{r.description}</p>
              <p className="mt-1 text-xs text-steel">{dateTime(r.createdAt)}</p>
              {r.resolution && <p className="mt-1 text-xs text-signal">Resolution: {r.resolution}</p>}
            </div>
            {isAdminish && r.status !== 'resolved' && (
              <div className="flex gap-2">
                {r.status === 'open' && (
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ reportId: r.id, status: 'in_progress' })}>
                    Start
                  </Button>
                )}
                <Button size="sm" onClick={() => { setResolving(r.id); setResolution(''); }}>Resolve</Button>
              </div>
            )}
          </div>
        </Card>
      ))}
      <Modal open={resolving != null} onClose={() => setResolving(null)} title="Resolve report">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (resolving) update.mutate({ reportId: resolving, status: 'resolved', resolution });
            setResolving(null);
          }}
        >
          <Field label="What was done?">
            <TextArea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Replaced cable, tested under load" />
          </Field>
          <Button type="submit" className="w-full">Mark resolved</Button>
        </form>
      </Modal>
    </div>
  );
}
