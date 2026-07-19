import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMessage } from '../api';
import { useMe } from '../state/me';
import { Button, Card, Field, Input } from '../components/ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useMe();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login.mutate({ email, password });
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
          <div className="score text-4xl">GYM</div>
          <p className="mt-1 text-sm text-steel">Training platform</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
              />
            </Field>
            {error && <p className="text-sm font-medium text-alarm">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        {import.meta.env.DEV && (
          <p className="mt-4 text-center text-xs text-steel">
            Demo accounts: owner/admin/desk/trainer/member@demo.gym · password <code>demo-password-123</code>
          </p>
        )}
      </div>
    </div>
  );
}
