# Open Questions and Spec Gaps

Status: **needs your answers/confirmation**. Items 1–6 are the spec's appendix questions with my recommended answers; 7–24 are places I found the spec underspecified or internally inconsistent, each with a recommended resolution. Numbering is stable — other docs reference it. **Bold-flagged** items block a phase.

## Appendix questions (recommendations)

**1. Membership billing and merchant of record** — *blocks Phase 6.* The spec makes dues optional but requires package sales and no-show fees, which still means charging members. Someone must be merchant of record. **Recommend**: Stripe Connect Standard — each gym is the merchant on its own Stripe account; we take an application fee; refund/chargeback liability stays with the gym; dues stay in the gym's existing system by default (dues module flag-gated). This is the lowest-liability posture for us and easiest to sell to gyms that already have merchant accounts. Decide before any Stripe Connect code.

**2. Tenant unit** — **Recommend**: the gym (single location) is the tenant; `gym_id` everywhere. Gym groups are an umbrella for roll-up reporting and shared staff, not a tenancy boundary. Launching with group-as-tenant would force per-location scoping onto every table later — the expensive direction. Multi-location owners get group dashboards in Phase 8.

**3. Pilot gym's current system** — *blocks a Phase 1 slice.* The mapper UI is vendor-agnostic, but the first vendor adapter should be the pilot's actual system. Need the vendor name and whether API access (sync) or export files (one-time) are available.

**4. Trainer compensation processing** — **Recommend**: calculate in-system, export to the gym's payroll (CSV per pay period). Actually *paying* trainers means money transmission, tax forms, and Connect payouts — real liability for marginal v1 value. Revisit once gyms ask for it; the `comp_line_items` model already supports a payout rail later.

**5. Platform pricing to gyms** — **Recommend**: flat tier per location with member-count bands (e.g., Starter/Growth/Pro), SMS and video storage metered. Per-trainer-seat pricing punishes the penetration metric we sell them on; per-member pricing punishes their growth. Not load-bearing until Phase 9 — but the answer shapes the marketing site.

**6. Trainer program portability on departure** — **Recommend**: the gym owns everything delivered through the gym (assignments, client history stay); trainer-owned *templates* are exportable by the trainer as a copy, scrubbed of client data and gym branding, controlled by a per-gym policy toggle (default: exportable). Written into gym T&Cs at onboarding. Deciding after a dispute is the worst case; this needs your sign-off, ideally with legal review of the T&C language.

## Inconsistencies found in the spec

**7. Admin visibility vs member-controlled grants.** §3 gives Admin "all trainer and member data," but members can "grant and revoke a trainer's access to their health metrics and progress photos." Do member grants bind Admins? **Recommend**: grants govern trainers only. Admin/Owner can read health *screening* data (operational duty of care — flagged conditions, emergency info), always audited; **progress photos are grant-only for everyone** — no operational justification for admin access. Front Desk sees neither, per spec.

**8. Offline video guarantee vs opt-in caching.** §4.7: "the entire active workout, including video, must be usable with no connection." §5.3: demo videos cached only "on explicit member opt-in per program." Both can't be unconditionally true. **Recommend**: opt-in wins (storage reality on member phones); assignment flow prompts for download; workout UI shows per-program download state; the §4.7 guarantee holds after opt-in download completes. Written into ARCHITECTURE §6.7.

**9. Equipment quantity vs per-unit identity.** §4.3 gives one item a *quantity* and also a QR tag, status, and maintenance log — but you tag, break, and repair individual units. **Resolved in DATA_MODEL §4**: `equipment_models` (catalog, quantity = count) + `equipment_units` (tag, status, maintenance). Flagging because it changes the QR-print and maintenance UX from the spec's wording.

**10. No-show fees need a way to collect.** §4.9 requires configurable late-cancel/no-show fees, but §4.11 makes member payment processing optional. A gym without platform payments has no card on file to charge. **Recommend**: fees post to a member ledger (`policy_incidents`); collection is configurable — auto-charge if platform payments enabled and card on file, otherwise surfaced for front-desk collection / export. Fee ≠ collection.

**11. Trainers logging on behalf of members.** The PWA is "primary surface for trainers on the gym floor," but no requirement says what they do there. During PT sessions, trainers logging the member's sets is the natural workflow. **Recommend**: trainers can run/log a client's workout from their own device; ops carry actor attribution (the sync model already merges this cleanly — ARCHITECTURE §6.5). Confirm this is in scope for Phase 4, since it shapes the floor UI.

**12. QR scan → "that machine's demo video."** A machine (cable stack) can perform a dozen exercises with different videos. **Recommend**: scan opens the machine page listing its exercises — ordered by (in the member's active program today, then recently performed, then popular) — one tap to video + log. Two taps worst case.

**13. Timezones.** Members travel; gyms have one location timezone; offline logs arrive late. **Recommend**: store UTC everywhere; gym-facing stats bucket in gym timezone; member streaks/adherence bucket in member device timezone captured per session. Cheap now, migration-grade pain later.

**14. SMS cost ownership.** Reminder SMS at gym scale is a real recurring cost. **Recommend**: metered per gym with a plan allowance, visible in the admin dashboard; email/push unmetered. Affects plan design (#5).

**15. Data residency / GDPR scope.** GDPR compliance is required, but hosting region and EU-customer intent are unstated. **Recommend**: single US region v1, GDPR-compliant processes (export/deletion/consent) regardless; EU residency becomes an infra fork only when an EU gym signs. Confirm no EU pilot is imminent.

**16. Minors.** Parental consent required, but no age threshold (varies by jurisdiction), and messaging limits are unstated. **Recommend**: per-gym configurable threshold (default 18); guardian signs waivers/screenings; leaderboards/challenges default-off (spec) **and** trainer↔minor messaging visible to guardian on request + always admin-auditable. Needs your comfort check.

**17. Members without logins.** Bulk import and prospect pipeline imply thousands of people who never open the app. **Resolved in DATA_MODEL §2/§3**: `members.user_id` nullable + invite/claim flow. Flagging because it means "member" ≠ "app user" in every metric — engagement rates must define their denominator (see #20).

**18. Are free gym-published programs public?** They're "the commercial hook," but all member content is behind login. **Recommend**: member-only in v1; a per-program "public preview page" flag in Phase 9 as a marketing feature (SEO for the gym). Confirm.

**19. Retention exception list.** Deletion-with-exceptions is required; the list isn't defined. **Proposed**: signed waivers/releases (statutory limitation period), financial/audit records (7y), audit log (2y), de-identified aggregates retained. Needs legal review before Phase 1 ships deletion.

**20. "Active member" and penetration-rate definitions.** BI metrics need denominators. **Recommend**: active = membership status `active` (roster truth); *engaged* = ≥1 check-in or logged workout in 30d; penetration = members with an active trainer assignment ÷ active members. Locking definitions now keeps dashboards honest across phases.

**21. Contractors working at multiple gyms.** One human can train at two gyms, but each gym's availability is private to it — double-booking across *gyms* can't be prevented without leaking schedules. **Recommend**: v1 prevents double-booking within a gym (and its locations); cross-gym conflicts are the trainer's own responsibility, mitigated by their personal calendar sync (busy-time overlay visible only to them). State this limitation openly.

**22. Talent-release revocation blast radius.** Revocation must unpublish videos — which may be mid-program in active assignments. **Recommend**: revocation → immediate unpublish → affected program items fall back to platform/alternate video or text cues → owning trainers/admins notified with a re-record task list. Accept the content gap rather than any "grace period" on a revoked release.

**23. Package expiry and refunds.** Expiration exists; proration/refund/extension rules don't. **Recommend**: expiry job debits remaining sessions (ledger entry, reversible); admins can extend or restore with a reason (audited); refunds are admin-initiated through Stripe at gym discretion, ledger-recorded. No self-serve refunds v1.

**24. Waitlist auto-promotion mechanics.** Auto-promotion needs a claim window. **Recommend**: on an opening, notify #1 with a configurable claim window (default 2h, capped at time-until-session); unclaimed → next in line; inside final 2h before session, first-tap-wins among the whole list. Package balance is checked at claim, not at join.

## Noted, no decision needed now

- **i18n**: capture `locale` on users/gyms from day one; English-only UI v1 (matching factor uses language fields, not translated UI).
- **Search**: Postgres FTS for members/exercises; no search infra v1.
- **Achievement tuning** ("consistency over intensity"): achievements are data-defined (DATA_MODEL §14); concrete definitions land as content in Phase 7, reviewable then.
- **Kiosk auth**: device-registered kiosk tokens + member self-check-in by name/phone/QR with no PII beyond first name + last initial on screen; PIN optional per gym. Detailed in Phase 5 design.
- **Backup/DR targets**: proposing RPO ≤ 24h (nightly logical) / PITR for hot recovery, RTO ≤ 4h. Confirm in Phase 0.
