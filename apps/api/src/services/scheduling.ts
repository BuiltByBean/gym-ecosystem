import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@gym/db';

/** date ("YYYY-MM-DD") + minutes-since-midnight in a timezone → UTC Date.
 *  Two-pass fixed-point via Intl; exact except during DST transitions, where it
 *  lands within the hour (acceptable for booking slots). */
export function utcFromGymLocal(dateStr: string, minutes: number, timeZone: string): Date {
  let guess = new Date(`${dateStr}T00:00:00Z`).getTime() + minutes * 60_000;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const targetAsUtc = new Date(`${dateStr}T00:00:00Z`).getTime() + minutes * 60_000;
    guess += targetAsUtc - localAsUtc;
  }
  return new Date(guess);
}

export function gymWeekday(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

export interface Slot {
  startsAt: string; // ISO
  endsAt: string;
}

/** Bookable slots for a trainer × session type over a date range (spec §4.9):
 *  weekly template, minus exceptions and existing bookings, on a 30-min grid. */
export async function computeSlots(
  tx: Tx,
  opts: {
    gymId: string;
    trainerUserId: string;
    durationMin: number;
    timeZone: string;
    fromDate: string; // YYYY-MM-DD
    days: number;
  },
): Promise<Slot[]> {
  const templates = await tx
    .select()
    .from(schema.availabilityTemplates)
    .where(
      and(
        eq(schema.availabilityTemplates.gymId, opts.gymId),
        eq(schema.availabilityTemplates.trainerUserId, opts.trainerUserId),
      ),
    );
  if (templates.length === 0) return [];

  const dates: string[] = [];
  const base = new Date(`${opts.fromDate}T12:00:00Z`);
  for (let i = 0; i < opts.days; i++) {
    dates.push(new Date(base.getTime() + i * 86400_000).toISOString().slice(0, 10));
  }

  const exceptions = await tx
    .select()
    .from(schema.availabilityExceptions)
    .where(
      and(
        eq(schema.availabilityExceptions.trainerUserId, opts.trainerUserId),
        inArray(schema.availabilityExceptions.date, dates),
      ),
    );

  const rangeStart = utcFromGymLocal(dates[0]!, 0, opts.timeZone).toISOString();
  const rangeEnd = utcFromGymLocal(dates[dates.length - 1]!, 1440, opts.timeZone).toISOString();
  const bookings = await tx
    .select({ startsAt: schema.bookings.startsAt, endsAt: schema.bookings.endsAt })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.trainerUserId, opts.trainerUserId),
        inArray(schema.bookings.status, ['booked', 'completed']),
        gte(schema.bookings.startsAt, rangeStart),
        lte(schema.bookings.startsAt, rangeEnd),
      ),
    );
  const busy = bookings.map((b) => ({ s: new Date(b.startsAt).getTime(), e: new Date(b.endsAt).getTime() }));

  const now = Date.now();
  const slots: Slot[] = [];
  for (const date of dates) {
    const weekday = gymWeekday(date);
    const dayEx = exceptions.filter((e) => e.date === date);
    if (dayEx.some((e) => e.kind === 'time_off' && e.startMin == null)) continue; // whole day off

    const windows: { start: number; end: number }[] = templates
      .filter((t) => t.weekday === weekday)
      .map((t) => ({ start: t.startMin, end: t.endMin }));
    for (const e of dayEx) {
      if (e.kind === 'open' && e.startMin != null && e.endMin != null) {
        windows.push({ start: e.startMin, end: e.endMin });
      }
    }
    const blocks = dayEx
      .filter((e) => (e.kind === 'blocked' || e.kind === 'time_off') && e.startMin != null && e.endMin != null)
      .map((e) => ({ start: e.startMin!, end: e.endMin! }));

    for (const w of windows) {
      for (let m = w.start; m + opts.durationMin <= w.end; m += 30) {
        const slotEndMin = m + opts.durationMin;
        if (blocks.some((b) => m < b.end && slotEndMin > b.start)) continue;
        const s = utcFromGymLocal(date, m, opts.timeZone);
        const e = utcFromGymLocal(date, slotEndMin, opts.timeZone);
        if (s.getTime() <= now) continue;
        if (busy.some((b) => s.getTime() < b.e && e.getTime() > b.s)) continue;
        slots.push({ startsAt: s.toISOString(), endsAt: e.toISOString() });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Most-specific effective rate at a moment (docs/DATA_MODEL.md §12):
 *  trainer+session_type > trainer > session_type. */
export async function resolveRate(
  tx: Tx,
  opts: { gymId: string; trainerUserId: string; sessionTypeId: string; at: string },
): Promise<{ rateCardId: string; amountCents: number } | null> {
  const cards = await tx
    .select()
    .from(schema.rateCards)
    .where(
      and(
        eq(schema.rateCards.gymId, opts.gymId),
        lte(schema.rateCards.effectiveAt, opts.at),
        or(isNull(schema.rateCards.supersededAt), sql`${schema.rateCards.supersededAt} > ${opts.at}`),
        or(
          and(
            eq(schema.rateCards.scope, 'trainer_session_type'),
            eq(schema.rateCards.trainerUserId, opts.trainerUserId),
            eq(schema.rateCards.sessionTypeId, opts.sessionTypeId),
          ),
          and(eq(schema.rateCards.scope, 'trainer'), eq(schema.rateCards.trainerUserId, opts.trainerUserId)),
          and(eq(schema.rateCards.scope, 'session_type'), eq(schema.rateCards.sessionTypeId, opts.sessionTypeId)),
        ),
      ),
    );
  if (cards.length === 0) return null;
  const specificity: Record<schema.RateScope, number> = { trainer_session_type: 0, trainer: 1, session_type: 2 };
  cards.sort(
    (a, b) =>
      specificity[a.scope] - specificity[b.scope] || b.effectiveAt.localeCompare(a.effectiveAt),
  );
  const best = cards[0]!;
  return { rateCardId: best.id, amountCents: best.amountCents };
}

/** Package purchase with remaining balance valid for a session type. */
export async function findRedeemablePurchase(
  tx: Tx,
  opts: { memberId: string; sessionTypeId: string },
): Promise<{ purchaseId: string; remaining: number } | null> {
  const rows = await tx.execute(sql`
    SELECT pp.id, pp.expires_at, p.session_type_ids,
           coalesce((SELECT sum(delta) FROM package_ledger pl WHERE pl.purchase_id = pp.id), 0)::int AS balance
    FROM package_purchases pp
    JOIN packages p ON p.id = pp.package_id
    WHERE pp.member_id = ${opts.memberId}
      AND (pp.expires_at IS NULL OR pp.expires_at > now())
    ORDER BY pp.expires_at NULLS LAST, pp.purchased_at
  `);
  for (const r of rows.rows as Array<{ id: string; session_type_ids: string[]; balance: number }>) {
    if (r.balance <= 0) continue;
    if (r.session_type_ids.length > 0 && !r.session_type_ids.includes(opts.sessionTypeId)) continue;
    return { purchaseId: r.id, remaining: r.balance };
  }
  return null;
}
