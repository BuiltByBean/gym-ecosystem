import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useMe } from '../../state/me';
import { Button, cx } from '../../components/ui';
import { Dashboard } from './Dashboard';
import { Members } from './Members';
import { MemberDetail } from './MemberDetail';
import { ImportMembers } from './Import';
import { StaffRoster } from './Staff';
import { Equipment } from './Equipment';
import { Exercises } from './Exercises';
import { ExerciseDetail } from './ExerciseDetail';
import { Programs } from './Programs';
import { ProgramBuilder } from './ProgramBuilder';
import { Schedule } from './Schedule';
import { Money } from './Money';
import { Reviews } from './Reviews';
import { AuditLog } from './Audit';
import { Settings } from './Settings';
import { FrontDesk } from './Checkin';

interface NavItem {
  to: string;
  label: string;
  show: boolean;
}

export default function StaffArea() {
  const { me, isAdminish, isTrainer, isFrontDesk, isMember, refresh } = useMe();
  const navigate = useNavigate();

  const nav: NavItem[] = [
    { to: '/staff', label: 'Dashboard', show: isAdminish },
    { to: '/staff/checkin', label: 'Front desk', show: isAdminish || isFrontDesk },
    { to: '/staff/members', label: 'Members', show: true },
    { to: '/staff/schedule', label: 'Schedule', show: true },
    { to: '/staff/programs', label: 'Programs', show: isAdminish || isTrainer },
    { to: '/staff/exercises', label: 'Exercises', show: isAdminish || isTrainer },
    { to: '/staff/equipment', label: 'Equipment', show: true },
    { to: '/staff/reviews', label: 'Reviews', show: isAdminish || isTrainer },
    { to: '/staff/money', label: 'Money', show: isAdminish },
    { to: '/staff/staff', label: 'Staff', show: isAdminish },
    { to: '/staff/import', label: 'Import', show: isAdminish },
    { to: '/staff/audit', label: 'Audit log', show: isAdminish },
    { to: '/staff/settings', label: 'Settings', show: isAdminish },
  ];

  async function logout() {
    await api.auth.logout.mutate();
    await refresh();
    navigate('/login');
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-line bg-card p-3 sm:flex">
        <div className="mb-4 px-2">
          <div className="score text-lg leading-tight" style={{ color: 'var(--brand)' }}>
            {me?.gym?.name ?? 'Gym'}
          </div>
          <div className="text-xs text-steel">{me?.user?.displayName}</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {nav.filter((n) => n.show).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/staff'}
              className={({ isActive }) =>
                cx(
                  'block rounded-lg px-3 py-2 text-sm font-semibold',
                  isActive ? 'bg-brand text-brand-ink' : 'text-steel hover:bg-line/50 hover:text-ink',
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line pt-2">
          {isMember && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/me')}>
              Member view
            </Button>
          )}
          <Button variant="quiet" size="sm" className="w-full" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* mobile top bar */}
        <div className="flex items-center justify-between border-b border-line bg-card px-4 py-3 sm:hidden">
          <span className="score" style={{ color: 'var(--brand)' }}>{me?.gym?.name}</span>
          <Button variant="quiet" size="sm" onClick={logout}>Sign out</Button>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <Routes>
            <Route index element={isAdminish ? <Dashboard /> : <Navigate to={isFrontDesk ? 'checkin' : 'members'} replace />} />
            <Route path="checkin" element={<FrontDesk />} />
            <Route path="members" element={<Members />} />
            <Route path="members/:memberId" element={<MemberDetail />} />
            <Route path="import" element={<ImportMembers />} />
            <Route path="staff" element={<StaffRoster />} />
            <Route path="equipment" element={<Equipment />} />
            <Route path="exercises" element={<Exercises />} />
            <Route path="exercises/:exerciseId" element={<ExerciseDetail />} />
            <Route path="programs" element={<Programs />} />
            <Route path="programs/:programId" element={<ProgramBuilder />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="money" element={<Money />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/staff" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
