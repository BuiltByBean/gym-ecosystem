import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe } from './state/me';
import { Spinner } from './components/ui';
import { Login } from './routes/Login';
import { InviteAccept } from './routes/Invite';

const StaffArea = lazy(() => import('./routes/staff/StaffArea'));
const MemberArea = lazy(() => import('./routes/member/MemberArea'));

export function App() {
  const { me, loading, isStaff, isMember } = useMe();

  if (loading) return <Spinner label="Waking up…" />;

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        {me?.user == null ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : (
          <>
            <Route path="/staff/*" element={isStaff ? <StaffArea /> : <Navigate to="/me" replace />} />
            <Route path="/me/*" element={isMember ? <MemberArea /> : <Navigate to="/staff" replace />} />
            <Route
              path="*"
              element={<Navigate to={isStaff ? '/staff' : isMember ? '/me' : '/login'} replace />}
            />
          </>
        )}
      </Routes>
    </Suspense>
  );
}
