# Deploying

The app deploys as **one service**: the API serves the built SPA, so `/api` calls are same-origin and there is no CORS or proxy layer in production. Reference deployment is Railway; anything that runs a Node container works the same way.

## What the platform must provide

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Owner/superuser connection. The app derives its own RLS-bound `app_rw` connection from it (see below). |
| `SENSITIVE_DATA_KEY` | yes in production | Base64 32 bytes. Encrypts PAR-Q answers, injury notes, progress photos. **Boot fails without it** rather than falling back to the repo's dev default. Changing it makes existing encrypted rows unreadable. |
| `APP_DB_PASSWORD` | yes in production | Password for the `app_rw` role the migrator creates. |
| `NODE_ENV` | yes | `production` |
| `PORT` | injected | Railway/Heroku style; the server binds `0.0.0.0` on it. |
| `RAILWAY_PUBLIC_DOMAIN` | optional | Used for invite links when `WEB_ORIGIN` is unset. |
| `WEB_ORIGIN` | optional | Overrides the public origin used in invite links. |
| `UPLOADS_DIR` | optional | See "media persistence" below. |

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SENSITIVE_DATA_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))" # APP_DB_PASSWORD
```

## The two database identities

Tenant isolation depends on the app connecting as a **non-owner** role so row-level security can never be bypassed ([ARCHITECTURE §4](ARCHITECTURE.md)). Managed Postgres gives you one owner URL, so:

- `DATABASE_URL` (owner) → used for migrations and DDL.
- `app_rw` → created by the migrator on first boot, password taken from `APP_DB_PASSWORD`, granted DML only. The app connects as this role.

Set `DATABASE_ADMIN_URL` explicitly if you want to supply both connections yourself (this is what local dev does).

## Deploy steps (Railway)

```bash
railway link                        # pick project + service
railway variables --set "NODE_ENV=production" \
  --set "SENSITIVE_DATA_KEY=..." \
  --set "APP_DB_PASSWORD=..." \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}'
railway domain                      # generate a public domain
git push origin main                # build + deploy
```

`railway.json` pins the build command, start command, and the `/api/health` healthcheck. Migrations run automatically on boot (`MIGRATE_ON_BOOT`, default on in production) — single replica assumed; with multiple replicas run migrations as a pre-deploy step instead.

Then load the platform exercise library and create the first gym:

```bash
railway ssh "npm run db:seed:platform"
railway ssh 'npm run gym:create -- --name "Your Gym" --email owner@yourgym.com'
```

`gym:create` prints a generated password once if you don't pass `--password`. There is no self-serve signup yet — the onboarding wizard is Phase 9.

**Never run `npm run db:seed` against production.** That loads the demo gym; it refuses to run when `NODE_ENV=production`, and `db:seed:platform` is the production-safe subset.

## Known production limitations

- **Media persistence.** The local media adapter writes to `UPLOADS_DIR` (default `./uploads`), which is **ephemeral on Railway** — uploaded demo videos and form-check clips are lost on redeploy. Attach a volume and point `UPLOADS_DIR` at it, or switch to the Cloudflare Stream/R2 adapter (the interface is already in place, see [DECISIONS.md](DECISIONS.md) D-015).
- **Payments** run through the dev provider until the merchant-of-record question is settled ([OPEN_QUESTIONS #1](OPEN_QUESTIONS.md)).
- **Email/SMS** are not wired; invites return a copyable link instead of sending mail.
- **MFA** for Owner/Admin is not implemented yet, though the spec requires it before real member data lands.
