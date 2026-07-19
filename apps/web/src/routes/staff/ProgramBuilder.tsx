import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage, type Inputs } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, TextArea, toast, cx } from '../../components/ui';

type SaveInput = Inputs['programs']['saveDraft'];
type BlockDraft = SaveInput['blocks'][number];
type DayDraft = BlockDraft['weeks'][number]['days'][number];
type ItemDraft = DayDraft['items'][number];

const emptyItem = (exerciseId: string, orderNo: number): ItemDraft => ({
  exerciseId,
  orderNo,
  groupKind: 'straight',
  sets: 3,
  reps: '8',
  load: { type: 'bodyweight' },
  alternates: [],
});

export function ProgramBuilder() {
  const { programId = '' } = useParams();
  const qc = useQueryClient();
  const { units } = useMe();

  const program = useQuery({ queryKey: ['program', programId], queryFn: () => api.programs.get.query({ programId }) });
  const tree = useQuery({ queryKey: ['programTree', programId], queryFn: () => api.programs.getTree.query({ programId }) });
  const exercises = useQuery({ queryKey: ['exercises', '', '', false], queryFn: () => api.exercises.list.query({}) });
  const rules = useQuery({ queryKey: ['progressionRules'], queryFn: () => api.programs.progressionRules.query() });
  const members = useQuery({ queryKey: ['members', '', ''], queryFn: () => api.members.list.query({}) });

  const [blocks, setBlocks] = useState<BlockDraft[] | null>(null);
  const [meta, setMeta] = useState({ name: '', description: '' });
  const [dirty, setDirty] = useState(false);
  const [activeWeek, setActiveWeek] = useState(0);
  const [picker, setPicker] = useState<{ dayIdx: [number, number, number] } | null>(null);
  const [showAssign, setShowAssign] = useState(false);

  // hydrate local draft once from the server tree
  useEffect(() => {
    if (tree.data && program.data && blocks === null) {
      setMeta({ name: program.data.name, description: program.data.description ?? '' });
      setBlocks(
        tree.data.blocks.map((b) => ({
          name: b.name,
          orderNo: b.orderNo,
          weeks: b.weeks.map((w) => ({
            weekNo: w.weekNo,
            name: w.name,
            days: w.days.map((d) => ({
              dayNo: d.dayNo,
              name: d.name,
              focus: d.focus,
              items: d.items.map((i) => ({
                exerciseId: i.exerciseId,
                orderNo: i.orderNo,
                groupNo: i.groupNo,
                groupKind: i.groupKind,
                sets: i.sets,
                reps: i.reps,
                load: i.load,
                tempo: i.tempo,
                restS: i.restS,
                rpeTarget: i.rpeTarget != null ? Number(i.rpeTarget) : null,
                notes: i.notes,
                progressionRuleId: i.progressionRuleId,
                alternates: i.alternates.map((a) => ({ exerciseId: a.exerciseId, rank: a.rank, reason: a.reason })),
              })),
            })),
          })),
        })),
      );
    }
  }, [tree.data, program.data, blocks]);

  const exerciseById = useMemo(() => new Map((exercises.data ?? []).map((e) => [e.id, e])), [exercises.data]);

  const save = useMutation({
    mutationFn: () =>
      api.programs.saveDraft.mutate({
        programId,
        name: meta.name,
        description: meta.description || null,
        blocks: blocks ?? [],
      }),
    onSuccess: () => {
      setDirty(false);
      toast('Draft saved');
      qc.invalidateQueries({ queryKey: ['program', programId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const publish = useMutation({
    mutationFn: async (publishToMembers?: boolean) => {
      if (dirty) await save.mutateAsync();
      return api.programs.publish.mutate({ programId, publishToMembers });
    },
    onSuccess: (r) => {
      toast(`Published v${r.version}`);
      qc.invalidateQueries({ queryKey: ['program', programId] });
      qc.invalidateQueries({ queryKey: ['programTree', programId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (program.isLoading || tree.isLoading || blocks === null) return <Spinner />;
  const block = blocks[0]!;
  const week = block.weeks[activeWeek];

  function mutate(fn: (draft: BlockDraft[]) => void) {
    setBlocks((prev) => {
      const next = structuredClone(prev!) as BlockDraft[];
      fn(next);
      return next;
    });
    setDirty(true);
  }

  function addWeek() {
    mutate((draft) => {
      const b = draft[0]!;
      const last = b.weeks[b.weeks.length - 1]!;
      // copy last week's structure — the common authoring pattern
      const copy = structuredClone(last) as BlockDraft['weeks'][number];
      copy.weekNo = last.weekNo + 1;
      b.weeks.push(copy);
    });
    setActiveWeek(block.weeks.length);
  }

  function addDay() {
    mutate((draft) => {
      const w = draft[0]!.weeks[activeWeek]!;
      w.days.push({ dayNo: w.days.length + 1, name: `Day ${w.days.length + 1}`, items: [] });
    });
  }

  return (
    <>
      <PageHeader
        title={meta.name || 'Program'}
        sub={`${program.data?.status}${program.data?.versions?.length ? ` · v${program.data.versions[0]!.version}` : ''}${dirty ? ' · unsaved changes' : ''}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button onClick={() => publish.mutate(undefined)} disabled={publish.isPending}>
              Publish
            </Button>
            {program.data?.status === 'published' && (
              <Button variant="ghost" onClick={() => setShowAssign(true)}>Assign</Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} />
          </Field>
          <Field label="Description (members see this)">
            <Input value={meta.description} onChange={(e) => { setMeta({ ...meta, description: e.target.value }); setDirty(true); }} />
          </Field>
        </div>
      </Card>

      <div className="mb-3 flex items-center gap-2 overflow-x-auto">
        {block.weeks.map((w, i) => (
          <button
            key={i}
            onClick={() => setActiveWeek(i)}
            className={cx(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold',
              i === activeWeek ? 'bg-brand text-brand-ink' : 'border border-line text-steel',
            )}
          >
            Week {w.weekNo}
          </button>
        ))}
        <Button size="sm" variant="quiet" onClick={addWeek}>+ week (copies last)</Button>
      </div>

      {!week ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          {week.days.map((day, dayIdx) => (
            <Card key={dayIdx}>
              <div className="mb-2 flex items-center gap-2">
                <Input
                  className="!h-9 font-display font-bold"
                  value={day.name}
                  onChange={(e) => mutate((d) => { d[0]!.weeks[activeWeek]!.days[dayIdx]!.name = e.target.value; })}
                />
                <Button size="sm" variant="quiet" onClick={() => setPicker({ dayIdx: [0, activeWeek, dayIdx] })}>
                  + exercise
                </Button>
              </div>
              <div className="space-y-2">
                {day.items.map((item, itemIdx) => (
                  <ItemEditor
                    key={itemIdx}
                    item={item}
                    units={units}
                    exerciseName={exerciseById.get(item.exerciseId)?.name ?? '…'}
                    available={exerciseById.get(item.exerciseId)?.available ?? true}
                    rules={rules.data ?? []}
                    prevItem={itemIdx > 0 ? day.items[itemIdx - 1]! : null}
                    onChange={(patch) =>
                      mutate((d) => {
                        Object.assign(d[0]!.weeks[activeWeek]!.days[dayIdx]!.items[itemIdx]!, patch);
                      })
                    }
                    onRemove={() =>
                      mutate((d) => {
                        const items = d[0]!.weeks[activeWeek]!.days[dayIdx]!.items;
                        items.splice(itemIdx, 1);
                        items.forEach((it, i) => (it.orderNo = i + 1));
                      })
                    }
                  />
                ))}
                {day.items.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-steel">
                    Empty day — add exercises. Only movements your gym can actually perform are offered.
                  </p>
                )}
              </div>
            </Card>
          ))}
          <button
            onClick={addDay}
            className="rounded-xl border-2 border-dashed border-line p-6 text-sm font-semibold text-steel hover:border-brand hover:text-brand"
          >
            + Add day
          </button>
        </div>
      )}

      <ExercisePicker
        open={picker != null}
        onClose={() => setPicker(null)}
        exercises={exercises.data ?? []}
        onPick={(exerciseId) => {
          if (!picker) return;
          const [, w, d] = picker.dayIdx;
          mutate((draft) => {
            const items = draft[0]!.weeks[w]!.days[d]!.items;
            items.push(emptyItem(exerciseId, items.length + 1));
          });
          setPicker(null);
        }}
      />

      <AssignModal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        programId={programId}
        members={(members.data ?? []).map((m) => ({ id: m.id!, name: `${m.firstName} ${m.lastName}` }))}
      />
    </>
  );
}

function ItemEditor({
  item,
  exerciseName,
  available,
  units,
  rules,
  prevItem,
  onChange,
  onRemove,
}: {
  item: ItemDraft;
  exerciseName: string;
  available: boolean;
  units: 'lb' | 'kg';
  rules: { id: string; name: string }[];
  prevItem: ItemDraft | null;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const load = item.load;
  const loadSummary =
    load.type === 'absolute' ? `${load.value} ${load.unit}` :
    load.type === 'percent_max' ? `${load.percent}% max` :
    load.type === 'rpe' ? `RPE ${load.rpe}` : 'BW';

  const linked = item.groupNo != null && prevItem?.groupNo === item.groupNo;

  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-2 px-3 py-2">
        {linked && <span className="text-xs font-bold text-brand" title="Superset with previous">⫘</span>}
        <button className="min-w-0 flex-1 truncate text-left text-sm font-semibold" onClick={() => setOpen(!open)}>
          {exerciseName}
          {!available && <Badge tone="alarm"> equipment down</Badge>}
        </button>
        <span className="score text-sm text-steel">{item.sets}×{item.reps}</span>
        <span className="text-xs text-steel">{loadSummary}</span>
        <Button size="sm" variant="quiet" onClick={() => setOpen(!open)}>{open ? '▴' : '▾'}</Button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Sets">
              <Input type="number" min={1} max={20} value={item.sets} onChange={(e) => onChange({ sets: Number(e.target.value) })} />
            </Field>
            <Field label="Reps">
              <Input value={item.reps} onChange={(e) => onChange({ reps: e.target.value })} placeholder="8 or 8-12 or AMRAP" />
            </Field>
            <Field label="Rest (s)">
              <Input type="number" min={0} value={item.restS ?? ''} onChange={(e) => onChange({ restS: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Load type">
              <Select
                value={load.type}
                onChange={(e) => {
                  const t = e.target.value;
                  onChange({
                    load:
                      t === 'absolute' ? { type: 'absolute', value: 100, unit: units } :
                      t === 'percent_max' ? { type: 'percent_max', percent: 75 } :
                      t === 'rpe' ? { type: 'rpe', rpe: 8 } : { type: 'bodyweight' },
                  });
                }}
              >
                <option value="absolute">Absolute weight</option>
                <option value="percent_max">% of max</option>
                <option value="rpe">RPE</option>
                <option value="bodyweight">Bodyweight</option>
              </Select>
            </Field>
            {load.type === 'absolute' && (
              <Field label={`Weight (${load.unit})`}>
                <Input type="number" min={0} value={load.value} onChange={(e) => onChange({ load: { ...load, value: Number(e.target.value) } })} />
              </Field>
            )}
            {load.type === 'percent_max' && (
              <Field label="Percent">
                <Input type="number" min={1} max={150} value={load.percent} onChange={(e) => onChange({ load: { ...load, percent: Number(e.target.value) } })} />
              </Field>
            )}
            {load.type === 'rpe' && (
              <Field label="RPE">
                <Input type="number" min={1} max={10} step={0.5} value={load.rpe} onChange={(e) => onChange({ load: { ...load, rpe: Number(e.target.value) } })} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Progression rule">
              <Select value={item.progressionRuleId ?? ''} onChange={(e) => onChange({ progressionRuleId: e.target.value || null })}>
                <option value="">none</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Tempo (optional)">
              <Input value={item.tempo ?? ''} onChange={(e) => onChange({ tempo: e.target.value || null })} placeholder="3-1-1" />
            </Field>
          </div>
          <Field label="Notes for the member">
            <TextArea value={item.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value || null })} />
          </Field>
          <div className="flex items-center justify-between">
            {prevItem && (
              <label className="flex items-center gap-2 text-sm text-steel">
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const groupNo = prevItem.groupNo ?? item.orderNo - 1;
                      onChange({ groupNo, groupKind: 'superset' });
                      // note: prev item's groupNo is set by the parent when first linking
                    } else {
                      onChange({ groupNo: null, groupKind: 'straight' });
                    }
                  }}
                />
                Superset with previous
              </label>
            )}
            <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExercisePicker({
  open,
  onClose,
  exercises,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  exercises: { id: string; name: string; available: boolean; source: string }[];
  onPick: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = exercises
    .filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
  return (
    <Modal open={open} onClose={onClose} title="Add exercise">
      <Input autoFocus placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" />
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {filtered.slice(0, 60).map((e) => (
          <li key={e.id}>
            <button
              onClick={() => e.available && onPick(e.id)}
              disabled={!e.available}
              className={cx(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold',
                e.available ? 'hover:bg-line/50' : 'cursor-not-allowed opacity-40',
              )}
            >
              {e.name}
              {!e.available && <Badge tone="alarm">no equipment</Badge>}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-steel">Greyed-out exercises need equipment your gym doesn't have in service.</p>
    </Modal>
  );
}

function AssignModal({
  open,
  onClose,
  programId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  programId: string;
  members: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [wholeGym, setWholeGym] = useState(false);
  const [search, setSearch] = useState('');
  const assign = useMutation({
    mutationFn: () =>
      api.programs.assign.mutate({ programId, wholeGym, memberIds: wholeGym ? undefined : selected }),
    onSuccess: (r) => {
      toast(`Assigned (${r.assignmentIds.length})`);
      onClose();
      setSelected([]);
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  return (
    <Modal open={open} onClose={onClose} title="Assign program">
      <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={wholeGym} onChange={(e) => setWholeGym(e.target.checked)} />
        Offer to the whole gym (free member program)
      </label>
      {!wholeGym && (
        <>
          <Input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {members
              .filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
              .map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={() =>
                        setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))
                      }
                    />
                    {m.name}
                  </label>
                </li>
              ))}
          </ul>
        </>
      )}
      <Button
        className="mt-3 w-full"
        onClick={() => assign.mutate()}
        disabled={assign.isPending || (!wholeGym && selected.length === 0)}
      >
        {assign.isPending ? 'Assigning…' : wholeGym ? 'Publish to all members' : `Assign to ${selected.length} member(s)`}
      </Button>
    </Modal>
  );
}
