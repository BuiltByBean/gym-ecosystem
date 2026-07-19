import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage, mediaUrl } from '../../api';
import { useMe } from '../../state/me';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, Tabs, TextArea, toast } from '../../components/ui';
import { dateTime } from '../../lib/format';

export function Reviews() {
  const { isAdminish } = useMe();
  const [tab, setTab] = useState<'form' | 'videos'>('form');
  return (
    <>
      <PageHeader title="Reviews" sub="Member form checks and demo-video approvals" />
      <Tabs
        tabs={[
          { key: 'form', label: 'Form checks' },
          ...(isAdminish ? [{ key: 'videos' as const, label: 'Video approvals' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'form' ? <FormChecks /> : <VideoApprovals />}
    </>
  );
}

function FormChecks() {
  const qc = useQueryClient();
  const reviews = useQuery({ queryKey: ['formReviews'], queryFn: () => api.logging.formReviewList.query({}) });
  const [responding, setResponding] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const respond = useMutation({
    mutationFn: () => api.logging.formReviewRespond.mutate({ formReviewId: responding!, feedback }),
    onSuccess: () => {
      toast('Feedback sent');
      setResponding(null);
      setFeedback('');
      qc.invalidateQueries({ queryKey: ['formReviews'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  if (reviews.isLoading) return <Spinner />;
  if (!reviews.data?.length) {
    return <EmptyState title="No form checks" body="Members can record a working set mid-workout and send it here for async feedback." />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {reviews.data.map((r) => (
        <Card key={r.id}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{r.memberName}</span>
            <Badge tone={r.status === 'pending' ? 'brand' : 'signal'}>{r.status}</Badge>
          </div>
          {r.mediaId && <video controls playsInline className="w-full rounded-lg bg-ink" src={mediaUrl(r.mediaId)} />}
          {r.memberNote && <p className="mt-2 text-sm text-steel">“{r.memberNote}”</p>}
          <p className="mt-1 text-xs text-steel">{dateTime(r.createdAt)}</p>
          {r.feedback ? (
            <p className="mt-2 rounded-lg bg-signal/10 p-2 text-sm">{r.feedback}</p>
          ) : (
            <Button size="sm" className="mt-2" onClick={() => setResponding(r.id)}>Give feedback</Button>
          )}
        </Card>
      ))}
      <Modal open={responding != null} onClose={() => setResponding(null)} title="Form feedback">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            respond.mutate();
          }}
        >
          <Field label="Feedback for the member">
            <TextArea required value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Depth looks solid. Brace harder before the descent — big breath, ribs down." />
          </Field>
          <Button type="submit" className="w-full" disabled={respond.isPending}>Send</Button>
        </form>
      </Modal>
    </div>
  );
}

function VideoApprovals() {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ['pendingVideos'], queryFn: () => api.exercises.pendingVideos.query() });
  const decide = useMutation({
    mutationFn: (v: { videoId: string; approve: boolean }) => api.exercises.publishVideo.mutate(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pendingVideos'] }),
    onError: (e) => toast(errMessage(e), 'err'),
  });
  if (pending.isLoading) return <Spinner />;
  if (!pending.data?.length) {
    return <EmptyState title="Nothing awaiting review" body="Trainer demo uploads land here. Publishing swaps the exercise's current video atomically — links never break." />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {pending.data.map((v) => (
        <Card key={v.videoId}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{v.exerciseName ?? 'Unlinked video'}</span>
            <span className="text-xs text-steel">v{v.version} · {v.uploaderName}</span>
          </div>
          <video controls playsInline className="w-full rounded-lg bg-ink" src={mediaUrl(v.mediaId)} />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => decide.mutate({ videoId: v.videoId, approve: true })}>Publish</Button>
            <Button size="sm" variant="quiet" onClick={() => decide.mutate({ videoId: v.videoId, approve: false })}>Reject</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
