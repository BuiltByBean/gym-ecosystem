import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errMessage, mediaUrl } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Modal, Spinner, TextArea, toast } from '../../components/ui';
import { EquipmentMediaViewer } from '../../components/EquipmentMedia';
import { activeSession, startSession } from '../../offline/workout';

/** QR landing: scan a machine's tag → its exercises, demo videos, and a
 *  one-tap start. Report-broken is two taps (spec §4.3). */
export function Machine() {
  const { tagCode = '' } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const gymId = me?.gym?.id ?? '';
  const machine = useQuery({
    queryKey: ['machine', tagCode],
    queryFn: () => api.equipment.byTag.query({ tagCode }),
    retry: false,
  });
  const [reporting, setReporting] = useState(false);
  const [desc, setDesc] = useState('');
  const [video, setVideo] = useState<string | null>(null);

  const report = useMutation({
    mutationFn: () => api.equipment.reportIssue.mutate({ tagCode, description: desc || 'Not working' }),
    onSuccess: () => {
      toast('Reported — thanks for the heads up');
      setReporting(false);
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const exVideo = useQuery({
    queryKey: ['exercise', video],
    queryFn: () => api.exercises.get.query({ exerciseId: video! }),
    enabled: Boolean(video),
  });

  async function startWith(exerciseId: string, name: string) {
    let session = await activeSession(gymId);
    session ??= await startSession({ gymId, title: `${machine.data?.model?.name ?? 'Machine'} session` });
    navigate('/me/workout', { state: { sessionId: session.id, focusExercise: exerciseId, focusName: name } });
  }

  if (machine.isLoading) return <Spinner />;
  if (!machine.data) {
    return <Card>Unknown tag. Ask the front desk to re-print this machine's QR label.</Card>;
  }
  const { model, unit, exercises, openReports } = machine.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">{model?.name ?? 'Machine'}</h1>
        <div className="mt-1 flex gap-2">
          <Badge tone={unit.status === 'in_service' ? 'signal' : 'alarm'}>{unit.status.replace(/_/g, ' ')}</Badge>
          {openReports > 0 && <Badge tone="alarm">{openReports} open report{openReports > 1 ? 's' : ''}</Badge>}
        </div>
      </div>

      {model && <EquipmentMediaViewer modelId={model.id} howTo={model.howTo} />}

      {unit.floorPlanId && (
        <Button variant="ghost" className="w-full" onClick={() => navigate('/me/map')}>
          🗺️ Show this on the gym map
        </Button>
      )}

      {unit.status !== 'in_service' && (
        <Card className="border-alarm/50">
          <p className="text-sm">
            This machine is down. Open any exercise below and hit <b>Machine taken?</b> mid-workout — the app will
            offer ranked substitutes that respect your limitations.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {exercises.map((e) => (
          <Card key={e.id} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-display font-bold">{e.name}</div>
                {e.cues.length > 0 && <p className="truncate text-xs text-steel">{e.cues.join(' · ')}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {e.videoGroupId && (
                  <Button size="sm" variant="ghost" onClick={() => setVideo(e.id)}>Demo</Button>
                )}
                <Button size="sm" onClick={() => void startWith(e.id, e.name)}>Log</Button>
              </div>
            </div>
          </Card>
        ))}
        {exercises.length === 0 && (
          <Card className="text-sm text-steel">No exercises linked to this machine yet — tell the front desk.</Card>
        )}
      </div>

      <Button variant="ghost" className="w-full" onClick={() => setReporting(true)}>
        ⚠️ Report a problem with this machine
      </Button>

      <Modal open={reporting} onClose={() => setReporting(false)} title="Report a problem">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <TextArea
            autoFocus
            placeholder="What's wrong? (e.g. cable frayed, seat won't lock)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={report.isPending}>Send report</Button>
        </form>
      </Modal>

      <Modal open={video != null} onClose={() => setVideo(null)} title={exVideo.data?.name ?? 'Demo'}>
        {exVideo.isLoading && <Spinner />}
        {exVideo.data?.currentVideoMediaId ? (
          <video controls autoPlay playsInline className="w-full rounded-lg bg-ink" src={mediaUrl(exVideo.data.currentVideoMediaId)} />
        ) : (
          exVideo.data && <p className="text-sm text-steel">No published demo for this one yet.</p>
        )}
        {exVideo.data && exVideo.data.cues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-steel">
            {exVideo.data.cues.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </Modal>
    </div>
  );
}
