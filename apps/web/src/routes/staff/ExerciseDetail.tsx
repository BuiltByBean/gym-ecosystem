import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage, mediaUrl, uploadMedia } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, toast } from '../../components/ui';

export function ExerciseDetail() {
  const { exerciseId = '' } = useParams();
  const qc = useQueryClient();
  const { isAdminish, isTrainer } = useMe();
  const ex = useQuery({ queryKey: ['exercise', exerciseId], queryFn: () => api.exercises.get.query({ exerciseId }) });
  const subs = useQuery({
    queryKey: ['substitutes', exerciseId],
    queryFn: () => api.equipment.substitutes.query({ exerciseId }),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const fork = useMutation({
    mutationFn: () => api.exercises.fork.mutate({ exerciseId }),
    onSuccess: () => toast('Forked into your gym library'),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const mediaId = await uploadMedia(file, 'demo');
      await api.exercises.attachVideo.mutate({ exerciseId, mediaId });
      toast('Video uploaded — pending admin review');
      qc.invalidateQueries({ queryKey: ['exercise', exerciseId] });
    } catch (e) {
      toast(errMessage(e), 'err');
    } finally {
      setUploading(false);
    }
  }

  const [edge, setEdge] = useState({ toExerciseId: '', kind: 'substitutes_for' as 'substitutes_for' | 'progression_of', reason: '' });
  const allExercises = useQuery({ queryKey: ['exercises', '', '', false], queryFn: () => api.exercises.list.query({}) });
  const addEdge = useMutation({
    mutationFn: () =>
      api.exercises.edgeSet.mutate({
        fromExerciseId: exerciseId,
        toExerciseId: edge.toExerciseId,
        kind: edge.kind,
        reason: edge.reason || null,
      }),
    onSuccess: () => {
      toast('Relationship added');
      qc.invalidateQueries({ queryKey: ['exercise', exerciseId] });
      qc.invalidateQueries({ queryKey: ['substitutes', exerciseId] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (ex.isLoading) return <Spinner />;
  if (!ex.data) return <PageHeader title="Exercise not found" />;
  const e = ex.data;

  return (
    <>
      <PageHeader
        title={e.name}
        sub={`${e.source === 'platform' ? 'Platform library' : 'Gym library'} · difficulty ${e.difficulty}/5`}
        actions={
          <>
            {e.source === 'platform' && isAdminish && (
              <Button variant="ghost" onClick={() => fork.mutate()}>Fork to gym library</Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={e.available ? 'signal' : 'alarm'}>{e.available ? 'performable here' : 'no equipment in service'}</Badge>
        {e.muscles.map((m) => (
          <Badge key={m.muscleId} tone={m.role === 'primary' ? 'brand' : 'steel'}>{m.name}</Badge>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-display font-bold">Demo video</h3>
          {e.currentVideoMediaId ? (
            <video controls playsInline className="w-full rounded-lg bg-ink" src={mediaUrl(e.currentVideoMediaId)} />
          ) : (
            <p className="text-sm text-steel">
              No published demo yet.{' '}
              {e.source === 'gym'
                ? 'Record one on a phone right on your gym floor — that authenticity is the product.'
                : 'Fork this exercise to attach your gym’s own demo.'}
            </p>
          )}
          {e.source === 'gym' && (isAdminish || isTrainer) && (
            <div className="mt-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) void onUpload(f);
                }}
              />
              <Button variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : e.currentVideoMediaId ? 'Upload replacement (new version)' : 'Upload demo video'}
              </Button>
              <p className="mt-1 text-xs text-steel">Uploads go to admin review before members see them.</p>
            </div>
          )}
          {e.cues.length > 0 && (
            <>
              <h4 className="mt-4 text-sm font-bold">Coaching cues</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-steel">
                {e.cues.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 font-display font-bold">Substitutes right now</h3>
            <p className="mb-2 text-xs text-steel">Ranked by the graph, filtered to equipment currently in service.</p>
            <ul className="space-y-1.5">
              {(subs.data ?? []).map((s) => (
                <li key={s.exerciseId} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                  <div>
                    <Link to={`/staff/exercises/${s.exerciseId}`} className="font-semibold hover:text-brand">{s.name}</Link>
                    <p className="text-xs text-steel">{s.reason}{s.availableOn ? ` · on ${s.availableOn}` : ''}</p>
                  </div>
                  <Badge tone={s.source === 'curated' ? 'brand' : 'steel'}>{s.source}</Badge>
                </li>
              ))}
              {subs.data?.length === 0 && <li className="text-sm text-steel">Nothing available — add equipment or graph edges.</li>}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 font-display font-bold">Graph</h3>
            <div className="space-y-2 text-sm">
              <GraphList label="Substitutes for this" edges={e.substitutes} />
              <GraphList label="Progressions (harder)" edges={e.progressions} />
              <GraphList label="Regressions (easier)" edges={e.regressions} />
            </div>
            {isAdminish && (
              <form
                className="mt-3 space-y-2 border-t border-line pt-3"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  addEdge.mutate();
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Select value={edge.kind} onChange={(ev) => setEdge({ ...edge, kind: ev.target.value as never })}>
                    <option value="substitutes_for">substitutes for →</option>
                    <option value="progression_of">progression of →</option>
                  </Select>
                  <Select required value={edge.toExerciseId} onChange={(ev) => setEdge({ ...edge, toExerciseId: ev.target.value })}>
                    <option value="">target…</option>
                    {allExercises.data?.filter((x) => x.id !== exerciseId).map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </Select>
                </div>
                <Input placeholder="Reason shown to members (optional)" value={edge.reason} onChange={(ev) => setEdge({ ...edge, reason: ev.target.value })} />
                <Button type="submit" size="sm" disabled={addEdge.isPending}>Add edge</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function GraphList({ label, edges }: { label: string; edges: { id: string; otherId: string; otherName: string; reason: string | null }[] }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-steel">{label}</span>
      {edges.length ? (
        <ul className="mt-1 space-y-1">
          {edges.map((e) => (
            <li key={e.id}>
              <Link to={`/staff/exercises/${e.otherId}`} className="font-semibold hover:text-brand">{e.otherName}</Link>
              {e.reason && <span className="text-xs text-steel"> — {e.reason}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-steel">none</p>
      )}
    </div>
  );
}
