import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Button, Card, Field, Input, PageHeader, Select, TextArea, toast } from '../../components/ui';
import { ChangePassword } from '../../components/ChangePassword';

export function Settings() {
  const { me, refresh } = useMe();
  const gym = me?.gym;
  const [form, setForm] = useState({
    name: gym?.name ?? '',
    brandPrimary: gym?.brandPrimary ?? '#C8472B',
    units: gym?.units ?? 'lb',
    timezone: gym?.timezone ?? 'America/New_York',
    adminFinancials: gym?.settings.adminFinancials ?? false,
    cancellationWindowHours: gym?.settings.cancellationWindowHours ?? 24,
    lateCancelFeeCents: (gym?.settings.lateCancelFeeCents ?? 0) / 100,
    noShowFeeCents: (gym?.settings.noShowFeeCents ?? 0) / 100,
  });

  const save = useMutation({
    mutationFn: () =>
      api.gym.update.mutate({
        name: form.name,
        brandPrimary: form.brandPrimary,
        units: form.units as 'lb' | 'kg',
        timezone: form.timezone,
        settings: {
          adminFinancials: form.adminFinancials,
          cancellationWindowHours: Number(form.cancellationWindowHours),
          lateCancelFeeCents: Math.round(Number(form.lateCancelFeeCents) * 100),
          noShowFeeCents: Math.round(Number(form.noShowFeeCents) * 100),
        },
      }),
    onSuccess: async () => {
      toast('Settings saved');
      await refresh();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const waiver = useQuery({ queryKey: ['waiverTemplate'], queryFn: () => api.members.waiverTemplate.query() });
  const [waiverBody, setWaiverBody] = useState<string | null>(null);
  const saveWaiver = useMutation({
    mutationFn: () =>
      api.members.waiverTemplateUpdate.mutate({
        name: 'Liability Waiver',
        bodyMd: waiverBody ?? '',
      }),
    onSuccess: (r) => toast(`Waiver template v${r.version} active — new signatures use it, old signatures keep their version`),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <>
      <PageHeader title="Settings" sub="Branding, policies, and legal templates" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-display font-bold">Gym & branding</h3>
          <div className="space-y-3">
            <Field label="Gym name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Brand color" hint="The whole app re-skins instantly — buttons, nav, accents.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.brandPrimary}
                  onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })}
                  className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-card"
                />
                <Input value={form.brandPrimary} onChange={(e) => setForm({ ...form, brandPrimary: e.target.value })} />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units">
                <Select value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value as 'lb' | 'kg' })}>
                  <option value="lb">Pounds (lb)</option>
                  <option value="kg">Kilograms (kg)</option>
                </Select>
              </Field>
              <Field label="Timezone"><Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-3 font-display font-bold">Policies</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.adminFinancials}
                onChange={(e) => setForm({ ...form, adminFinancials: e.target.checked })}
              />
              Admins can see financials (rates, ledgers, revenue)
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Cancel window (h)">
                <Input type="number" min={0} value={form.cancellationWindowHours} onChange={(e) => setForm({ ...form, cancellationWindowHours: Number(e.target.value) })} />
              </Field>
              <Field label="Late-cancel fee">
                <Input type="number" min={0} step="0.01" value={form.lateCancelFeeCents} onChange={(e) => setForm({ ...form, lateCancelFeeCents: Number(e.target.value) })} />
              </Field>
              <Field label="No-show fee">
                <Input type="number" min={0} step="0.01" value={form.noShowFeeCents} onChange={(e) => setForm({ ...form, noShowFeeCents: Number(e.target.value) })} />
              </Field>
            </div>
            <p className="text-xs text-steel">Fees post to the member's account; collection is front-desk or auto-charge once card-on-file payments are connected.</p>
          </div>
        </Card>

        <ChangePassword />

        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-display font-bold">Liability waiver template</h3>
          <p className="mb-2 text-xs text-steel">
            Saving creates a new version. Signatures store the exact version and document hash they signed — legal artifacts, not booleans.
            {waiver.data && ` Current: v${waiver.data.version}${waiver.data.gymId === null ? ' (platform default)' : ''}.`}
          </p>
          <TextArea
            className="min-h-40 font-mono text-xs"
            value={waiverBody ?? waiver.data?.bodyMd ?? ''}
            onChange={(e) => setWaiverBody(e.target.value)}
          />
          <Button className="mt-2" variant="ghost" onClick={() => saveWaiver.mutate()} disabled={saveWaiver.isPending || waiverBody == null}>
            Save as new version
          </Button>
        </Card>
      </div>
      <div className="mt-4">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </>
  );
}
