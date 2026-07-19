/* Local-disk media adapter (dev). The interface is the contract; a Cloudflare
 * Stream/R2 adapter drops in behind it with credentials (docs/ARCHITECTURE.md §7). */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env, schema, uuidv7, type DbBundle } from '@gym/db';
import { eq } from 'drizzle-orm';

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function mediaKindForMime(mime: string): 'video' | 'image' | null {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return null;
}

export async function saveMedia(
  bundle: DbBundle,
  opts: { gymId: string; userId: string; mime: string; data: Buffer },
): Promise<{ id: string; objectKey: string }> {
  const kind = mediaKindForMime(opts.mime);
  if (!kind) throw new Error(`unsupported media type: ${opts.mime}`);
  const ext = EXT_BY_MIME[opts.mime] ?? 'bin';
  const id = uuidv7();
  const objectKey = `${opts.gymId}/${id}.${ext}`;
  const filePath = path.join(env.UPLOADS_DIR, objectKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, opts.data);
  await bundle.withTenant({ gymId: opts.gymId, userId: opts.userId }, (tx) =>
    tx.insert(schema.mediaAssets).values({
      id,
      gymId: opts.gymId,
      kind,
      objectKey,
      mime: opts.mime,
      sizeBytes: opts.data.length,
      uploadedBy: opts.userId,
    }),
  );
  return { id, objectKey };
}

export interface MediaFile {
  mime: string;
  size: number;
  stream: (range?: { start: number; end: number }) => fs.ReadStream;
}

/** Resolve a media asset the given tenant context can see (RLS applies). */
export async function openMedia(
  bundle: DbBundle,
  ctx: { gymId: string; userId: string },
  mediaId: string,
): Promise<MediaFile | null> {
  const rows = await bundle.withTenant(ctx, (tx) =>
    tx.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, mediaId)).limit(1),
  );
  const asset = rows[0];
  if (!asset) return null;
  const filePath = path.join(env.UPLOADS_DIR, asset.objectKey);
  if (!fs.existsSync(filePath)) return null;
  const size = fs.statSync(filePath).size;
  return {
    mime: asset.mime,
    size,
    stream: (range) => fs.createReadStream(filePath, range),
  };
}

export { pipeline as streamPipeline };
