import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMessage } from '../api';
import { useMe } from '../state/me';
import { Button, Card, Field, Input } from '../components/ui';

export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useMe();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.acceptInvite.mutate({
        token,
        displayName: displayName || undefined,
        password: password || undefined,
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="score text-3xl">You're invited</div>
          <p className="mt-1 text-sm text-steel">Set up your account to get started.</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Your name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Rivera" />
            </Field>
            <Field label="Choose a password" hint="At least 10 characters. Leave blank if you already have an account with this email.">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm font-medium text-alarm">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? 'Joining…' : 'Join'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
