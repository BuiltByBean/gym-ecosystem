import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { sql } from 'drizzle-orm';
import { env, getDb, isProduction, repoRoot, runMigrations } from '@gym/db';
import { appRouter } from './routers/index.js';
import { createContext } from './context.js';
import { mediaKindForMime, openMedia, saveMedia } from './media.js';

const app = Fastify({
  bodyLimit: 250 * 1024 * 1024, // form videos from phones
  disableRequestLogging: true,
  // behind Railway's edge: makes req.protocol/req.ip reflect the real client,
  // which the Secure cookie flag and audit log depend on
  trustProxy: isProduction,
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

// --- static web app -------------------------------------------------------
// In production the API also serves the built SPA, so the whole product is one
// deployable unit and the client's relative /api calls are same-origin.
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'web', 'dist',
);
const hasWebBuild = fs.existsSync(path.join(webDist, 'index.html'));

if (hasWebBuild) {
  await app.register(fastifyStatic, {
    root: webDist,
    // the plugin's own cacheControl would overwrite setHeaders — own it here
    cacheControl: false,
    // hashed assets are immutable; index.html and sw.js must always revalidate
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });

  // SPA fallback: client-side routes resolve to index.html, API 404s stay JSON
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
} else if (isProduction) {
  console.warn(`[api] no web build at ${webDist} — serving API only`);
}

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

if (env.MIGRATE_ON_BOOT) {
  const applied = await runMigrations(env.DATABASE_ADMIN_URL, {
    log: (m) => console.log(`[db] ${m}`),
    syncRolePassword: true,
  });
  console.log(applied.length ? `[db] applied ${applied.length} migration(s)` : '[db] schema up to date');
}

await waitForDb();
await app.listen({ port: env.API_PORT, host: env.HOST });
console.log(`[api] listening on http://${env.HOST}:${env.API_PORT}${hasWebBuild ? ' (serving web build)' : ''}`);
