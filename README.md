# Gym Ecosystem

Multi-tenant gym operations and training platform. See `docs/` for architecture, data model, roadmap, and decision log; `docs/STATUS.md` for what currently works and `docs/DEPLOY.md` for deploying.

Live: https://gym-ecosystem-production.up.railway.app

## Quick start (development)

Requires Node 22+. No Docker or local Postgres needed — dev uses embedded Postgres binaries.

```
npm install
npm run dev        # boots Postgres (port 5433), API (3001), web app (5173)
npm run db:seed    # loads platform exercise library + demo gym (dev only)
```

Then open http://localhost:5173 and sign in with a demo account (all password `demo-password-123`):

| Email | Role |
| --- | --- |
| owner@demo.gym | Owner |
| admin@demo.gym | Admin |
| desk@demo.gym | Front Desk |
| trainer@demo.gym | Trainer |
| member@demo.gym | Member |

## Commands

- `npm test` — full test suite (permission matrix, cross-tenant isolation, sync, money math)
- `npm run typecheck` — all packages
- `npm run db:migrate` — apply pending migrations (dev server does this on boot)
- `npm run build` — production build of the web app
- `npm start` — run the way production does (API + built SPA on one port)
- `npm run db:seed:platform` — platform exercise library only (safe in production)
- `npm run gym:create -- --name "Gym" --email owner@gym.com` — provision a real gym + owner

## Layout

```
apps/api        Fastify + tRPC API, services, auth
apps/web        Vite + React SPA/PWA (admin, trainer, member surfaces)
packages/db     SQL migrations (RLS), drizzle schema, tenant context wrapper
packages/authz  authorize() + permission matrix (the contract)
packages/sync   offline op-log: types, fold, ULID/HLC — shared client/server
seeds/          platform content + dev-only demo data
```
