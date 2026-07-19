# Architecture

Status: **draft for review** — no code exists yet. This document is the contract for how the system is built. Companion docs: [DATA_MODEL.md](DATA_MODEL.md), [ROADMAP.md](ROADMAP.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), [DECISIONS.md](DECISIONS.md).

## 1. System shape

Three surfaces, one backend, one monorepo.

```
apps/
  marketing/   Astro — public marketing site, SSG/SSR, SEO, structured data
  app/         Vite + React SPA — the product: admin surface + member PWA, one shell
  api/         Fastify + tRPC — all business logic, auth, tenant resolution
  worker/      Graphile Worker — transcoding hooks, imports, notifications, rollups
packages/
  db/          Drizzle schema, versioned SQL migrations, RLS policies
  contracts/   Zod schemas + tRPC router types shared client/server
  authz/       authorize(actor, action, resource) + the permission matrix
  sync/        offline op-log engine: fold functions shared client/server
  capabilities/ adapter interface for platform features (web impl now, native later)
  ui/          design tokens + component library (see DESIGN.md, Phase 0)
seeds/         dev-only seed data, loadable only when NODE_ENV=development
```

The **product app is a static-asset SPA, not a server-rendered app**. This is the one place I argue with the spec's default suggestion (Next.js for everything), and it is load-bearing:

- The member surface must boot and run fully offline (§5.3). A service worker can precache a Vite SPA's hashed static bundle completely and deterministically. An App Router app's server-component payloads cannot be precached the same way; community PWA support for App Router is the least "boring, proven" part of the Next ecosystem.
- The native wrapper (§5.4) must be a packaging step. Capacitor wraps a directory of static assets verbatim. Wrapping a Next app means either static export (losing the reasons you chose Next) or remote-URL mode (app cannot boot offline — violates the spec). Building the shell as a SPA from day one makes Phase 10 genuinely additive.
- The admin surface is behind auth: SEO is irrelevant, and a dense, keyboard-driven table UI is exactly what SPAs are good at.

Admin and member surfaces live in **one shell** (spec §5.1) as separate route trees with route-level code splitting, so the member bundle stays small and the precache manifest for the member/floor experience doesn't drag in admin tables.

The marketing site is the only surface that needs server rendering and CWV excellence, so it gets a purpose-built static-first tool (Astro) rather than carrying a React meta-framework for a brochure site.

## 2. Stack recommendation

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript everywhere, `strict` | Zod at every boundary |
| Monorepo | pnpm workspaces + Turborepo | boring, fast CI caching |
| Marketing | Astro | SSG/SSR, best-in-class CWV, structured data via JSON-LD components |
| Product app | Vite + React 18 + TanStack Router/Query | SPA, PWA via `vite-plugin-pwa` (Workbox) |
| Styling | Tailwind + CSS custom properties for tokens | brand color is a runtime variable per gym (white-label requirement) |
| API | Fastify + tRPC v11 | typed contract shared via `packages/contracts` |
| Validation | Zod | single schema source for API, forms, and import mapping |
| Database | PostgreSQL 16 (managed, Railway) | system of record |
| ORM / migrations | Drizzle + drizzle-kit generated SQL migrations, hand-reviewed | chosen for RLS ergonomics, see §4 |
| Auth | Better Auth (organization plugin, TOTP MFA, passkeys) | sessions in our Postgres; orgs map to gyms |
| Jobs | Graphile Worker (runs on Postgres) | transactional enqueue; no Redis to operate |
| Payments | Stripe: Billing for gym subscriptions; Connect Standard for member payments | never store card data; gym is merchant of record (pending OPEN_QUESTIONS #1) |
| Video | Cloudflare Stream | tus resumable uploads, transcode, HLS, thumbnails, generated captions |
| Object storage | Cloudflare R2 | photos, waiver PDFs, exports; zero egress; private buckets + signed URLs |
| CDN / TLS / custom domains | Cloudflare (SSL for SaaS for custom hostnames) | one vendor for edge concerns |
| Email | Resend | per-gym templates rendered server-side |
| SMS | Twilio | metered per gym (OPEN_QUESTIONS #14) |
| Push | Web Push (VAPID) now; APNs/FCM via Capacitor in Phase 10 | behind `capabilities/` adapter |
| Errors / logs / analytics | Sentry; pino structured logs; PostHog behind consent gate | operational data ≠ telemetry, see §9 |
| Hosting | Railway (api, worker, app, marketing) behind Cloudflare | containers; managed Postgres with PITR |
| E2E / tests | Vitest, Playwright, Testcontainers-style PG for integration | permission matrix + cross-tenant suites are the contract |

### Alternatives rejected (and why)

- **Next.js App Router for the product app** — rejected for the offline/native reasons in §1. Next remains a fine choice if we later want an SSR'd surface; nothing in the API design precludes it.
- **Next.js for marketing** — workable, but Astro produces faster pages with less JS by default and is simpler to maintain for a content site. If the team strongly prefers one React framework everywhere, this is the cheapest decision to reverse (marketing has no shared runtime code with the app).
- **Prisma** — mature, but our tenant isolation runs on `SET LOCAL` + RLS inside a per-request transaction, and Drizzle's thin SQL layer makes that pattern explicit and auditable. Drizzle migrations are plain SQL we can read in review, which matters when every schema change is a versioned migration by rule.
- **Clerk** — excellent DX, but per-tenant custom domains, per-gym roles, and kiosk/impersonation flows push us into enterprise pricing and vendor-shaped corners. Auth data (who belongs to which gym with which role) is the heart of our permission model; keeping it in our Postgres keeps the permission matrix testable in one place. Risk acknowledged: Better Auth is younger than Auth.js — mitigation: it sits behind our own session/context module (`apps/api/src/auth/`), so swapping providers touches one package, not controllers.
- **Auth.js** — org/role/MFA support requires more hand-rolling than Better Auth; project momentum has visibly slowed.
- **BullMQ + Redis** — adds an infra component for no v1 need. Graphile Worker enqueues jobs in the same transaction as the row writes that cause them (e.g., video webhook → transcode-complete job), which removes a whole class of "row committed but job lost" bugs. If job volume outgrows Postgres, the queue interface is one module.
- **Mux** — better analytics and DX polish than Stream, at meaningfully higher per-minute cost. Gyms will upload hundreds of demo videos; storage-heavy, view-light workloads favor Stream's pricing. Mux is the fallback if Stream's caption quality or reliability disappoints in Phase 2.
- **Replicache / PowerSync / ElectricSQL for offline sync** — these sync entire data domains generically. Our offline-write surface is deliberately tiny (the active workout session and its set log); everything else offline is read-only cache. Owning a purpose-built ~1k-line sync engine for one append-only domain is less risk than adopting a general sync platform, its licensing, and its conflict semantics for the whole schema. See §6.
- **tRPC alternative: OpenAPI/ts-rest typed REST** — REST would give wire-stable contracts for third parties, but we have no third-party API consumers in v1. tRPC's end-to-end types are worth more. Mitigations for client/server version skew (stale PWA shells): additive-only procedure evolution, tolerant-reader clients, and the sync protocol versioned independently (§6.6). Webhooks and importer callbacks are plain Fastify REST routes.

## 3. Tenant model and request context

- Tenant unit is the **gym** (`gym_id` on every tenant-owned table). Gym groups are an umbrella entity for roll-up reporting and cross-location staff; a group is not a tenant. (OPEN_QUESTIONS #2.)
- Hostname → tenant: `tenant_domains` table maps `gymname.ourplatform.com` subdomains and custom domains to `gym_id`. Custom domains onboard via Cloudflare SSL for SaaS (customer CNAMEs to us; TLS is automated; `tls_status` tracked on the row).
- **Request context is derived server-side only**: `(user, gym, roles, grants)` comes from the session cookie plus the request `Host`. A client-supplied `gym_id` is never trusted anywhere — it appears in URLs only for platform-admin tooling, and even there it is re-authorized per request.
- Auth cookies are scoped per-host. On custom domains, login happens on that host against the same API (Cloudflare routes all tenant hostnames to the same origin). One human account can hold different roles at different gyms; the app shell exposes a gym switcher and keys all local caches by `gym_id`.

## 4. Tenant isolation at the database layer

Defense in depth: RLS is the backstop, `authorize()` is the policy. Neither substitutes for the other.

- Every tenant-owned table: `gym_id uuid not null` FK, present in every index and every unique constraint (`unique (gym_id, ...)`).
- RLS enabled **and forced** on every tenant table:

```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON members
  USING (gym_id = current_setting('app.gym_id', true)::uuid);
```

- The API connects as `app_rw`, a non-owner role with no `BYPASSRLS`. Every request runs inside a transaction that first executes `SELECT set_config('app.gym_id', $1, true)` (transaction-local, so it is safe under transaction-mode pooling if we ever add PgBouncer). If the setting is absent, `current_setting(..., true)` returns NULL and every policy evaluates false — **fail closed, zero rows**.
- Shared platform content (the platform exercise library, platform program templates) lives in the same tables with `gym_id IS NULL` and a read policy of `gym_id = current_setting(...) OR gym_id IS NULL`; writes to platform rows require the platform-admin path. Uniqueness for these tables uses partial unique indexes (one for `gym_id IS NULL`, one composite). (DECISIONS D-004.)
- Platform Admin cross-tenant access does **not** use `BYPASSRLS`. The app layer verifies an active `support_access_grants` row (stated reason, expiry), writes the audit event in the same transaction, then sets `app.gym_id` to the target gym. Cross-tenant aggregate jobs (platform billing, health dashboard) use a dedicated `app_reporting` role whose queries are code-reviewed as a category.
- Migrations run as the table owner via a separate CI-only credential.
- **The cross-tenant test suite is a Phase 0 deliverable**: fixtures for two gyms; for every resource type, authenticated requests from gym A against gym B's ids must return **404, not 403** — a 403 leaks resource existence across tenants (DECISIONS D-003). The suite iterates resource types from a registry, so adding a table without registering it fails CI.

## 5. Authorization layer

One service: `authorize(actor, action, resource)` in `packages/authz`. Every tRPC procedure declares its action; a middleware calls `authorize` before the handler runs — there is no code path to tenant data around it.

- **Actions** are a closed string-enum catalog per domain (`member.read_health`, `booking.create`, `rate_card.update`, …). Adding an endpoint means adding an action, which forces a permission-matrix update, which is a reviewed diff.
- **Policy is plain TypeScript** — a function table keyed by action, taking `(actor, resource)` and consulting: role in this gym, Front Desk restrictions (deny-list on health, notes, financial scopes), the per-gym "admin financial visibility" toggle, member→trainer health-data grants, and minor-account restrictions. No policy DSL; the matrix test is the spec.
- **The permission matrix test is the contract** (spec §3): a canonical table in `packages/authz/matrix.ts` of every (role, action) → allow/deny/conditional; the test iterates all of it against fixture data. Conditional cells (e.g., trainer reading health metrics requires a grant) get explicit fixture pairs for both outcomes.
- Sensitive-scope reads (`*.read_health`, progress photos, injury notes) emit an audit event from the same middleware — logging every read is enforced structurally, not by convention.
- Support impersonation renders as the impersonated user but carries an `impersonation` claim; `authorize` blocks irreversible actions (payments, deletions) under impersonation and audits everything.

## 6. Offline-first workout logging and sync

The spec's hardest requirement (§4.7, §5.3): usable with no connection, one hand, bad wifi; **never lose a logged set**. Design principle: offline **writes** are confined to one small domain — the active workout — and that domain is append-only. Everything else offline is read-only cache.

### 6.1 Local store (IndexedDB via Dexie)

| Store | Contents |
| --- | --- |
| `session_state` | active workout session docs: LWW fields (status, session notes, felt-difficulty) with HLC stamps |
| `set_ops` | append-only operation log, the source of truth for logged work |
| `outbox` | ops + field-updates pending push, with attempt metadata |
| `media_outbox` | recorded form videos / progress photos pending resumable upload (wifi-preferred flag) |
| `content` | cached program versions, exercise library + substitution graph, last-performance summaries |
| `meta` | sync cursors per collection, device_id, schema version |

Writes to `set_ops` + `outbox` are committed to IndexedDB **before** the UI confirms the set. App killed mid-set loses nothing.

### 6.2 The op log

Every logged set is an immutable op:

```json
{ "op_id": "<ULID>", "kind": "set_logged | set_amended | set_voided | substitution",
  "session_id": "…", "amends": "<op_id or null>",
  "program_item_id": "… or null", "exercise_id": "…", "set_no": 3,
  "payload": { "weight_kg": 60, "reps": 8, "rpe": 8.5, "is_warmup": false, "note": "" },
  "actor_user_id": "…", "device_id": "…", "client_seq": 41,
  "client_ts": "…", "hlc": "…" }
```

- Corrections and deletions are **new ops** (`set_amended`, `set_voided`) referencing the original — history is never rewritten, so sync can never destroy a set.
- Server table `set_log` upserts by `op_id` with `ON CONFLICT DO NOTHING` — pushes are idempotent; retries and duplicate batches are harmless.
- A shared **fold function** in `packages/sync` reduces an op chain to current-view state. Client and server run the same code, so what the member sees offline is exactly what the trainer sees after sync.
- `(device_id, client_seq)` is a per-device gapless counter; the server detects gaps and requests resend, catching partially-delivered batches.

### 6.3 Session-level fields

Non-append fields (session status, notes, felt-difficulty) use per-field last-write-wins with hybrid logical clocks (client HLC, server receive-time as tiebreak and skew bound). Field updates travel in the same outbox.

### 6.4 Sync loop

- **Push**: outbox drained in batches with a batch-level idempotency key; triggered by Background Sync API where supported, else on `online` / `visibilitychange` / app-resume with exponential backoff. Ack removes from outbox.
- **Pull**: per-collection version cursors (`updated_seq`) for delta sync of programs, exercise graph, and last-performance data. Pull never touches `set_ops` except to confirm server acks.
- **Media**: `media_outbox` uploads via tus (Stream) / multipart (R2) with offset resume; large files wait for wifi unless the member overrides.

### 6.5 Conflict matrix (enumerated, tested)

| Situation | Resolution |
| --- | --- |
| Same member, two devices, same session | Both devices' set ops are kept — both sets happened; actor/device attribution shown; a heuristic flags *possible* duplicates for one-tap merge, never auto-drops |
| Trainer edits program mid-workout | Sessions pin `program_version_id` at start; the edit lands next session |
| Equipment goes out of service mid-session | Substitution resolved locally from the cached graph; logged as a `substitution` op |
| Trainer logs on behalf of member on floor tablet while member's phone offline | Same as two-device: append-only ops merge cleanly with attribution |
| Clock skew | HLC bounded by server receive time |
| Device storage pressure | Video cache evicted LRU; op log and outbox are never evicted |
| Stale app shell (old SW) | Sync envelope carries `sync_v`; server supports N−1 and can instruct "sync then update shell" |

### 6.6 Sync protocol versioning

The sync envelope is versioned independently of the tRPC API. Members run week-old cached shells; the server must accept version N−1 pushes forever within a major, and breaking changes require a migration job, not a flag day.

### 6.7 Offline caching tiers (service worker + Cache Storage)

| Tier | Strategy |
| --- | --- |
| App shell | Precached, hash-versioned (Workbox manifest), atomic SW activation |
| Exercise library + substitution graph | Cached on assignment, delta-refreshed via pull cursor |
| Assigned program versions | Cached on assignment (server sends a manifest of needed assets) |
| Demo videos | **Explicit member opt-in per program**; downloads the 720p MP4 progressive rendition (offline HLS is not worth its complexity), quota-aware, evictable. The spec's "entire active workout including video usable offline" holds *after* the opt-in download completes; the UI shows per-program download state (see OPEN_QUESTIONS #8) |
| API reads | TanStack Query persisted cache, stale-while-revalidate |

Wake lock during active workout, rest-timer notifications, camera capture — all via `packages/capabilities` (web implementations now; Capacitor implementations in Phase 10; no `if (isNative)` in UI code).

## 7. Media pipeline

1. **Capture/upload**: trainer's phone, mobile web. API mints a short-lived direct-upload URL (tus, resumable) scoped to gym + uploader — minted only if the gym is under its plan's storage quota. Chunks survive connection drops.
2. **Process**: Stream transcodes to renditions, generates poster frames and captions. Webhook → `worker` job (transactionally enqueued) updates the video row, stores editable caption VTT in R2.
3. **Review/publish**: state machine `draft → pending_review → published → retired`. Trainer uploads; Admin publishes. Publishing requires a **talent release** on file for every person appearing (release records link person ↔ video version; revocation enqueues an unpublish job and flags affected programs).
4. **Versioning**: videos belong to a `video_group`; programs and exercises reference the group, delivery resolves to its current published version — replacing a video never breaks links.
5. **Delivery**: HLS via Stream's CDN with signed, gym-scoped playback tokens; poster images via R2+CDN. Offline: per §6.7.
6. **Quotas**: per-plan storage/minute metering; nightly rollup + increment on webhook; admin dashboard shows usage; uploads blocked (with a clear message) at quota.

Progress photos and form-check videos are **not** gym content: private R2 bucket, random object keys, short-lived signed URLs issued only through `authorize` (member grants govern trainer access), every issuance audited.

## 8. Security, privacy, compliance

- **Sensitive class** (PAR-Q responses, injury notes, progress photos): app-layer envelope encryption — per-gym data keys wrapping sensitive columns, DEKs wrapped by a master key in the platform KMS; separate from disk-level encryption, so a DB snapshot alone reveals nothing. Health data lives in dedicated tables (`health_screenings`, `member_limitations`, `progress_photos`) so it stays separable for a future HIPAA-adjacent client. Every read is audited (§5).
- **Waivers and releases are legal artifacts**: signature rows store template version id, rendered-document SHA-256, a PDF snapshot in R2, timestamp, IP, user agent, signer identity (member or guardian). Never a boolean.
- **Minors**: DOB captured; per-gym minor threshold; guardian consent flow; leaderboards/challenges excluded by default; restrictions enforced in `authorize`.
- **GDPR/CCPA**: export job (JSON + media archive); deletion job honoring a documented retention-exception list (signed waivers, financial records, audit log); consent records for photos, marketing contact, analytics.
- **MFA** (TOTP + passkeys) enforced for Owner/Admin; session management UI; visible audit log per gym.
- **Rate limiting**: Cloudflare edge rules + per-route token buckets in the API; strict budgets on auth and upload-token endpoints.
- Stripe holds all card data; we store customer/payment-intent references only.

## 9. Background jobs, notifications, observability

- Graphile Worker queues: `media`, `imports`, `notifications`, `reports`, `sync-maintenance`, `rollups`. Jobs are idempotent and carry `gym_id`; the worker sets tenant context per job exactly like a request.
- Notifications flow through a `notification_outbox` (channel routing per user preference, per-gym templates, quiet hours in the gym's timezone, provider delivery status webhooks). Push via Web Push now, APNs/FCM later behind the same interface.
- BI rollups (equipment usage heatmap, utilization, engagement) are nightly jobs writing rollup tables — dashboards never scan raw logs. **Operational data** (logged workouts, bookings — product features) is distinct from **telemetry** (PostHog, Sentry), which alone sits behind the consent gate.
- pino structured logs with `request_id`/`gym_id` on every line; Sentry on API, worker, and both frontends.

## 10. Environments, CI/CD

- `dev` (local: Docker Postgres + seeds), `preview` (per-PR frontends), `staging`, `prod`. Seeds never load outside dev — enforced in code.
- GitHub Actions: typecheck, lint, unit, integration (real Postgres, RLS on — the cross-tenant and permission-matrix suites), Playwright smoke incl. one offline scenario, build. Migrations apply as a gated deploy step before app rollout; every migration needs a rollback note.
- Backups: managed PITR + nightly logical dump to R2 (separate account). DR runbook is a Phase 0 doc. Single region (US) at launch; EU residency is a known future fork (OPEN_QUESTIONS #15).

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Better Auth maturity | isolated behind our session module; Auth.js/Clerk swap touches one package |
| Stream caption quality | captions editable by design; Mux fallback evaluated in Phase 2 |
| Custom sync engine correctness | smallest possible write domain; shared fold code; property-based tests + the Phase 4 offline test plan; conflict matrix is enumerated, not discovered |
| iOS PWA limits (push, storage eviction) | graceful degradation per spec; op log persisted durably and re-pushable; Capacitor path exists precisely for iOS gaps |
| Import quality from legacy systems | mapper UI with dry-run diff + per-row error report, not silent best-effort |
