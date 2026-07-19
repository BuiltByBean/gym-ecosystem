import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { sql } from 'drizzle-orm';
import { env, getDb } from '@gym/db';
import { appRouter } from './routers/index.js';
import { createContext } from './context.js';
import { mediaKindForMime, openMedia, saveMedia } from './media.js';

const app = Fastify({
  bodyLimit: 250 * 1024 * 1024, // form videos from phones
  disableRequestLogging: true,
});

await app.register(cookie);

// Raw uploads: client PUTs the blob with its real content type.
for (const type of ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'application/octet-stream']) {
  app.addContentTypeParser(type, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
}

await app.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ error, path }: { error: Error; path?: string }) {
      if ((error as { code?: string }).code === 'INTERNAL_SERVER_ERROR') {
        console.error(`[trpc] ${path}:`, error);
      }
    },
  },
});

app.get('/api/health', async () => ({ ok: true }));

app.post('/api/media', async (req, reply) => {
  const ctx = await createContext({ req, res: reply } as never);
  if (!ctx.user || !ctx.gym || !ctx.actor) return reply.code(401).send({ error: 'unauthorized' });
  const mime = String(req.headers['x-media-mime'] ?? req.headers['content-type'] ?? '');
  if (!mediaKindForMime(mime)) return reply.code(415).send({ error: `unsupported type ${mime}` });
  const purpose = String((req.query as Record<string, string>).purpose ?? 'demo');
  // demo videos: staff with upload rights; issue photos + form checks: anyone in-gym
  if (purpose === 'demo') await ctx.allow('video.upload');
  else if (purpose === 'report') await ctx.allow('equipment.report_issue');
  else await ctx.allow('workout.log', { type: 'media', memberId: ctx.actor.memberId });
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'empty body' });
  const saved = await saveMedia(ctx.bundle, {
    gymId: ctx.gym.id,
    userId: ctx.user.id,
    mime,
    data: body,
  });
  return { mediaId: saved.id };
});

app.get('/api/media/:id', async (req, reply) => {
  const ctx = await createContext({ req, res: reply } as never);
  if (!ctx.user || !ctx.gym) return reply.code(401).send({ error: 'unauthorized' });
  const media = await openMedia(ctx.bundle, { gymId: ctx.gym.id, userId: ctx.user.id }, (req.params as { id: string }).id);
  if (!media) return reply.code(404).send({ error: 'not found' });

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cache-Control', 'private, max-age=3600');
  const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), media.size - 1) : media.size - 1;
    if (start >= media.size) return reply.code(416).header('Content-Range', `bytes */${media.size}`).send();
    reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${media.size}`)
      .header('Content-Length', end - start + 1)
      .type(media.mime);
    return reply.send(media.stream({ start, end }));
  }
  reply.header('Content-Length', media.size).type(media.mime);
  return reply.send(media.stream());
});

async function waitForDb(timeoutMs = 60_000): Promise<void> {
  const bundle = getDb();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await bundle.db.execute(sql`select 1`);
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

await waitForDb();
await app.listen({ port: env.API_PORT, host: '127.0.0.1' });
console.log(`[api] listening on http://127.0.0.1:${env.API_PORT}`);
