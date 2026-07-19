import { pgTable, uuid, text, boolean, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export interface GymSettings {
  adminFinancials?: boolean;
  genderPrefEnabled?: boolean;
  minorAge?: number;
  cancellationWindowHours?: number;
  lateCancelFeeCents?: number;
  noShowFeeCents?: number;
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('en'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  activeGymId: uuid('active_gym_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});

export const gyms = pgTable('gyms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  currency: text('currency').notNull().default('USD'),
  units: text('units', { enum: ['lb', 'kg'] }).notNull().default('lb'),
  brandPrimary: text('brand_primary').notNull().default('#C8472B'),
  brandAccent: text('brand_accent').notNull().default('#1A1A1A'),
  logoMediaId: uuid('logo_media_id'),
  settings: jsonb('settings').$type<GymSettings>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const gymLocations = pgTable('gym_locations', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  hours: jsonb('hours').$type<Record<string, string>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tenantDomains = pgTable('tenant_domains', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  hostname: text('hostname').notNull(),
  kind: text('kind', { enum: ['subdomain', 'custom'] }).notNull().default('subdomain'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type StaffRole = 'owner' | 'admin' | 'front_desk' | 'trainer';

export const gymStaff = pgTable('gym_staff', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'front_desk', 'trainer'] }).notNull(),
  employmentType: text('employment_type', { enum: ['employee', 'contractor'] }),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const trainerProfiles = pgTable('trainer_profiles', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  userId: uuid('user_id').notNull(),
  bio: text('bio'),
  specialties: text('specialties').array().notNull().default([]),
  languages: text('languages').array().notNull().default([]),
  certifications: jsonb('certifications').$type<{ name: string; issuer?: string }[]>().notNull().default([]),
  targetClientLoad: integer('target_client_load'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  email: text('email').notNull(),
  kind: text('kind', { enum: ['staff', 'member'] }).notNull(),
  role: text('role'),
  memberId: uuid('member_id'),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by'),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  reason: text('reason'),
  ip: text('ip'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
