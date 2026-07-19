# Data Model

Status: **draft for review**. Table-level design; column lists show identity, keys, and the fields that drive behavior — routine columns (timestamps, denormalized names) are omitted for brevity. Every table below gets a versioned migration; none exist yet.

## 1. Conventions

- **Primary keys**: UUIDv7 (time-ordered, index-friendly). Client-generated ULIDs only for offline op ids.
- **Tenancy**: tenant-owned tables carry `gym_id uuid not null references gyms`, included in every unique constraint and leading every hot index. RLS enabled + forced (see ARCHITECTURE §4). §12 lists the exceptions.
- **Money**: integer cents + `currency` (one currency per gym, set at onboarding). Never floats.
- **Time**: `timestamptz` everywhere (UTC). Each gym has a `timezone`; gym-facing stats bucket in gym time, member streaks in member device time (OPEN_QUESTIONS #13).
- **Soft delete** only where the domain needs restore-ability (members, exercises, programs) via `archived_at`; legal/financial tables are append-only instead — corrections are new rows, never edits.
- **Sensitive columns** (marked 🔒) are envelope-encrypted app-side and readable only through audited accessors.
- **History pattern**: anything with "the rate at the time mattered" uses effective-dated rows + a frozen copy on the transaction row. No `UPDATE` ever rewrites history.

## 2. Identity, tenancy, roles

| Table | Purpose / key fields |
| --- | --- |
| `users` | global human account: email (citext unique), password hash or passkey/oauth identities, TOTP secret 🔒, locale. A human has one `users` row across all gyms |
| `gym_groups` | umbrella for multi-location owners: name, owner refs. Not a tenant — reporting + staff-sharing scope |
| `gyms` | the tenant: name, `group_id?`, timezone, currency, branding (logo asset, primary/accent color), policies (cancellation window, fees), settings jsonb (financial-visibility-for-admins, gender-preference-enabled, minor threshold) |
| `gym_locations` | per-gym physical sites: address, operating hours jsonb, holiday closures |
| `tenant_domains` | hostname → gym: `hostname` (global unique), kind (subdomain\|custom), tls_status |
| `gym_staff` | user ↔ gym role assignment: `user_id`, `gym_id`, role enum (`owner\|admin\|front_desk\|trainer`), `employment_type` (`employee\|contractor`) for trainers, status, per-location scoping jsonb. Unique `(gym_id, user_id, role)` |
| `trainer_profiles` | trainer extras: bio, photo, specialties[], languages[], gender (for member preference matching where enabled), target client load, contributor rights flag |
| `certifications` | trainer certifications: issuer, name, expiry, verification status |
| `support_access_grants` | platform-admin cross-tenant access: admin user, gym, stated reason, expires_at, revoked_at |
| `audit_events` | append-only: `gym_id?` (null for platform events), actor, action, resource type+id, reason?, ip, metadata jsonb. Sensitive reads land here too |

Membership in a gym as a **member** is `members` (below), not `gym_staff` — a member profile can exist without a login (imports, prospects): `members.user_id` is nullable, with an invite/claim flow. One user can be staff at gym A and member at gym B.

## 3. Members

| Table | Purpose / key fields |
| --- | --- |
| `members` | gym-scoped person: `user_id?`, status (`prospect\|active\|frozen\|inactive\|cancelled`), contact info, DOB, join date, membership type ref, preferred training times jsonb, preferred trainer traits jsonb, guardian contact for minors |
| `membership_types` | gym-defined labels (and dues linkage if the dues module is on) |
| `emergency_contacts` | per member |
| `member_goals` | structured goals: kind, target, notes, status |
| `member_limitations` 🔒 | injuries/limitations: description, affected movement patterns[] / excluded exercises[] — feeds the substitution engine |
| `health_screening_templates` | versioned PAR-Q templates: schema jsonb, version, active flag |
| `health_screenings` 🔒 | responses: template version ref, answers jsonb 🔒, flags requiring clearance |
| `waiver_templates` | versioned legal docs: body, version, active |
| `waiver_signatures` | append-only: template version ref, rendered-doc sha256, pdf object key, signed_at, ip, user agent, signer (member or guardian + relationship) |
| `member_trainer_grants` | member-controlled access: trainer ref, scope (`health\|progress_photos`), granted/revoked timestamps. Default row created for assigned trainer |
| `trainer_assignments` | member ↔ trainer relationship over time: started/ended, source (match, manual) |
| `import_jobs` | batch imports: source (`csv\|abc\|mindbody\|club_automation\|glofox`), status, counts, dry-run flag |
| `import_mappings` | saved per gym+source column mappings (the mapper UI's artifact) |
| `import_rows` | raw row jsonb, mapped result, per-row status + errors |

## 4. Equipment

Spec §4.3 says items have a *quantity* and also per-item QR tags and maintenance — those conflict at one table. Split (DECISIONS D-006):

| Table | Purpose / key fields |
| --- | --- |
| `equipment_models` | gym's catalog entry: name, category ref, manufacturer, model, photos[], notes. "Quantity" = count of units |
| `equipment_units` | each physical unit: model ref, serial?, `tag_code` (QR/NFC, unique per gym), zone ref, status (`in_service\|maintenance\|out_of_service\|retired`), purchase/service dates |
| `equipment_categories` | per-gym taxonomy (seeded from platform defaults) |
| `gym_zones` | named areas / floor-map pins per location |
| `equipment_status_history` | append-only unit status changes: who, why |
| `maintenance_reports` | issue reports: unit ref, reporter (member two-tap or staff), description, photos[], status, resolution |
| `equipment_exercise_links` | equipment model ↔ exercise capability (which exercises this machine performs) |
| `equipment_classes` | **platform-level** abstract classes ("cable stack", "flat bench", "barbell+rack") — what platform exercises *require*; gym models declare which classes they satisfy |

Exercise availability at a gym = an in-service unit exists for some model linked to the exercise (or satisfying its class). Last in-service unit going down triggers the substitute-surfacing + trainer-notification job.

## 5. Exercise library — the graph

Two layers in **one table**: platform rows have `gym_id IS NULL`, gym rows carry their `gym_id` (partial unique indexes per layer; RLS read policy exposes both).

| Table | Purpose / key fields |
| --- | --- |
| `exercises` | name, `gym_id?`, movement_pattern ref, difficulty (1–5), equipment_class ref?, coaching cues[], demo video group ref?, `forked_from?` (gym copy of a platform exercise), archived_at |
| `movement_patterns` | platform taxonomy: hinge, squat, lunge, horizontal/vertical push/pull, carry, rotation, … |
| `muscles` | platform taxonomy |
| `exercise_muscles` | exercise ↔ muscle with role (`primary\|secondary`) |
| `exercise_relationships` | **the graph's edges** — see below |

### Edge model

```
exercise_relationships (
  id, gym_id?,                -- null = platform-curated edge; gym rows are gym-local curation
  from_exercise_id, to_exercise_id,
  kind         enum: substitutes_for | progression_of,
  rank         int,           -- ordering among a node's outgoing edges of one kind
  reason       text,          -- plain language: "same hinge pattern, no spinal load"
  created_by, created_at,
  unique (gym_id, from_exercise_id, to_exercise_id, kind)
)
```

Decisions that make the graph cheap instead of painful (DECISIONS D-005):

- **`regression_of` is not stored** — it is `progression_of` read backwards. One directed edge kind, queried both ways; no inverse-pair consistency to maintain.
- **`same_movement_pattern` is not stored as edges** — it is derived from `exercises.movement_pattern_id` (n² edge rows avoided; taxonomy stays authoritative).
- `substitutes_for` is directed with `rank` + `reason`; platform edges ship curated, gyms add their own on top.

### Substitution query (the one mechanism for "machine is taken" and "I can't do that movement")

Inputs: exercise, gym, member. Recursive CTE over `substitutes_for` (depth ≤ 2) unioned with same-movement-pattern candidates, then filtered and ranked **in SQL**:

1. exclude exercises the member's `member_limitations` flag;
2. require availability now (join to in-service `equipment_units` via links/classes; bodyweight always available);
3. preserve movement pattern unless the caller relaxes it;
4. rank by (edge kind: direct substitute > pattern-mate, edge rank, difficulty distance, currently-free heuristic later);
5. return each with a composed plain-language reason (edge `reason`, else pattern template).

Same query serves the program builder (authoring-time alternates), the OOS notification job, and the mid-workout "machine is taken" button — cached client-side for offline (ARCHITECTURE §6.7).

## 6. Media

| Table | Purpose / key fields |
| --- | --- |
| `video_groups` | stable identity programs/exercises point at: gym, kind (`exercise_demo\|form_check\|other`), current published version ref |
| `videos` | one version: group ref, version n, uploader, provider asset id, status (`draft\|processing\|pending_review\|published\|retired`), duration, renditions jsonb, captions VTT object key, slow-mo/loop variant refs |
| `talent_releases` | signed media release: person (staff user), template version, signature artifact (same fields as waivers), revoked_at |
| `video_release_links` | video version ↔ release for each person appearing |
| `media_assets` | non-video objects in R2: kind (photo, waiver pdf, export, caption), object key, size, owner refs |
| `storage_usage` | per-gym rollups: bytes by kind, stream minutes — quota enforcement + admin dashboard |

## 7. Programs and workout builder

| Table | Purpose / key fields |
| --- | --- |
| `programs` | identity + ownership: `gym_id?` (null = platform template), `owner_trainer_id?` (null = gym-owned), name, goal tags, status, current published version ref |
| `program_versions` | **immutable once published**: version n, published_at/by. Drafts are mutable until publish; publishing freezes (DECISIONS D-007) |
| `program_blocks` / `program_weeks` / `program_days` | structure under a version; days carry name + focus |
| `program_day_items` | one exercise slot: exercise ref, order, `group_id` + group kind (`straight\|superset\|circuit\|emom\|amrap\|interval`), sets, reps scheme, **load prescription** jsonb (typed union: absolute \| %-of-max ref \| RPE \| bodyweight), tempo, rest seconds, RPE/RIR target, notes, progression_rule ref? |
| `program_item_alternates` | authoring-time alternates: item ref, exercise ref, rank, reason — resolved at execution |
| `progression_rules` | **rules as data**: `gym_id?`, name, kind (`linear\|double\|percent_wave\|autoregulated`), params jsonb, description. Platform ships defaults; gyms define their own |
| `member_maxes` | tested/estimated maxes powering %-based loads: exercise ref, value, kind (tested\|e1rm), measured_at |
| `program_assignments` | assignment: program **version** ref (pin), assignee (member \| group \| whole gym), assigned_by, starts_at, status, video-download opt-in flag |
| `assignment_progress` | per member × assignment: current week/day pointer, completion stats (denormalized for the member home screen) |

Free gym-published programs = `programs` with a `published_to_members` flag; assignment row per opt-in member.

## 8. Workout logging (offline domain)

Server-side shape of the sync design (ARCHITECTURE §6):

| Table | Purpose / key fields |
| --- | --- |
| `workout_sessions` | member, source (`assigned\|quick_log`), `program_version_id?` + day ref?, started/ended, device id, status + LWW field HLC stamps, felt-difficulty |
| `set_log` | **append-only op log**, PK = client ULID `op_id`: session ref, kind (`set_logged\|set_amended\|set_voided\|substitution`), `amends?`, exercise ref, program_item ref?, set_no, payload jsonb (weight, reps, rpe, is_warmup, note), actor user, device id, client_seq, client_ts, hlc, server_received_at. Upsert `ON CONFLICT (op_id) DO NOTHING` |
| `sync_devices` | device registry: member/user, device_id, last push cursor, last seen, app shell version |
| `form_review_requests` | set-linked capture: `set_log` op ref, video group ref, status, trainer feedback thread (messages ref) |
| `equipment_scans` | QR scan events: unit ref, member, ts — gives the heatmap per-unit precision beyond exercise-level inference |
| `personal_records` | derived-but-stored (celebration + audit): member, exercise, kind (1RM\|rep-max\|volume), value, achieved via set_log op ref |

Current view of a workout = fold(`set_log` ops) via the shared `packages/sync` fold — server never edits folded state directly.

## 9. Progress and analytics (member)

| Table | Purpose / key fields |
| --- | --- |
| `body_metrics` | weight, circumferences jsonb, body-fat, measured_at, source |
| `progress_photos` 🔒 | private object key (R2), pose tag, taken_at, consent record ref; access via `member_trainer_grants` only |
| `e1rm_snapshots` | nightly derived per member × exercise (trend charts without live computation) |
| `adherence_scores` | derived per member × assignment × week |
| `member_streaks` | current/best streak, computed in member-local time |

## 10. Scheduling and booking

| Table | Purpose / key fields |
| --- | --- |
| `session_types` | gym-defined: name, duration, capacity (1 = PT, >1 = small group/class), price ref via rate cards, location constraints |
| `availability_templates` | trainer recurring weekly template: weekday, start/end, location |
| `availability_exceptions` | one-off blocks + time-off (kind: `open\|blocked\|time_off`) |
| `bookings` | session instance: trainer, session type, location, room?, starts/ends, status (`booked\|completed\|late_cancelled\|no_show\|cancelled`), **frozen** `rate_applied_cents` + `rate_card_id`, package redemption ref?, recurring series ref? |
| `booking_attendees` | member per booking (group rosters), attendance status, check-in ts |
| `recurring_series` | standing appointments: RRULE, horizon, exceptions |
| `waitlist_entries` | session-type/class instance ref, member, position, auto-promotion status, notified_at |
| `rooms` | dedicated training areas per location; bookings reserve them; equipment reservation via zone/unit hold if a gym needs it |
| `policy_incidents` | late-cancel / no-show events: booking ref, fee assessed, fee status (`waived\|posted\|collected`) — collection path per OPEN_QUESTIONS #10 |
| `checkins` | gym check-in events (kiosk, front desk, QR), member, ts, source |
| `calendar_accounts` | trainer OAuth (Google/Outlook) tokens 🔒, sync state |
| `calendar_event_links` | booking ↔ external event id + etag (two-way sync bookkeeping) |
| `ics_feed_tokens` | read-only ICS feed secrets per user |

Double-booking prevention = exclusion constraint on (trainer, tstzrange) across locations; same mechanism for rooms.

## 11. Matching

| Table | Purpose / key fields |
| --- | --- |
| `match_requests` | member request: goals, availability jsonb, preferences (language, gender where enabled), status |
| `match_recommendations` | scored shortlist snapshot: request ref, trainer, total score, **per-factor breakdown jsonb** (score + human-readable line each), weights-version used |
| `match_weights` | per-gym tunable factor weights, effective-dated; platform defaults |
| `match_outcomes` | recommendation shown vs admin's actual assignment — the eval log |

Factors (schedule overlap, load vs target, specialty/cert match, clientele similarity, language, historical retention with similar clients, stated preferences) are computed from existing tables; no ML tables in v1 by spec.

## 12. Rates, packages, money

### Rate cards — versioning model (explicit, per spec §8)

```
rate_cards (
  id, gym_id,
  scope        enum: session_type | trainer_level | trainer | trainer_session_type,
  session_type_id?, trainer_level_id?, trainer_id?,   -- per scope
  amount_cents, currency,
  effective_at timestamptz not null,
  superseded_at timestamptz,      -- null = current; set when a newer card replaces it
  created_by, reason
)
```

- Rows are **never updated** (beyond closing `superseded_at`) and never deleted. A raise = new row; history intact.
- Resolution at booking time: most specific matching scope wins (trainer+session_type > trainer > trainer_level > session_type), among those the row where `effective_at <= booked_for < coalesce(superseded_at, 'infinity')`.
- The resolved rate is **frozen onto the booking** (`rate_applied_cents`, `rate_card_id`). Later card changes cannot rewrite a past or already-booked session (DECISIONS D-008). Same effective-dating pattern for `comp_plans` and `match_weights`.

| Table | Purpose / key fields |
| --- | --- |
| `trainer_levels` | gym-defined tiers for tiered rates |
| `packages` | definition: name, session type(s), quantity, price, expiry rule, transferability flag |
| `package_purchases` | member purchase: package ref, price paid, purchased/expires_at, payment ref |
| `package_ledger` | **append-only** credit/debit entries: purchase +N, redemption −1 (booking ref), expiry, refund, transfer (paired ± rows). Balance = SUM, non-negative enforced; no mutable counter (DECISIONS D-009) |
| `payments` | Stripe refs only: intent/charge id, amount, status, payer, purpose (package \| dues \| fee) |
| `membership_dues` (+ `dues_schedules`) | **optional module**, off by default — many gyms keep dues in their existing system |
| `comp_plans` | trainer compensation config: kind (`hourly\|per_session\|percent_split\|salary_commission`), params by session type and package-vs-drop-in, effective-dated like rate cards |
| `comp_line_items` | generated per completed session at completion time, **frozen**: booking ref, plan ref, amount. Adjustments = signed correction rows |
| `payroll_periods` / `payroll_reports` | period aggregation of line items, exportable CSV; report row immutable once finalized |

Every write in this domain also lands in `audit_events` (full audit trail on rates, packages, session counts — spec §4.11).

## 13. Communication

| Table | Purpose / key fields |
| --- | --- |
| `conversations` | scoped trainer ↔ member (relationship-bound), admin-visible flag per compliance |
| `messages` | conversation ref, sender, body, attachments[], read receipts jsonb |
| `announcements` | gym → all or segment: body, segment definition jsonb, schedule |
| `message_templates` | gym-editable templates (lifecycle + reminders), locale-ready |
| `lifecycle_automations` | trigger (welcome, first workout, lapsed, package low, birthday), template ref, enabled, params |
| `notification_outbox` | every outbound push/email/SMS: recipient, channel, template + data, quiet-hours-deferred until, provider message id, delivery status |
| `push_subscriptions` | Web Push endpoint per device; later APNs/FCM tokens |
| `notification_preferences` | per user × category × channel opt-in/out |

## 14. BI, growth, platform

| Table | Purpose / key fields |
| --- | --- |
| `rollup_gym_daily` | active members, sessions, logged workouts, revenue, penetration rate |
| `rollup_equipment_daily` | per model/unit usage from `set_log` + `equipment_scans` — the heatmap |
| `rollup_trainer_daily` | utilization vs capacity, sessions, revenue |
| `rollup_content_daily` | video views, program starts/completions |
| `churn_risk_flags` | rule-based v1: member, rule hit, score, surfaced_at |
| `leads` | prospect pipeline: source, stage, owner (sales staff), notes, converted member ref |
| `referrals` | referrer member, referee, status, reward |
| `challenges` / `challenge_participants` | opt-in, privacy default; excluded for minors by default |
| `achievements` / `member_achievements` | consistency-tuned definitions (data, not code) |
| `nps_responses` / `session_feedback` | score + comment, linked to booking where applicable |
| `kiosk_devices` | registered kiosk: gym, location, device token, mode |
| `plans` / `gym_subscriptions` | platform tiers, Stripe Billing refs, feature entitlements |
| `feature_flags` / `gym_feature_overrides` | per-tenant flags gating phased rollout |
| `usage_meters` | per-gym metered usage (SMS, storage, members) for billing |
| `gym_onboarding_state` | wizard progress |

## 15. `gym_id` manifest

**Global (no `gym_id`)**: `users`, `gym_groups`, `gyms`, `tenant_domains`, `movement_patterns`, `muscles`, `equipment_classes`, `plans`, `feature_flags`, `support_access_grants`, `sync_devices` (user-scoped), `push_subscriptions`, `notification_preferences`, `ics_feed_tokens`, `calendar_accounts` (user-scoped; rows reference gyms via bookings only).

**Dual (nullable `gym_id`, null = platform layer)**: `exercises`, `exercise_relationships`, `programs` (+ their version trees), `progression_rules`, `health_screening_templates`, `waiver_templates`, `message_templates` (platform defaults), `audit_events` (null = platform event).

**Everything else carries `gym_id not null`** — all tables in §§3–14 not listed above. The cross-tenant test registry (ARCHITECTURE §4) is generated from this manifest; a new table missing from the manifest fails CI.

## 16. Deliberately derived (not stored)

- `regression_of` edges (reverse reads of `progression_of`), `same_movement_pattern` edges (from taxonomy) — §5.
- Package balances (ledger sums), workout current-state (op-log folds), e1RM/adherence/streaks (nightly derivations into snapshot tables), equipment "quantity" (count of units).
