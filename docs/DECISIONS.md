# Decision Log

One entry per non-obvious choice: what we chose, the alternative rejected, why, and when to revisit. Referenced from the other docs as D-NNN. Seeded 2026-07-19 alongside the architecture drafts; all entries are provisional until the docs are approved.

---

**D-001 — Product app is a Vite SPA; Next.js rejected for the app shell.**
Rejected: Next.js App Router for all surfaces (the spec's default suggestion). Why: full-offline boot and a Capacitor wrap require a fully precacheable static bundle; App Router can't deliver that without giving up the features that justify it. Marketing gets Astro; SEO never touches the app. Revisit if: an SSR'd authenticated surface becomes necessary (none identified).

**D-002 — Purpose-built append-only sync engine; sync platforms rejected.**
Rejected: Replicache / PowerSync / ElectricSQL. Why: offline writes are confined to one small append-only domain (active workout); a general sync platform imports whole-schema conflict semantics and licensing for a problem we can solve in ~1k audited lines with shared fold code. Revisit if: offline writes expand beyond logging + media capture (e.g., offline booking).

**D-003 — Cross-tenant probes return 404, not 403.**
Rejected: 403 Forbidden. Why: 403 confirms the resource exists in another tenant — an information leak. Not-found and not-yours are indistinguishable by design. Applies to every tenant resource; encoded in the isolation test harness.

**D-004 — Platform and gym content share tables via nullable `gym_id`.**
Rejected: separate `platform_exercises` / `gym_exercises` tables. Why: the substitution graph, program items, and search must span both layers; two tables double every join and FK. Partial unique indexes + RLS read policy (`gym_id = ctx OR gym_id IS NULL`) keep isolation intact. Revisit if: platform-content write paths get complex enough to want physical separation.

**D-005 — Graph stores two edge kinds; the other two are derived.**
Rejected: storing all four spec'd relationship types. Why: `regression_of` is `progression_of` read backwards (storing both invites inverse-pair drift); `same_movement_pattern` is derivable from the taxonomy column (storing it is n² rows that go stale). The spec's four semantics survive; the storage doesn't.

**D-006 — Equipment split into `equipment_models` + `equipment_units`.**
Rejected: single item-with-quantity table (spec §4.3's literal shape). Why: QR tags, status, and maintenance are per physical unit; a quantity column can't say *which* leg press is broken. Quantity becomes a count. Spec inconsistency logged as OPEN_QUESTIONS #9.

**D-007 — Program versions freeze on publish; assignments and sessions pin a version.**
Rejected: mutable programs with edits propagating to assignees. Why: offline devices mid-workout and members mid-week must never have the ground shift under them; pinning makes trainer edits land at the next session start deterministically and keeps history auditable.

**D-008 — Rates resolve at booking time and are frozen onto the booking.**
Rejected: joining bookings to the current rate card at read time. Why: a raise must not rewrite history (spec §4.11); effective-dated cards answer "what was the rate then," and the frozen copy makes every past booking self-contained for payroll and disputes. Same pattern for comp plans.

**D-009 — Package balances are ledger sums, not counters.**
Rejected: `sessions_remaining` counter column. Why: counters lose the story (who redeemed, when expired, what was refunded) and drift under concurrent writes; an append-only ledger gives the spec's audit trail for free and makes transfer/expiry corrections reversible entries.

**D-010 — Graphile Worker on Postgres; Redis/BullMQ rejected.**
Why: transactional enqueue (job committed iff the row change committed) removes lost-job bugs; one less system for a small team to run. Revisit if: job throughput or scheduled-job fan-out outgrows Postgres comfortably.

**D-011 — Better Auth over Clerk and Auth.js.**
Why: gym↔role membership is the heart of the permission matrix and must live in our Postgres and be testable offline-of-vendor; Clerk's multi-domain multi-tenant pricing and lock-in, Auth.js's DIY org/MFA burden. Risk (younger project) contained behind our own session module. Revisit if: Better Auth stalls or an enterprise SSO requirement (SAML) lands.

**D-012 — Cloudflare Stream over Mux for video.**
Why: storage-heavy/view-light workload (hundreds of demo videos per gym, modest views) favors Stream's pricing; tus resumable uploads and generated captions included; coherent with R2 + SSL-for-SaaS edge. Mux remains the named fallback if caption quality or reliability disappoints in Phase 2.

---

**D-013 — First-party session auth for v1; Better Auth deferred.**
Rejected (for now): adopting Better Auth during the v1 build. Why: ~200 lines of scrypt + DB-session code we fully control beat integrating a fast-moving auth framework against our unusual members-without-logins model under build-time constraints. The boundary D-011 demanded (everything behind `apps/api/src/auth/`) is exactly what makes the swap cheap later. Revisit when: MFA/passkeys/SSO land on the roadmap.

**D-014 — npm workspaces + embedded Postgres for dev.**
Rejected: pnpm/Turborepo (not installed on the target machine; npm 11 does the job) and Docker (not installed). `embedded-postgres` boots a real PG 18 for dev and tests — RLS behavior is identical, `npm run dev` needs zero system setup. CI uses a service container. Databases are created `ENCODING UTF8 TEMPLATE template0` explicitly because Windows initdb defaults to a legacy encoding.

**D-015 — Local-disk media adapter first.**
The media interface (`apps/api/src/media.ts`) is the contract from ARCHITECTURE §7; dev stores MP4s on disk with Range-request streaming. Stream/R2 drop in behind it with credentials — approval workflow, versioned video groups, and permissions are already real.

**D-016 — Dev payment provider behind real money math.**
Ledger, rate freezing, redemption, and incidents are fully real; only the charge is simulated (`provider='dev'`). Stripe Connect lands once OPEN_QUESTIONS #1 (merchant of record) is answered — the payments table already carries provider/provider_ref.

**D-017 — Charts never wear the gym's brand color.**
Data marks use a fixed, CVD-validated palette (see `apps/web/src/components/charts.tsx`); brand stays on interface accents. A gym can pick any brand hue without breaking chart legibility or series identity — validated with the palette checker rather than eyeballed.
