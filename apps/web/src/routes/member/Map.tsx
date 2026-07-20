import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Badge, Card, EmptyState, Input, Spinner } from '../../components/ui';
import { FloorMap, type MapUnit } from '../../components/FloorMap';
import { EquipmentMediaViewer } from '../../components/EquipmentMedia';

/** Gym map. Opens focused on one machine when linked from a workout
 *  ("Where is it?"), otherwise browsable with search. */
export function GymMap() {
  const [params] = useSearchParams();
  const focusExercise = params.get('exercise');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const planQuery = useQuery({ queryKey: ['floorPlan', undefined], queryFn: () => api.floorPlans.get.query({}) });
  const located = useQuery({
    queryKey: ['locate', focusExercise],
    queryFn: () => api.floorPlans.locate.query({ exerciseId: focusExercise! }),
    enabled: Boolean(focusExercise),
  });

  const data = planQuery.data;

  const highlights = useMemo(() => {
    if (located.data?.units.length) {
      return located.data.units.map((u) => ({ unitId: u.unitId }));
    }
    if (search.trim() && data) {
      const q = search.toLowerCase();
      return data.placed.filter((u) => u.modelName.toLowerCase().includes(q)).map((u) => ({ unitId: u.unitId }));
    }
    return [];
  }, [located.data, search, data]);

  if (planQuery.isLoading) return <Spinner />;
  if (!data) {
    return (
      <EmptyState
        title="No gym map yet"
        body="Your gym hasn't published a floor plan. Ask at the front desk — once they add one, every machine in your workout gets a location."
      />
    );
  }

  const selectedUnit = data.placed.find((u) => u.unitId === selected) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-xl font-bold">{data.plan.name}</h1>
        {located.data ? (
          <p className="text-sm text-brand">
            {located.data.exerciseName}: {located.data.hint}
          </p>
        ) : (
          <p className="text-sm text-steel">Tap a machine for photos and how to use it.</p>
        )}
      </div>

      {!focusExercise && (
        <Input placeholder="Search for a machine…" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}

      <FloorMap
        plan={data.plan}
        zones={data.zones}
        units={data.placed as MapUnit[]}
        highlights={highlights}
        selectedUnitId={selected}
        onSelectUnit={setSelected}
        interactive
        fitHeight={380}
      />

      {selectedUnit && (
        <>
          <Card className="flex items-center justify-between py-3">
            <div>
              <div className="font-display font-bold">{selectedUnit.modelName}</div>
              <div className="text-xs text-steel">
                {selectedUnit.zoneName ? `In ${selectedUnit.zoneName}` : 'On the floor'} · {selectedUnit.tagCode}
              </div>
            </div>
            <Badge tone={selectedUnit.status === 'in_service' ? 'signal' : 'alarm'}>
              {selectedUnit.status.replace(/_/g, ' ')}
            </Badge>
          </Card>
          <EquipmentMediaViewer modelId={selectedUnit.modelId} />
        </>
      )}
    </div>
  );
}
