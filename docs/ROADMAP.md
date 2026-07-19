# Roadmap

Status: **draft for review**. Phases follow the spec (§7). Each phase is broken into vertical slices; per the working rules, a slice is not done until it has migration, model, service, API, permission checks, tests, and UI — sizes below include all of that.

**Sizing**: S ≈ 1–2 eng-days, M ≈ 3–5, L ≈ 6–10, XL ≈ 10–15. Assumes one senior full-stack engineer working with Claude Code; calendar time ≠ effort (reviews, pilot feedback). Estimates are for sequencing and scope honesty, not commitments. Every phase ends with: full test suite green, build green, short status report (shipped / stubbed / next). All phases ship behind per-gym feature flags so a pilot gym can run Phase 4 while Phase 5 is in progress.

## Phase 0 — Foundation (no features, everything load-bearing)

| Slice | Size | Notes |
| --- | --- | --- |
| Docs approved: ARCHITECTURE, DATA_MODEL, ROADMAP, DECISIONS seeded | — | this gate |
| Monorepo scaffold, CI (typecheck/lint/unit/integration/build), envs, seeds-in-dev-only guard | M | |
| Postgres + Drizzle + migration harness; RLS baseline (roles, fail-closed policies, `set_config` request wrapper) | M | |
| Auth: Better Auth integration, sessions, tenant resolution from Host, gym switcher context | L | custom-domain TLS deferred to Phase 9 |
| `packages/authz`: `authorize()`, action catalog, role definitions incl. Front Desk, **permission matrix test** | L | the contract test |
| Cross-tenant isolation test harness (two-gym fixtures, resource registry, 404 assertions) | M | registry generated from DATA_MODEL §15 |
| `audit_events` core + sensitive-read middleware | S | |
| DESIGN.md + token system + app shell (nav, role-aware routing, empty states pattern) | M | design plan reviewed before UI code, per spec §6 |

**Phase total ≈ 4–6 weeks.** Exit: a deployed skeleton where two seeded gyms cannot see each other, every role hits its expected allows/denies, and CI enforces both forever.

## Phase 1 — Gym setup, people, waivers

| Slice | Size |
| --- | --- |
| Gym profile, branding (logo, colors, subdomain), locations, hours, closures | M |
| Staff roster: invites, roles, trainer profiles, employee-vs-contractor | M |
| Member roster: CRUD, states (prospect→cancelled), search, member-without-login + claim flow | L |
| Waiver templates + signing flow (versioned artifact, PDF snapshot) | M |
| Health screening (PAR-Q): templates, member flow, encrypted storage, grant-gated reads | M |
| Member↔trainer assignment + member-controlled grants (health / photos) | M |
| CSV import with mapper UI: upload → map → dry-run diff → apply → per-row errors | L |
| First vendor importer (pilot gym's system — OPEN_QUESTIONS #3) | M |
| Front Desk role surface: check-in list, contact info, restricted views proven by matrix tests | S |

**≈ 5–7 weeks.**

## Phase 2 — Equipment, exercises, video

| Slice | Size |
| --- | --- |
| Equipment models + units, categories, zones, QR tag generation/printing | L |
| Unit status lifecycle + status history; member two-tap issue report; maintenance log | M |
| Platform exercise library seed (taxonomies, ~150 curated exercises + platform edges) | M |
| Gym exercise library: CRUD, fork-from-platform, contributor rights | M |
| Substitution graph: edges UI + the ranked substitution query (equipment-aware, limitation-aware) | L |
| Out-of-service trigger: affected-program surfacing + trainer notifications | M |
| Video pipeline: resumable upload → Stream → webhook → renditions/posters/captions | L |
| Approval workflow + talent releases + versioned replacement (video groups) | M |
| Storage quotas + usage dashboard | S |

**≈ 6–8 weeks.**

## Phase 3 — Programs

| Slice | Size |
| --- | --- |
| Program structure + versioning (draft → publish freeze) | L |
| Builder UI: blocks/weeks/days/items, set schemes, supersets/circuits/EMOM/AMRAP/intervals | XL |
| Load prescriptions (absolute / %max / RPE / bodyweight) + member maxes | M |
| Progression rules as data: platform defaults + gym-defined; applied on assignment advance | L |
| Equipment-aware authoring: only-performable exercises, OOS flags, authoring-time alternates | M |
| Templates (platform/gym/trainer) + copy/fork flows | M |
| Assignment (individual / group / whole gym) + member-facing program consumption UI | L |
| Gym-published free programs surface (the commercial hook — polish pass) | M |

**≈ 7–9 weeks.**

## Phase 4 — Offline workout logging (own hardening pass)

| Slice | Size |
| --- | --- |
| Local store (Dexie schema), device registry, op-log + fold in `packages/sync` (shared, property-tested) | L |
| Sync engine: outbox push (idempotent batches), pull cursors, conflict matrix implemented + tested | XL |
| Service worker caching tiers: shell precache, program/library caching, video opt-in downloads | L |
| Active workout UI: one-hand logging, large targets, smart defaults from last performance | XL |
| Rest timer (background notification), plate calculator, warm-up auto-calc | M |
| Quick log; QR scan → machine page → demo + start log entry | M |
| Set notes, felt-difficulty; form video capture → media outbox → trainer review thread | M |
| Wake lock + capabilities adapter (web impls) | S |
| **Offline test plan + hardening pass**: airplane-mode E2E suite, kill-mid-set, two-device merge, storage-pressure, stale-shell | L |

**≈ 8–10 weeks.** Pilot gym starts living on this phase.

## Phase 5 — Scheduling

| Slice | Size |
| --- | --- |
| Trainer availability: recurring templates, exceptions, time-off | L |
| Session types + booking core: self-booking within availability + package balance, double-booking exclusion constraints | XL |
| Cancellation windows, late-cancel/no-show incidents + configurable fees (posting; collection per OPEN_QUESTIONS #10) | M |
| Waitlists with auto-promotion | M |
| Recurring standing appointments | M |
| Small-group / class scheduling: rosters, caps, check-in | L |
| Calendar sync: Google/Outlook two-way, ICS feeds | L |
| Reminders: push/email/SMS, per-gym templates, quiet hours | M |
| Rooms / dedicated-area reservation | S |
| Kiosk-lite check-in (wall tablet mode) | M |

**≈ 8–10 weeks.**

## Phase 6 — Money

| Slice | Size |
| --- | --- |
| Rate cards (effective-dated) + resolution + freeze-onto-booking | M |
| Packages + append-only ledger (purchase/redeem/expire/transfer) | L |
| Stripe Connect onboarding + member payments (packages, fees) | XL |
| Membership dues module (optional, flag-gated) | L |
| Comp plans (hourly / per-session / split / salary+commission) + frozen line items | L |
| Payroll periods + exportable reports | M |
| Money audit trail surfacing (admin-visible history on every rate/package/session-count change) | S |

**≈ 7–9 weeks.** Gate: OPEN_QUESTIONS #1 (merchant of record) answered before Stripe Connect work starts.

## Phase 7 — Matching, messaging, member analytics

| Slice | Size |
| --- | --- |
| Trainer matching: factor computation, tunable weights, explainable shortlist, outcome logging | L |
| Messaging: trainer↔member conversations, admin compliance visibility | L |
| Broadcast announcements + segments | M |
| Lifecycle automations (welcome, lapsed, package-low, birthday) on gym-editable templates | M |
| Member progress: e1RM trends, volume by muscle/pattern, streaks, PR celebrations | L |
| Body metrics + progress photos (encrypted store, side-by-side compare, grant-gated) | M |
| Adherence score vs assigned program | S |

**≈ 6–8 weeks.**

## Phase 8 — Gym-side BI

| Slice | Size |
| --- | --- |
| Rollup job framework + backfill | M |
| Owner/Admin dashboards: members, penetration, utilization, revenue, engagement | L |
| **Equipment usage heatmap** (floor-map overlay from set_log + QR scans) | M |
| Content performance (videos, programs) | S |
| Churn-risk flags (rule-based) + lapsed-member surfacing | M |
| Gym-group roll-up views (multi-location owners) | M |

**≈ 4–6 weeks.**

## Phase 9 — Marketing site, onboarding, platform admin

| Slice | Size |
| --- | --- |
| Marketing site: positioning pages, SEO/structured data, CWV budget, demo-request funnel | L |
| Gym onboarding wizard (branding → staff → import → equipment → first program) | L |
| Custom domains self-serve (SSL for SaaS automation) | M |
| Platform admin: tenant list, flags, health dashboard, support access grants + impersonation | L |
| Subscription billing to gyms (Stripe Billing, tiers, metering) | M |

**≈ 5–7 weeks.**

## Phase 10 — Native wrapper

| Slice | Size |
| --- | --- |
| Capacitor shell around `apps/app` build; deep links; splash/icons | M |
| Native capability adapters: push (APNs/FCM), camera, wake lock, secure storage | M |
| HealthKit / Google Fit through the capabilities adapter | L |
| Store listings, review-guideline pass (account deletion, IAP boundary check), submission | M |

**≈ 3–5 weeks + store review latency.**

## Cross-cutting, every phase

Accessibility (WCAG 2.2 AA) reviewed per slice, not retrofitted; error/empty/loading states designed per slice; DECISIONS.md entry per non-obvious call; migrations reviewed with rollback notes; feature flags for anything user-visible.
