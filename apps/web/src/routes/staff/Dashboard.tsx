import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useMe } from '../../state/me';
import { Card, PageHeader, Spinner, Tile } from '../../components/ui';
import { HBarList, UtilBars } from '../../components/charts';
import { money } from '../../lib/format';

export function Dashboard() {
  const { me } = useMe();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.bi.dashboard.query() });

  if (dash.isLoading) return <Spinner />;
  const d = dash.data;
  if (!d) return null;

  return (
    <>
      <PageHeader title="Dashboard" sub="Live numbers — the gym at a glance" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Active members" value={d.activeMembers} sub={`${d.prospects} prospects in pipeline`} />
        <Tile label="Engaged (30d)" value={d.engaged30d} sub="checked in or logged a workout" />
        <Tile
          label="Training penetration"
          value={`${d.penetrationPct}%`}
          sub={`${d.membersWithTrainer} members with a trainer`}
          tone={d.penetrationPct >= 15 ? 'signal' : undefined}
        />
        {d.revenue30dCents != null ? (
          <Tile label="Revenue (30d)" value={money(d.revenue30dCents, me?.gym?.currency)} />
        ) : (
          <Tile label="Sessions this week" value={d.sessionsThisWeek} />
        )}
        <Tile label="Workouts this week" value={d.workoutsThisWeek} sub={`${d.activeAssignments} active program assignments`} />
        {d.revenue30dCents != null && <Tile label="Sessions this week" value={d.sessionsThisWeek} />}
        <Tile
          label="Equipment down"
          value={d.unitsDown}
          sub={`${d.openMaintenance} open reports`}
          tone={d.unitsDown > 0 ? 'alarm' : 'signal'}
        />
        <Tile label="Prospects" value={d.prospects} sub="lead pipeline" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display font-bold">Equipment usage (30d)</h3>
            <Link to="/staff/equipment" className="text-xs font-semibold text-brand">Inventory →</Link>
          </div>
          <p className="mb-3 text-xs text-steel">
            From logged sets + QR scans — the data behind your next capital purchase.
          </p>
          <HBarList
            rows={d.equipmentUsage.map((u) => ({
              label: u.name,
              value: u.set_count + u.scan_count,
              sub: u.scan_count ? `${u.scan_count} scans` : undefined,
            }))}
            unit="uses"
          />
        </Card>

        <Card>
          <h3 className="mb-3 font-display font-bold">Trainer utilization (this week)</h3>
          <UtilBars
            rows={d.trainerUtilization.map((t) => ({ label: t.trainer, value: t.booked_min, capacity: t.avail_min }))}
          />
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-display font-bold">Program performance</h3>
          <HBarList
            rows={d.contentPerformance.map((c) => ({
              label: c.name,
              value: c.workouts_30d,
              sub: `${c.active_assignments} assigned`,
            }))}
            unit="workouts/30d"
          />
        </Card>
      </div>
    </>
  );
}
