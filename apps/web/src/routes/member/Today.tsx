import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Outputs } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Spinner } from '../../components/ui';
import { FloorMap, type MapUnit } from '../../components/FloorMap';
import { db } from '../../offline/db';
import { activeSession, startSession } from '../../offline/workout';
import type { LocalSession } from '../../offline/db';

type Plan = Outputs['programs']['todayPlan'];

/** Numbered stops on the gym map for the day's exercises — so a member walks
 *  in knowing where they're going instead of hunting for machines. */
function RouteForToday({ programVersionId, dayId }: { programVersionId: string; dayId: string }) {
  const [open, setOpen] = useState(false);
  const route = useQuery({
    queryKey: ['workoutRoute', programVersionId, dayId],
    queryFn: () => api.floorPlans.workoutRoute.query({ programVersionId, dayId }),
    retry: false,
  });
  const data = route.data;
  const placed = (data?.stops ?? []).filter((s) => s.units.length > 0);
  if (!data?.plan || placed.length === 0) return null;

  const highlights = placed.map((s, i) => ({ unitId: s.units[0]!.unitId, step: i + 1 }));

  return (
    <div className="mt-3">
      <button
        className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left hover:border-brand"
        onClick={() => setOpen(!open)}
      >
        <span>
          <span className="block text-xs font-bold uppercase tracking-wide text-steel">Your route today</span>
          <span className="block text-sm font-semibold">{placed.length} stops on the gym map</span>
        </span>
        <span>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <FloorMap
            plan={data.plan.plan}
            zones={data.plan.zones}
            units={data.plan.placed as MapUnit[]}
            highlights={highlights}
            fitHeight={300}
          />
          <ol className="space-y-1">
            {placed.map((s, i) => (
              <li key={s.exerciseId} className="flex items-center gap-2 text-sm">
                <span className="score flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-brand-ink">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold">{s.exerciseName}</span>
                  <span className="block truncate text-xs text-steel">{s.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function Today() {
  const { me } = useMe();
  const navigate = useNavigate();
  const gymId = me?.gym?.id ?? '';
  const [active, setActive] = useState<LocalSession | null>(null);

  useEffect(() => {
    if (gymId) void activeSession(gymId).then((s) => setActive(s ?? null));
  }, [gymId]);

  const memberState = useQuery({
    queryKey: ['myMemberState'],
    queryFn: async () => {
      const [waiver, screening] = await Promise.all([
        api.members.waiverTemplate.query(),
        api.members.screeningTemplate.query(),
      ]);
      const meRow = me?.memberId ? await api.members.get.query({ memberId: me.memberId }) : null;
      return { waiver, screening, meRow };
    },
    enabled: Boolean(me?.memberId),
    retry: false,
  });

  const assignments = useQuery({
    queryKey: ['myAssignments'],
    queryFn: () => api.programs.myAssignments.query(),
    retry: false,
  });

  const firstAssignment = assignments.data?.[0];
  const plan = useQuery({
    queryKey: ['todayPlan', firstAssignment?.assignmentId],
    queryFn: async () => {
      const p = await api.programs.todayPlan.query({ assignmentId: firstAssignment!.assignmentId });
      // cache for offline session starts
      await db.plans.put({ assignmentId: firstAssignment!.assignmentId, gymId, fetchedAt: Date.now(), plan: p });
      return p;
    },
    enabled: Boolean(firstAssignment),
    retry: false,
  });

  async function startProgramDay(p: Plan) {
    const session = await startSession({
      gymId,
      assignmentId: p.assignment.id,
      programVersionId: p.assignment.programVersionId,
      programDayId: p.day.id,
      title: p.day.name,
      planDayName: p.day.name,
    });
    navigate('/me/workout', { state: { sessionId: session.id } });
  }

  async function startQuick() {
    const session = await startSession({ gymId, title: 'Quick workout' });
    navigate('/me/workout', { state: { sessionId: session.id } });
  }

  const needsWaiver = memberState.data?.meRow && !memberState.data.meRow.waiverSigned;
  const needsScreening = memberState.data?.meRow && !memberState.data.meRow.screeningDone;

  return (
    <div className="space-y-4">
      {active && (
        <Card className="border-brand">
          <div className="flex items-center justify-between">
            <div>
              <Badge tone="brand">In progress</Badge>
              <h2 className="mt-1 font-display text-lg font-bold">{active.title ?? 'Workout'}</h2>
            </div>
            <Button size="lg" onClick={() => navigate('/me/workout')}>Resume</Button>
          </div>
        </Card>
      )}

      {(needsWaiver || needsScreening) && (
        <Card className="border-alarm/40">
          <h3 className="font-display font-bold">Before your first session</h3>
          <div className="mt-2 space-y-2">
            {needsWaiver && (
              <Link to="/me/profile?do=waiver" className="block rounded-lg border border-line p-3 text-sm font-semibold hover:border-brand">
                ✍️ Sign the liability waiver
              </Link>
            )}
            {needsScreening && (
              <Link to="/me/profile?do=screening" className="block rounded-lg border border-line p-3 text-sm font-semibold hover:border-brand">
                🩺 Complete the 2-minute health screening
              </Link>
            )}
          </div>
        </Card>
      )}

      {assignments.isLoading && <Spinner />}

      {plan.data && !active && (
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-steel">
            {firstAssignment?.name} · Week {plan.data.day.weekNo}
          </div>
          <h2 className="mt-0.5 font-display text-2xl font-bold">{plan.data.day.name}</h2>
          {plan.data.day.focus && <p className="text-sm text-steel">{plan.data.day.focus}</p>}
          <ul className="mt-3 space-y-1.5">
            {plan.data.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                  {item.exercise?.name}
                  {!item.equipmentAvailable && <Badge tone="alarm"> machine down — substitutes ready</Badge>}
                </span>
                <span className="score text-steel">{item.sets}×{item.reps} · {item.resolved.display}</span>
              </li>
            ))}
          </ul>
          <RouteForToday
            programVersionId={firstAssignment!.programVersionId}
            dayId={plan.data.day.id}
          />

          <Button size="lg" className="mt-4 w-full" onClick={() => void startProgramDay(plan.data!)}>
            Start workout
          </Button>
          <p className="mt-2 text-center text-xs text-steel">
            Works fully offline once started — sets save to your phone instantly.
          </p>
        </Card>
      )}

      {assignments.data && assignments.data.length === 0 && !active && (
        <Card>
          <h3 className="font-display font-bold">No program yet</h3>
          <p className="mt-1 text-sm text-steel">
            Your gym's free programs and trainer assignments show up here. Meanwhile, log anything you do.
          </p>
        </Card>
      )}

      {assignments.data && assignments.data.length > 1 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-steel">Your programs</h3>
          <ul className="space-y-1.5">
            {assignments.data.map((a) => (
              <li key={a.assignmentId} className="flex items-center justify-between text-sm">
                <span className="font-semibold">{a.name} {a.isGymWide && <Badge>gym program</Badge>}</span>
                <span className="text-xs text-steel">{a.completedDays}/{a.totalDays} days</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!active && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" size="lg" onClick={() => void startQuick()}>
            Quick log
          </Button>
          <Button variant="ghost" size="lg" onClick={() => navigate('/me/history')}>
            History
          </Button>
        </div>
      )}
    </div>
  );
}
