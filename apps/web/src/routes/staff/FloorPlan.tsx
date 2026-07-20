import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage, uploadMedia } from '../../api';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast,
} from '../../components/ui';
import { FloorMap, metresLabel, type MapUnit } from '../../components/FloorMap';

type Tool = 'select' | 'zone' | 'entrance';

export function FloorPlanEditor() {
  const qc = useQueryClient();
  const [planId, setPlanId] = useState<string | undefined>();
  const [tool, setTool] = useState<Tool>('select');
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dragUnit = useRef<{ unitId: string; moved: boolean } | null>(null);

  const plans = useQuery({ queryKey: ['floorPlans'], queryFn: () => api.floorPlans.list.query() });
  const planQuery = useQuery({
    queryKey: ['floorPlan', planId],
    queryFn: () => api.floorPlans.get.query({ planId }),
  });
  const unplaced = useQuery({
    queryKey: ['unplacedUnits'],
    queryFn: () => api.floorPlans.unplacedUnits.query(),
  });

  const data = planQuery.data;
  const plan = data?.plan;
  const activePlanId = plan?.id;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['floorPlan'] });
    qc.invalidateQueries({ queryKey: ['unplacedUnits'] });
  };

  const place = useMutation({
    mutationFn: (v: { unitId: string; xCm: number; yCm: number; rotationDeg?: number }) =>
      api.floorPlans.placeUnit.mutate({ ...v, planId: activePlanId! }),
    onSuccess: invalidate,
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const unplace = useMutation({
    mutationFn: (unitId: string) => api.floorPlans.unplaceUnit.mutate({ unitId }),
    onSuccess: () => {
      setSelectedUnit(null);
      invalidate();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const saveZone = useMutation({
    mutationFn: (v: { zoneId?: string; name: string; xCm: number; yCm: number; widthCm: number; heightCm: number; color: string }) =>
      api.floorPlans.saveZone.mutate({ ...v, planId: activePlanId! }),
    onSuccess: () => {
      setDraft(null);
      setTool('select');
      invalidate();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  const deleteZone = useMutation({
    mutationFn: (zoneId: string) => api.floorPlans.deleteZone.mutate({ zoneId }),
    onSuccess: () => {
      setSelectedZone(null);
      invalidate();
    },
  });
  const updatePlan = useMutation({
    mutationFn: (v: Omit<Parameters<typeof api.floorPlans.update.mutate>[0], 'planId'>) =>
      api.floorPlans.update.mutate({ ...v, planId: activePlanId! }),
    onSuccess: invalidate,
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const selected = data?.placed.find((u) => u.unitId === selectedUnit) ?? null;

  // keyboard: nudge, rotate, delete
  useEffect(() => {
    if (!selected || !activePlanId) return;
    const grid = plan?.gridCm ?? 50;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const nudge = e.shiftKey ? grid : 10;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -nudge;
      else if (e.key === 'ArrowRight') dx = nudge;
      else if (e.key === 'ArrowUp') dy = -nudge;
      else if (e.key === 'ArrowDown') dy = nudge;
      else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        place.mutate({
          unitId: selected.unitId,
          xCm: selected.xCm,
          yCm: selected.yCm,
          rotationDeg: (selected.rotationDeg + (e.shiftKey ? 270 : 90)) % 360,
        });
        return;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        unplace.mutate(selected.unitId);
        return;
      } else if (e.key === 'Escape') {
        setSelectedUnit(null);
        return;
      } else return;
      e.preventDefault();
      place.mutate({
        unitId: selected.unitId,
        xCm: Math.max(0, selected.xCm + dx),
        yCm: Math.max(0, selected.yCm + dy),
        rotationDeg: selected.rotationDeg,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, activePlanId, plan?.gridCm, place, unplace]);

  const snap = (v: number) => {
    const g = plan?.gridCm ?? 50;
    return Math.round(v / g) * g;
  };

  if (plans.isLoading || planQuery.isLoading) return <Spinner />;

  if (!plans.data?.length) {
    return (
      <>
        <PageHeader title="Floor plan" sub="Place your equipment so members can find it" />
        <EmptyState
          title="No floor plan yet"
          body="Create one, set its real dimensions, then drag your machines into place. Members get a map that shows exactly where each machine in their workout is."
          action={<Button onClick={() => setShowNew(true)}>Create floor plan</Button>}
        />
        <NewPlanModal open={showNew} onClose={() => setShowNew(false)} onCreated={(id) => { setPlanId(id); qc.invalidateQueries({ queryKey: ['floorPlans'] }); }} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Floor plan"
        sub={plan ? `${metresLabel(plan.widthCm)} × ${metresLabel(plan.heightCm)} · ${data?.placed.length ?? 0} machines placed` : undefined}
        actions={
          <>
            {plans.data.length > 1 && (
              <Select className="!h-11 w-44" value={activePlanId ?? ''} onChange={(e) => setPlanId(e.target.value)}>
                {plans.data.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
                ))}
              </Select>
            )}
            <Button variant="ghost" onClick={() => setShowSettings(true)}>Plan settings</Button>
            <Button variant="ghost" onClick={() => setShowNew(true)}>New plan</Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['select', 'zone', 'entrance'] as Tool[]).map((t) => (
          <Button key={t} size="sm" variant={tool === t ? 'primary' : 'ghost'} onClick={() => { setTool(t); setDraft(null); }}>
            {t === 'select' ? 'Select & move' : t === 'zone' ? 'Draw zone' : 'Set entrance'}
          </Button>
        ))}
        <span className="ml-2 text-xs text-steel">
          {tool === 'select'
            ? 'Drag a machine to move it · R rotates · arrows nudge (Shift = grid) · Delete removes'
            : tool === 'zone'
              ? 'Drag on the map to draw a zone'
              : 'Click where members walk in'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          {plan && data && (
            <FloorMap
              plan={plan}
              zones={data.zones}
              units={data.placed as MapUnit[]}
              interactive
              selectedUnitId={selectedUnit}
              onSelectUnit={(id) => {
                if (tool !== 'select') return;
                setSelectedUnit(id);
                dragUnit.current = { unitId: id, moved: false };
              }}
              onCanvasPointerDown={(e, cm) => {
                if (tool === 'entrance') {
                  e.preventDefault();
                  updatePlan.mutate({ entranceXCm: snap(cm.x), entranceYCm: snap(cm.y) });
                  setTool('select');
                  return;
                }
                if (tool === 'zone') {
                  e.preventDefault();
                  setDraft({ x: snap(cm.x), y: snap(cm.y), w: 0, h: 0 });
                  return;
                }
                if (e.target === e.currentTarget) setSelectedUnit(null);
              }}
              overlay={
                <MapPointerLayer
                  active={tool === 'zone' || dragUnit.current != null}
                  onMove={(cm) => {
                    if (tool === 'zone' && draft) {
                      setDraft({ ...draft, w: Math.abs(snap(cm.x) - draft.x), h: Math.abs(snap(cm.y) - draft.y) });
                    } else if (dragUnit.current) {
                      dragUnit.current.moved = true;
                    }
                  }}
                  onUp={(cm) => {
                    const d = dragUnit.current;
                    dragUnit.current = null;
                    if (d?.moved && activePlanId) {
                      const unit = data?.placed.find((u) => u.unitId === d.unitId);
                      place.mutate({
                        unitId: d.unitId,
                        xCm: Math.max(0, snap(cm.x)),
                        yCm: Math.max(0, snap(cm.y)),
                        rotationDeg: unit?.rotationDeg ?? 0,
                      });
                    }
                  }}
                />
              }
            />
          )}

          {draft && draft.w > 20 && draft.h > 20 && (
            <ZoneNameModal
              onCancel={() => setDraft(null)}
              onSave={(name, color) =>
                saveZone.mutate({ name, color, xCm: draft.x, yCm: draft.y, widthCm: draft.w, heightCm: draft.h })
              }
            />
          )}

          {data && data.zones.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.zones.map((z) => (
                <span key={z.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: z.color }} />
                  {z.name}
                  <button className="text-steel hover:text-alarm" onClick={() => deleteZone.mutate(z.id)} aria-label={`Delete ${z.name}`}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {selected && (
            <Card>
              <h3 className="font-display font-bold">{selected.modelName}</h3>
              <p className="text-xs text-steel">
                {selected.tagCode} · {metresLabel(selected.xCm)}, {metresLabel(selected.yCm)} · {selected.rotationDeg}°
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => place.mutate({ unitId: selected.unitId, xCm: selected.xCm, yCm: selected.yCm, rotationDeg: (selected.rotationDeg + 90) % 360 })}>
                  Rotate 90°
                </Button>
                <Button size="sm" variant="quiet" onClick={() => unplace.mutate(selected.unitId)}>Remove from plan</Button>
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-1 font-display font-bold">Not placed yet</h3>
            <p className="mb-2 text-xs text-steel">Click a machine to drop it on the plan, then drag it where it belongs.</p>
            {unplaced.data?.length === 0 ? (
              <p className="text-sm text-signal">Everything is on the plan.</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-y-auto">
                {unplaced.data?.map((u) => (
                  <li key={u.unitId}>
                    <button
                      className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-brand"
                      onClick={() => {
                        if (!activePlanId || !plan) return;
                        // drop it in the middle of the current plan; staff drag from there
                        place.mutate({ unitId: u.unitId, xCm: snap(plan.widthCm / 2), yCm: snap(plan.heightCm / 2) });
                        setSelectedUnit(u.unitId);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{u.modelName}</span>
                        <span className="font-mono text-[11px] text-steel">{u.tagCode}</span>
                      </span>
                      {u.status !== 'in_service' && <Badge tone="alarm">down</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <NewPlanModal open={showNew} onClose={() => setShowNew(false)} onCreated={(id) => { setPlanId(id); qc.invalidateQueries({ queryKey: ['floorPlans'] }); }} />
      {plan && (
        <PlanSettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
          plan={plan}
          onSave={(patch) => updatePlan.mutate(patch)}
        />
      )}
    </>
  );
}

/** Transparent layer that reports pointer position in plan cm during drags. */
function MapPointerLayer({
  active,
  onMove,
  onUp,
}: {
  active: boolean;
  onMove: (cm: { x: number; y: number }) => void;
  onUp: (cm: { x: number; y: number }) => void;
}) {
  useEffect(() => {
    if (!active) return;
    function cmFromEvent(e: PointerEvent): { x: number; y: number } {
      const svg = document.querySelector('svg[aria-label^="Floor plan"]') as SVGSVGElement | null;
      if (!svg) return { x: 0, y: 0 };
      const vb = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      return {
        x: Math.round(vb.x + ((e.clientX - rect.left) / rect.width) * vb.width),
        y: Math.round(vb.y + ((e.clientY - rect.top) / rect.height) * vb.height),
      };
    }
    const move = (e: PointerEvent) => onMove(cmFromEvent(e));
    const up = (e: PointerEvent) => onUp(cmFromEvent(e));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active, onMove, onUp]);
  return null;
}

function ZoneNameModal({ onCancel, onSave }: { onCancel: () => void; onSave: (name: string, color: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2a78d6');
  return (
    <Modal open onClose={onCancel} title="Name this zone">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name, color);
        }}
      >
        <Field label="Zone name">
          <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Free Weights" />
        </Field>
        <Field label="Colour">
          <div className="flex gap-2">
            {['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e34948', '#5B6472'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cx('h-9 w-9 rounded-lg border-2', color === c ? 'border-ink' : 'border-transparent')}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Button type="submit" className="w-full">Add zone</Button>
      </form>
    </Modal>
  );
}

function NewPlanModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ name: 'Main Floor', widthM: 30, heightM: 20 });
  const create = useMutation({
    mutationFn: () =>
      api.floorPlans.create.mutate({
        name: form.name,
        widthCm: Math.round(form.widthM * 100),
        heightCm: Math.round(form.heightM * 100),
      }),
    onSuccess: (r) => {
      toast('Floor plan created');
      onCreated(r.id);
      onClose();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  return (
    <Modal open={open} onClose={onClose} title="New floor plan">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Width (m)"><Input type="number" min={2} max={300} value={form.widthM} onChange={(e) => setForm({ ...form, widthM: Number(e.target.value) })} /></Field>
          <Field label="Depth (m)"><Input type="number" min={2} max={300} value={form.heightM} onChange={(e) => setForm({ ...form, heightM: Number(e.target.value) })} /></Field>
        </div>
        <p className="text-xs text-steel">Rough dimensions are fine — you can change them later, and you can trace over a photo of your existing floor plan.</p>
        <Button type="submit" className="w-full" disabled={create.isPending}>Create</Button>
      </form>
    </Modal>
  );
}

function PlanSettingsModal({
  open,
  onClose,
  plan,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  plan: { id: string; name: string; widthCm: number; heightCm: number; gridCm: number; backgroundMediaId: string | null; backgroundOpacity: string | number; isDefault: boolean };
  onSave: (patch: Omit<Parameters<typeof api.floorPlans.update.mutate>[0], 'planId'>) => void;
}) {
  const [form, setForm] = useState({
    name: plan.name,
    widthM: plan.widthCm / 100,
    heightM: plan.heightCm / 100,
    gridCm: plan.gridCm,
    opacity: Number(plan.backgroundOpacity),
    isDefault: plan.isDefault,
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadBackground(file: File) {
    setUploading(true);
    try {
      const mediaId = await uploadMedia(file, 'demo');
      onSave({ backgroundMediaId: mediaId });
      toast('Background added — trace your layout over it');
    } catch (e) {
      toast(errMessage(e), 'err');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Plan settings">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: form.name,
            widthCm: Math.round(form.widthM * 100),
            heightCm: Math.round(form.heightM * 100),
            gridCm: form.gridCm,
            backgroundOpacity: form.opacity,
            isDefault: form.isDefault,
          });
          onClose();
        }}
      >
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Width (m)"><Input type="number" min={2} max={300} value={form.widthM} onChange={(e) => setForm({ ...form, widthM: Number(e.target.value) })} /></Field>
          <Field label="Depth (m)"><Input type="number" min={2} max={300} value={form.heightM} onChange={(e) => setForm({ ...form, heightM: Number(e.target.value) })} /></Field>
          <Field label="Grid (cm)"><Input type="number" min={10} max={500} step={10} value={form.gridCm} onChange={(e) => setForm({ ...form, gridCm: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Background image" hint="Optional: upload your existing floor plan and place machines over it.">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBackground(f); }} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : plan.backgroundMediaId ? 'Replace image' : 'Upload image'}
            </Button>
            {plan.backgroundMediaId && (
              <Button type="button" variant="quiet" size="sm" onClick={() => onSave({ backgroundMediaId: null })}>Remove</Button>
            )}
          </div>
        </Field>
        {plan.backgroundMediaId && (
          <Field label={`Background opacity: ${Math.round(form.opacity * 100)}%`}>
            <input type="range" min={0} max={1} step={0.05} value={form.opacity} className="w-full" onChange={(e) => setForm({ ...form, opacity: Number(e.target.value) })} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
          Default plan members see
        </label>
        <Button type="submit" className="w-full">Save</Button>
      </form>
    </Modal>
  );
}
