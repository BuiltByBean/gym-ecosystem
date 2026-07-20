# Status — v1 build

Updated 2026-07-19. Working v1 covering roughly Phases 0–6 of [ROADMAP.md](ROADMAP.md) in compressed form, verified end-to-end in the browser with seeded demo data. `npm install && npm run dev`, then `npm run db:seed` — see [README](../README.md) for demo logins.

## What shipped (working, tested)

**Foundation (Phase 0).** Monorepo, CI workflow, embedded Postgres for dev/test (no Docker), 10 versioned SQL migrations with **forced RLS on every tenant table** (fail-closed via transaction-local `app.gym_id`), `authorize()` with a 61-action catalog and the permission-matrix contract test, audit log with structurally-enforced sensitive-read auditing, session auth (scrypt + DB sessions), tenant resolution (host → `tenant_domains`, else session), invite flows.

**People (Phase 1).** Gym profile/branding (live re-theme on brand color change), policies, staff roster + invites, member roster with all five states + members-without-logins + claim flow, versioned waiver signing (doc hash + IP + signer, never a boolean), encrypted PAR-Q screening, member-controlled trainer health grants (default-granted on assignment, revocable in the member app), injury/limitation records feeding substitutions, CSV import with mapper UI + dry-run + per-row errors, front-desk surface with field-level masking.

**Floor plans + wayfinding (added after v1).** Admin floor-plan editor: real-world-scaled canvas, zoom/pan, grid snap, drag-and-drop machine placement, rotate/nudge/delete, labelled colour zones, entrance marker, optional background image to trace an existing plan. Machines carry a footprint, a photo gallery, a how-to video, and setup steps. Members get a gym map with search, "Where is it" inline in the workout player (machine, zone, one tap to a highlighted pin), and a numbered route for the day's exercises. Location resolution prefers an explicit exercise→machine link over a broad equipment-class match and counts units per model.

**Equipment + exercises (Phase 2).** Models/units split with per-unit QR tags (printable sheets), status lifecycle with history, member two-tap issue reporting, maintenance queue, 61-exercise platform library + gym layer with fork, the substitution graph (curated edges + derived pattern-mates) with the ranked, equipment-aware, limitation-aware query, out-of-service trigger → affected programs + notifications, demo video upload → admin review → versioned publish (local media adapter).

**Programs (Phase 3).** Builder (weeks/days/items, four load types, supersets, rest/tempo/RPE, authoring-time alternates, copy-week), draft → publish version freeze, assignment (individual + whole-gym free programs), member consumption with resolved targets (percent-of-max from tested maxes, linear + double progression as data).

**Offline logging (Phase 4).** IndexedDB op log + outbox (writes durable before UI confirms), idempotent push batches, per-field LWW sessions with HLC, shared fold client/server, rest timer, plate calculator, warm-up flag, amend/void as append-only ops, mid-workout substitution sheet, form-check video capture → trainer review thread, server-side PR detection with celebration screen, machine QR pages, PWA (precached shell, runtime media cache, installable).

**Scheduling + money core (Phases 5–6, core).** Trainer availability templates, slot computation in gym timezone, member self-booking inside availability + staff booking anywhere, DB exclusion-constraint double-booking prevention, completion/no-show with package redemption, late-cancel incidents with configurable fees (posting separated from collection), effective-dated rate cards resolved most-specific and **frozen onto bookings**, packages with append-only ledger, payments via dev provider, front-desk check-in, live BI dashboard (penetration, engagement, revenue, equipment-usage heatmap data, trainer utilization, content performance).

**Tests: 120 passing** — permission matrix (+ structural sweeps), sync fold/ULID/HLC, cross-tenant isolation (RLS registry sweep + raw probes + 404 API probes), substitution, billing math, booking conflicts, push idempotency, PR detection, progression, and wayfinding (placement, zone naming, link-vs-class resolution, per-model counts, route ordering, equipment media, plan isolation).

## Stubbed / dev-adapter (interface real, provider pending)

- **Payments**: dev provider marks paid instantly. Stripe Connect adapter needs the merchant-of-record decision ([OPEN_QUESTIONS #1](OPEN_QUESTIONS.md)) + keys.
- **Media**: local-disk storage + direct MP4 playback. Cloudflare Stream/R2 adapter (transcode, HLS, captions) needs credentials.
- **Email/SMS**: invites return copyable links (also console-logged); notification outbox is in-app only. Resend/Twilio plug into the notify service.
- **Waiver PDF snapshot**: signature stores template version + SHA-256 of the exact text; rendered-PDF archival pending.
- **MFA**: schema fields exist; TOTP enrollment UI not built.

## Not started (per roadmap)

Trainer matching (Phase 7), in-app messaging, lifecycle automations, progress photos (encrypted store), calendar sync/ICS, waitlists, recurring bookings, group classes, trainer compensation/payroll (Phase 6 back half), rollup jobs (dashboards query live — fine at this scale), marketing site, platform-admin surface + gym onboarding wizard (Phase 9), Capacitor wrapper (Phase 10), gym groups/multi-location UI.

## Known deviations from ARCHITECTURE.md (logged in DECISIONS.md D-013…D-017)

First-party session auth instead of Better Auth for v1; no job queue yet (nothing needs one until transcode/imports-at-scale — Graphile Worker slots in as designed); charts use a fixed accessibility-validated palette rather than gym brand color; npm workspaces instead of pnpm/Turborepo.

## Verified in browser (2026-07-19)

Owner dashboard with live seeded metrics → member roster/detail (health tab decrypts PAR-Q, read audited) → member login → Today (next incomplete day, 75%-of-max resolution) → workout player (set logged durable-first in IndexedDB, outbox drained, rest timer, substitution sheet with curated reasons + live availability) → finish → **PR celebration from server detection** → Progress (streak, PR list, e1RM trend chart, volume stacks, bodyweight).
