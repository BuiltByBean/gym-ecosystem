import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../state/me';
import { cx } from '../../components/ui';
import { installSyncTriggers, onSyncChange, syncStatus, type SyncStatus } from '../../offline/sync';
import { Today } from './Today';
import { WorkoutPlayer } from './Workout';
import { History } from './History';
import { SessionDetail } from './SessionDetail';
import { Progress } from './Progress';
import { Book } from './Book';
import { Profile } from './Profile';
import { Machine } from './Machine';

export default function MemberArea() {
  const { me, isStaff } = useMe();
  const navigate = useNavigate();
  const [sync, setSync] = useState<SyncStatus | null>(null);

  useEffect(() => {
    installSyncTriggers();
    const update = () => void syncStatus().then(setSync);
    update();
    const off = onSyncChange(update);
    const t = setInterval(update, 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.gym.notifications.query(),
    refetchInterval: 60_000,
    retry: false,
  });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <button onClick={() => navigate('/me')} className="score text-lg" style={{ color: 'var(--brand)' }}>
          {me?.gym?.name ?? 'Gym'}
        </button>
        <div className="flex items-center gap-3">
          {sync && sync.pending > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-line/70 px-2 py-0.5 text-xs font-semibold text-steel"
              title={sync.online ? 'Syncing…' : 'Offline — everything is saved on this phone'}
            >
              <span className={cx('h-2 w-2 rounded-full', sync.online ? 'bg-signal' : 'bg-alarm')} />
              {sync.pending}
            </span>
          )}
          {!sync?.online && sync?.pending === 0 && (
            <span className="rounded-full bg-line/70 px-2 py-0.5 text-xs font-semibold text-steel">offline</span>
          )}
          <button onClick={() => navigate('/me/profile')} className="relative text-xl" aria-label="Notifications and profile">
            ☰
            {unread > 0 && (
              <span className="absolute -right-2 -top-1 rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-ink">{unread}</span>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 pb-24">
        <Routes>
          <Route index element={<Today />} />
          <Route path="workout" element={<WorkoutPlayer />} />
          <Route path="history" element={<History />} />
          <Route path="history/:sessionId" element={<SessionDetail />} />
          <Route path="progress" element={<Progress />} />
          <Route path="book" element={<Book />} />
          <Route path="profile" element={<Profile />} />
          <Route path="machine/:tagCode" element={<Machine />} />
          <Route path="*" element={<Navigate to="/me" replace />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
        {[
          { to: '/me', label: 'Today', end: true },
          { to: '/me/book', label: 'Book' },
          { to: '/me/progress', label: 'Progress' },
          { to: '/me/profile', label: 'You' },
        ].map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx(
                'flex min-h-12 flex-1 items-center justify-center py-3 text-sm font-bold',
                isActive ? 'text-brand' : 'text-steel',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
        {isStaff && (
          <NavLink to="/staff" className="flex min-h-12 flex-1 items-center justify-center py-3 text-sm font-bold text-steel">
            Staff
          </NavLink>
        )}
      </nav>
    </div>
  );
}
