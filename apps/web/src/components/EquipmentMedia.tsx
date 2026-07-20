/* Machine photos and a "how to use this" video, authored by gym staff during
 * equipment setup. Distinct from exercise demo videos: this is about the
 * specific machine on this floor — what it looks like, how to adjust it. */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMessage, mediaUrl, uploadMedia } from '../api';
import { Badge, Button, Card, Field, Input, Spinner, TextArea, cx, toast } from './ui';

export function EquipmentMediaManager({ modelId, howTo }: { modelId: string; howTo: string | null }) {
  const qc = useQueryClient();
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState(howTo ?? '');

  const media = useQuery({ queryKey: ['equipmentMedia', modelId], queryFn: () => api.equipment.media.query({ modelId }) });

  async function upload(file: File, kind: 'photo' | 'how_to_video') {
    setBusy(kind);
    try {
      const mediaId = await uploadMedia(file, 'demo');
      await api.equipment.mediaAdd.mutate({ modelId, mediaId, kind });
      toast(kind === 'photo' ? 'Photo added' : 'How-to video added');
      qc.invalidateQueries({ queryKey: ['equipmentMedia', modelId] });
      qc.invalidateQueries({ queryKey: ['equipment'] });
    } catch (e) {
      toast(errMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  }

  const remove = useMutation({
    mutationFn: (mediaRowId: string) => api.equipment.mediaRemove.mutate({ mediaRowId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipmentMedia', modelId] });
      qc.invalidateQueries({ queryKey: ['equipment'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const saveSteps = useMutation({
    mutationFn: () => api.equipment.modelUpdate.mutate({ modelId, howTo: steps || null }),
    onSuccess: () => {
      toast('Instructions saved');
      qc.invalidateQueries({ queryKey: ['equipment'] });
    },
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const photos = (media.data ?? []).filter((m) => m.kind === 'photo');
  const video = (media.data ?? []).find((m) => m.kind === 'how_to_video');

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-steel">Photos</span>
          <Button size="sm" variant="ghost" disabled={busy === 'photo'} onClick={() => photoRef.current?.click()}>
            {busy === 'photo' ? 'Uploading…' : '+ Photo'}
          </Button>
        </div>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f, 'photo');
          }}
        />
        {media.isLoading ? (
          <Spinner />
        ) : photos.length === 0 ? (
          <p className="text-xs text-steel">
            No photos yet. A photo of the actual machine is what makes it findable on the floor.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="group relative">
                <img src={mediaUrl(p.mediaId)} alt={p.caption ?? 'Equipment photo'} className="h-24 w-full rounded-lg border border-line object-cover" />
                <button
                  className="absolute right-1 top-1 rounded-md bg-ink/80 px-1.5 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => remove.mutate(p.id)}
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-steel">How-to video</span>
          <Button size="sm" variant="ghost" disabled={busy === 'how_to_video'} onClick={() => videoRef.current?.click()}>
            {busy === 'how_to_video' ? 'Uploading…' : video ? 'Replace' : '+ Video'}
          </Button>
        </div>
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f, 'how_to_video');
          }}
        />
        {video ? (
          <div className="relative">
            <video controls playsInline className="w-full rounded-lg bg-ink" src={mediaUrl(video.mediaId)} />
            <Button size="sm" variant="quiet" className="mt-1" onClick={() => remove.mutate(video.id)}>Remove video</Button>
          </div>
        ) : (
          <p className="text-xs text-steel">
            Film 20 seconds on a phone: seat adjustment, where to load, one clean rep. Members see it when they scan the tag.
          </p>
        )}
      </div>

      <Field label="Setup steps" hint="Short lines. Shown under the video on the member's machine page.">
        <TextArea
          className="min-h-20 text-sm"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          placeholder={'Seat pin at hip height\nBack flat against the pad\nDrive through the heels'}
        />
      </Field>
      <Button size="sm" variant="ghost" onClick={() => saveSteps.mutate()} disabled={saveSteps.isPending}>
        Save instructions
      </Button>
    </div>
  );
}

/** Read-only gallery for members. */
export function EquipmentMediaViewer({ modelId, howTo }: { modelId: string; howTo?: string | null }) {
  const media = useQuery({ queryKey: ['equipmentMedia', modelId], queryFn: () => api.equipment.media.query({ modelId }) });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const photos = (media.data ?? []).filter((m) => m.kind === 'photo');
  const video = (media.data ?? []).find((m) => m.kind === 'how_to_video');
  if (media.isLoading) return <Spinner />;
  if (photos.length === 0 && !video && !howTo) return null;

  return (
    <Card>
      <h3 className="mb-2 font-display font-bold">How to use it</h3>
      {video && <video controls playsInline className="mb-2 w-full rounded-lg bg-ink" src={mediaUrl(video.mediaId)} />}
      {photos.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            <button key={p.id} onClick={() => setLightbox(p.mediaId)} className="shrink-0">
              <img src={mediaUrl(p.mediaId)} alt={p.caption ?? 'Machine photo'} className="h-28 w-40 rounded-lg border border-line object-cover" />
            </button>
          ))}
        </div>
      )}
      {howTo && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-steel">
          {howTo.split('\n').filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {lightbox && (
        <button
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4"
          onClick={() => setLightbox(null)}
          aria-label="Close photo"
        >
          <img src={mediaUrl(lightbox)} alt="Machine" className="max-h-full max-w-full rounded-lg" />
        </button>
      )}
    </Card>
  );
}
