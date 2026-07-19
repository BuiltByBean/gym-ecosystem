import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const sessionTypes = pgTable('session_types', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  name: text('name').notNull(),
  durationMin: integer('duration_min').notNull().default(60),
  capacity: integer('capacity').notNull().default(1),
  requiresPackage: boolean('requires_package').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const availabilityTemplates = pgTable('availability_templates', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  trainerUserId: uuid('trainer_user_id').notNull(),
  weekday: integer('weekday').notNull(),
  startMin: integer('start_min').notNull(),
  endMin: integer('end_min').notNull(),
  locationId: uuid('location_id'),
});

export const availabilityExceptions = pgTable('availability_exceptions', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  trainerUserId: uuid('trainer_user_id').notNull(),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['open', 'blocked', 'time_off'] }).notNull(),
  startMin: integer('start_min'),
  endMin: integer('end_min'),
  note: text('note'),
});

export type BookingStatus = 'booked' | 'completed' | 'cancelled' | 'late_cancelled' | 'no_show';

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  trainerUserId: uuid('trainer_user_id').notNull(),
  sessionTypeId: uuid('session_type_id').notNull(),
  locationId: uuid('location_id'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status', { enum: ['booked', 'completed', 'cancelled', 'late_cancelled', 'no_show'] })
    .notNull()
    .default('booked'),
  bookedBy: uuid('booked_by'),
  rateCardId: uuid('rate_card_id'),
  rateAppliedCents: integer('rate_applied_cents'),
  packagePurchaseId: uuid('package_purchase_id'),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  cancelledAt: ts('cancelled_at'),
});

export const bookingAttendees = pgTable('booking_attendees', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  bookingId: uuid('booking_id').notNull(),
  memberId: uuid('member_id').notNull(),
  status: text('status', { enum: ['booked', 'checked_in', 'no_show', 'cancelled'] })
    .notNull()
    .default('booked'),
  checkedInAt: ts('checked_in_at'),
});

export const policyIncidents = pgTable('policy_incidents', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  bookingId: uuid('booking_id').notNull(),
  memberId: uuid('member_id').notNull(),
  kind: text('kind', { enum: ['late_cancel', 'no_show'] }).notNull(),
  feeCents: integer('fee_cents').notNull().default(0),
  status: text('status', { enum: ['posted', 'waived', 'collected'] }).notNull().default('posted'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedBy: uuid('resolved_by'),
});

export const checkins = pgTable('checkins', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  source: text('source', { enum: ['kiosk', 'front_desk', 'qr', 'app'] }).notNull().default('front_desk'),
  byUserId: uuid('by_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type RateScope = 'session_type' | 'trainer' | 'trainer_session_type';

export const rateCards = pgTable('rate_cards', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  scope: text('scope', { enum: ['session_type', 'trainer', 'trainer_session_type'] }).notNull(),
  sessionTypeId: uuid('session_type_id'),
  trainerUserId: uuid('trainer_user_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  effectiveAt: ts('effective_at').notNull().defaultNow(),
  supersededAt: ts('superseded_at'),
  createdBy: uuid('created_by'),
  reason: text('reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  name: text('name').notNull(),
  sessionTypeIds: uuid('session_type_ids').array().notNull().default([]),
  quantity: integer('quantity').notNull(),
  priceCents: integer('price_cents').notNull(),
  expiresDays: integer('expires_days'),
  transferable: boolean('transferable').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  purpose: text('purpose', { enum: ['package', 'fee'] }).notNull(),
  provider: text('provider', { enum: ['dev', 'stripe'] }).notNull().default('dev'),
  providerRef: text('provider_ref'),
  status: text('status', { enum: ['paid', 'refunded', 'failed'] }).notNull().default('paid'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const packagePurchases = pgTable('package_purchases', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  packageId: uuid('package_id').notNull(),
  memberId: uuid('member_id').notNull(),
  pricePaidCents: integer('price_paid_cents').notNull(),
  paymentId: uuid('payment_id'),
  purchasedAt: ts('purchased_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});

export type LedgerKind =
  | 'purchase'
  | 'redemption'
  | 'redemption_reversal'
  | 'expiry'
  | 'refund'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment';

export const packageLedger = pgTable('package_ledger', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  purchaseId: uuid('purchase_id').notNull(),
  memberId: uuid('member_id').notNull(),
  delta: integer('delta').notNull(),
  kind: text('kind', {
    enum: ['purchase', 'redemption', 'redemption_reversal', 'expiry', 'refund', 'transfer_in', 'transfer_out', 'adjustment'],
  }).notNull(),
  bookingId: uuid('booking_id'),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
