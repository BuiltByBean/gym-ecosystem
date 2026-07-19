import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMessage } from '../api';
import { Button, Card, Field, Input, toast } from './ui';

/** Account security — available to every role from Settings (staff) and
 *  Profile (members). */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.auth.changePassword.mutate({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast('Password updated — other devices signed out');
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
    },
    onError: (e) => setError(errMessage(e)),
  });

  return (
    <Card>
      <h3 className="mb-1 font-display font-bold">Change password</h3>
      <p className="mb-3 text-xs text-steel">
        Changing your password signs you out everywhere else.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (next !== confirm) {
            setError('New passwords do not match');
            return;
          }
          change.mutate();
        }}
      >
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm font-medium text-alarm">{error}</p>}
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </Card>
  );
}
