import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, Spinner, cx, toast } from '../../components/ui';
import { dateTime, shortDate } from '../../lib/format';

export function Profile() {
  const { me, refresh } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const memberRow = useQuery({
    queryKey: ['myMember'],
    queryFn: () => api.members.get.query({ memberId: me!.memberId! }),
    enabled: Boolean(me?.memberId),
    retry: false,
  });
  const grants = useQuery({ queryKey: ['myGrants'], queryFn: () => api.members.myGrants.query(), retry: false });
  const packages = useQuery({ queryKey: ['myPackages'], queryFn: () => api.money.memberPackages.query({}), retry: false });
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => api.gym.notifications.query(), retry: false });

  const markRead = useMutation({
    mutationFn: () => api.gym.notificationsMarkRead.mutate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const setGrant = useMutation({
    mutationFn: (v: { trainerUserId: string; scope: 'health' | 'progress_photos'; granted: boolean }) =>
      api.members.setGrant.mutate(v),
    onSuccess: () => {
      toast('Access updated');
      qc.invalidateQueries({ queryKey: ['myGrants'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  async function logout() {
    await api.auth.logout.mutate();
    await refresh();
    navigate('/login');
  }

  const doParam = params.get('do');

  if (memberRow.isLoading) return <Spinner />;
  const m = memberRow.data;

  const activeGrants = (grants.data ?? []).filter((g) => !g.revokedAt);
  const trainerIds = [...new Set(activeGrants.map((g) => g.trainerUserId))];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">{me?.user?.displayName}</h1>
        <p className="text-sm text-steel">{me?.gym?.name}</p>
      </div>

      {(notifications.data?.length ?? 0) > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display font-bold">Notifications</h3>
            <Button size="sm" variant="quiet" onClick={() => markRead.mutate()}>Mark read</Button>
          </div>
          <ul className="space-y-2">
            {notifications.data!.slice(0, 8).map((n) => (
              <li key={n.id} className={cx('text-sm', n.readAt && 'opacity-50')}>
                <span className="font-semibold">{n.title}</span>
                {n.body && <p className="text-xs text-steel">{n.body}</p>}
                <p className="text-[11px] text-steel">{dateTime(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <WaiverCard signed={Boolean(m?.waiverSigned)} autoOpen={doParam === 'waiver'} onDone={() => { void memberRow.refetch(); setParams({}); }} />
      <ScreeningCard done={Boolean(m?.screeningDone)} autoOpen={doParam === 'screening'} onDone={() => { void memberRow.refetch(); setParams({}); }} />

      <Card>
        <h3 className="mb-1 font-display font-bold">Trainer access to your health data</h3>
        <p className="mb-3 text-xs text-steel">
          Your assigned trainer gets health access by default. You can revoke it any time — they'll still see your
          workouts, never your screening or injury notes.
        </p>
        {trainerIds.length === 0 && <p className="text-sm text-steel">No trainer relationship yet.</p>}
        {trainerIds.map((tid) => {
          const name = activeGrants.find((g) => g.trainerUserId === tid)?.trainerName ?? 'Trainer';
          const health = activeGrants.some((g) => g.trainerUserId === tid && g.scope === 'health');
          return (
            <div key={tid} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span className="font-semibold">{name}</span>
              <Button
                size="sm"
                variant={health ? 'ghost' : 'primary'}
                onClick={() => setGrant.mutate({ trainerUserId: tid, scope: 'health', granted: !health })}
              >
                {health ? 'Revoke health access' : 'Grant health access'}
              </Button>
            </div>
          );
        })}
      </Card>

      {(packages.data?.length ?? 0) > 0 && (
        <Card>
          <h3 className="mb-2 font-display font-bold">Session packages</h3>
          <ul className="space-y-1.5">
            {packages.data!.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="font-semibold">{p.name}</span>
                <span>
                  <span className="score text-lg">{p.balance}</span>
                  <span className="text-xs text-steel"> left{p.expires_at ? ` · exp ${shortDate(p.expires_at)}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button variant="quiet" className="w-full" onClick={() => void logout()}>Sign out</Button>
    </div>
  );
}

function WaiverCard({ signed, autoOpen, onDone }: { signed: boolean; autoOpen: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(autoOpen && !signed);
  const [name, setName] = useState('');
  const template = useQuery({ queryKey: ['waiverTemplate'], queryFn: () => api.members.waiverTemplate.query(), enabled: open || !signed });
  const sign = useMutation({
    mutationFn: () => api.members.waiverSign.mutate({ templateId: template.data!.id, signedName: name }),
    onSuccess: () => {
      toast('Waiver signed');
      setOpen(false);
      onDone();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  return (
    <>
      <Card className={cx('flex items-center justify-between py-3', !signed && 'border-alarm/50')}>
        <div>
          <span className="font-semibold">Liability waiver</span>{' '}
          <Badge tone={signed ? 'signal' : 'alarm'}>{signed ? 'signed' : 'action needed'}</Badge>
        </div>
        {!signed && <Button size="sm" onClick={() => setOpen(true)}>Sign now</Button>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={template.data?.name ?? 'Waiver'} wide>
        {template.data ? (
          <>
            <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 text-sm">
              {template.data.bodyMd}
            </div>
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                sign.mutate();
              }}
            >
              <Field label="Type your full legal name to sign" hint="Your signature records the exact document version, time, and IP address.">
                <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full" disabled={sign.isPending}>I agree — sign</Button>
            </form>
          </>
        ) : (
          <Spinner />
        )}
      </Modal>
    </>
  );
}

function ScreeningCard({ done, autoOpen, onDone }: { done: boolean; autoOpen: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(autoOpen && !done);
  const template = useQuery({ queryKey: ['screeningTemplate'], queryFn: () => api.members.screeningTemplate.query(), enabled: open || !done });
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const submit = useMutation({
    mutationFn: () => api.members.screeningSubmit.mutate({ templateId: template.data!.id, answers }),
    onSuccess: (r) => {
      toast(r.flagged ? 'Saved — please check with a physician before intense training' : 'Screening complete');
      setOpen(false);
      onDone();
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });
  return (
    <>
      <Card className={cx('flex items-center justify-between py-3', !done && 'border-alarm/50')}>
        <div>
          <span className="font-semibold">Health screening</span>{' '}
          <Badge tone={done ? 'signal' : 'alarm'}>{done ? 'complete' : '2 minutes'}</Badge>
        </div>
        {!done && <Button size="sm" onClick={() => setOpen(true)}>Start</Button>}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Health screening (PAR-Q)">
        {template.data ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <p className="text-xs text-steel">Answers are encrypted; only staff you allow can read them.</p>
            {template.data.questions.map((q) => (
              <div key={q.key} className="rounded-lg border border-line p-3">
                <p className="text-sm">{q.text}</p>
                <div className="mt-2 flex gap-2">
                  {[false, true].map((v) => (
                    <button
                      type="button"
                      key={String(v)}
                      onClick={() => setAnswers((a) => ({ ...a, [q.key]: v }))}
                      className={cx(
                        'min-h-10 flex-1 rounded-lg border text-sm font-bold',
                        answers[q.key] === v ? 'border-brand bg-brand text-brand-ink' : 'border-line text-steel',
                      )}
                    >
                      {v ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Button
              type="submit"
              className="w-full"
              disabled={submit.isPending || Object.keys(answers).length < (template.data.questions.length || 0)}
            >
              Submit
            </Button>
          </form>
        ) : (
          <Spinner />
        )}
      </Modal>
    </>
  );
}
