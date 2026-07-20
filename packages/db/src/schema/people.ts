import { pgTable, uuid, text, jsonb, timestamp, integer, boolean, date, numeric } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export type MemberStatus = 'prospect' | 'active' | 'frozen' | 'inactive' | 'cancelled';

export const members = pgTable('members', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  userId: uuid('user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  status: text('status', { enum: ['prospect', 'active', 'frozen', 'inactive', 'cancelled'] })
    .notNull()
    .default('active'),
  membershipType: text('membership_type'),
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  joinedAt: date('joined_at', { mode: 'string' }),
  emergencyName: text('emergency_name'),
  emergencyPhone: text('emergency_phone'),
  goalsNote: text('goals_note'),
  preferredTimes: jsonb('preferred_times').$type<string[]>(),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const memberLimitations = pgTable('member_limitations', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  descriptionEnc: text('description_enc').notNull(),
  excludedPatternIds: uuid('excluded_pattern_ids').array().notNull().default([]),
  excludedExerciseIds: uuid('excluded_exercise_ids').array().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export interface ScreeningQuestion {
  key: string;
  text: string;
  flagOnYes: boolean;
}

export const memberHealthProfiles = pgTable('member_health_profiles', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  trainingExperience: text('training_experience', {
    enum: ['beginner', 'intermediate', 'advanced', 'athlete'],
  }),
  physicianClearance: boolean('physician_clearance').notNull().default(false),
  heightCm: numeric('height_cm'),
  medicalHistoryEnc: text('medical_history_enc'),
  medicationsEnc: text('medications_enc'),
  surgicalHistoryEnc: text('surgical_history_enc'),
  physicalLimitationsEnc: text('physical_limitations_enc'),
  updatedBy: uuid('updated_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const healthScreeningTemplates = pgTable('health_screening_templates', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  questions: jsonb('questions').$type<ScreeningQuestion[]>().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const healthScreenings = pgTable('health_screenings', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  templateId: uuid('template_id').notNull(),
  answersEnc: text('answers_enc').notNull(),
  flagged: boolean('flagged').notNull().default(false),
  signedAt: ts('signed_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const waiverTemplates = pgTable('waiver_templates', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  bodyMd: text('body_md').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const waiverSignatures = pgTable('waiver_signatures', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  templateId: uuid('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  docSha256: text('doc_sha256').notNull(),
  signedName: text('signed_name').notNull(),
  signerRelationship: text('signer_relationship').notNull().default('self'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  signedAt: ts('signed_at').notNull().defaultNow(),
});

export const memberTrainerGrants = pgTable('member_trainer_grants', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  trainerUserId: uuid('trainer_user_id').notNull(),
  scope: text('scope', { enum: ['health', 'progress_photos'] }).notNull(),
  grantedAt: ts('granted_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

export const trainerAssignments = pgTable('trainer_assignments', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  trainerUserId: uuid('trainer_user_id').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),
  source: text('source').notNull().default('manual'),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  filename: text('filename').notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  status: text('status', { enum: ['pending', 'dry_run', 'applied', 'failed'] })
    .notNull()
    .default('pending'),
  totals: jsonb('totals').$type<{ rows?: number; ok?: number; errors?: number; applied?: number }>()
    .notNull()
    .default({}),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const importRows = pgTable('import_rows', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  importJobId: uuid('import_job_id').notNull(),
  rowNo: integer('row_no').notNull(),
  raw: jsonb('raw').$type<Record<string, string>>().notNull(),
  mapped: jsonb('mapped').$type<Record<string, unknown>>(),
  status: text('status', { enum: ['ok', 'error', 'applied'] }).notNull().default('ok'),
  error: text('error'),
});
