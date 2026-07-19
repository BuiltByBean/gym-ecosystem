import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, toast } from '../../components/ui';

export function StaffRoster() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.gym.staffList.query() });
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'front_desk' | 'trainer'>('trainer');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => api.gym.staffInvite.mutate({ email, role }),
    onSuccess: (r) => {
      setInviteUrl(r.inviteUrl);
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const setStatus = useMutation({
    mutationFn: (v: { staffId: string; status: 'active' | 'inactive' }) => api.gym.staffSetStatus.mutate(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (staff.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Staff"
        sub="Owners, admins, front desk, and trainers"
        actions={<Button onClick={() => { setShowInvite(true); setInviteUrl(null); }}>Invite staff</Button>}
      />
      <Table head={['Name', 'Email', 'Role', 'Status', '']}>
        {(staff.data ?? []).map((s) => (
          <tr key={s.id}>
            <Td className="font-semibold">{s.displayName}</Td>
            <Td className="text-steel">{s.email}</Td>
            <Td><Badge tone="brand">{s.role.replace('_', ' ')}</Badge></Td>
            <Td><Badge tone={s.status === 'active' ? 'signal' : 'steel'}>{s.status}</Badge></Td>
            <Td className="text-right">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setStatus.mutate({ staffId: s.id, status: s.status === 'active' ? 'inactive' : 'active' })}
              >
                {s.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Td>
          </tr>
        ))}
      </Table>

      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite staff">
        {inviteUrl ? (
          <div className="space-y-3">
            <p className="text-sm">Invite created. Send this link to {email}:</p>
            <Input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <Button
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(inviteUrl).catch(() => {});
                toast('Copied');
              }}
            >
              Copy link
            </Button>
            <p className="text-xs text-steel">(Email delivery plugs in with a provider key — dev builds hand you the link.)</p>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as never)}>
                <option value="trainer">Trainer</option>
                <option value="front_desk">Front desk</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Button type="submit" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? 'Creating…' : 'Create invite'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}
