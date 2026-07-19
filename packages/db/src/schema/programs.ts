import { pgTable, uuid, text, integer, jsonb, timestamp, boolean, date, numeric, bigint } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export type LoadRx =
  | { type: 'absolute'; value: number; unit: 'lb' | 'kg' }
  | { type: 'percent_max'; percent: number }
  | { type: 'rpe'; rpe: number }
  | { type: 'bodyweight' };

export interface ProgressionParams {
  incrementKg?: number;
  incrementLb?: number;
  repRangeMin?: number;
  repRangeMax?: number;
}

export const progressionRules = pgTable('progression_rules', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['linear', 'double'] }).notNull(),
  params: jsonb('params').$type<ProgressionParams>().notNull().default({}),
  description: text('description'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  ownerTrainerId: uuid('owner_trainer_id'),
  name: text('name').notNull(),
  description: text('description'),
  goalTags: text('goal_tags').array().notNull().default([]),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  publishedToMembers: boolean('published_to_members').notNull().default(false),
  currentVersionId: uuid('current_version_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  archivedAt: ts('archived_at'),
});

export const programVersions = pgTable('program_versions', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  programId: uuid('program_id').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  defaultProgressionRuleId: uuid('default_progression_rule_id'),
  notes: text('notes'),
  publishedAt: ts('published_at'),
  publishedBy: uuid('published_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const programBlocks = pgTable('program_blocks', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  versionId: uuid('version_id').notNull(),
  name: text('name').notNull().default('Block 1'),
  orderNo: integer('order_no').notNull().default(1),
});

export const programWeeks = pgTable('program_weeks', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  blockId: uuid('block_id').notNull(),
  weekNo: integer('week_no').notNull(),
  name: text('name'),
});

export const programDays = pgTable('program_days', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  weekId: uuid('week_id').notNull(),
  dayNo: integer('day_no').notNull(),
  name: text('name').notNull().default('Workout'),
  focus: text('focus'),
});

export type GroupKind = 'straight' | 'superset' | 'circuit' | 'emom' | 'amrap' | 'interval';

export const programDayItems = pgTable('program_day_items', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  dayId: uuid('day_id').notNull(),
  orderNo: integer('order_no').notNull(),
  exerciseId: uuid('exercise_id').notNull(),
  groupNo: integer('group_no'),
  groupKind: text('group_kind', {
    enum: ['straight', 'superset', 'circuit', 'emom', 'amrap', 'interval'],
  })
    .notNull()
    .default('straight'),
  sets: integer('sets').notNull().default(3),
  reps: text('reps').notNull().default('8'),
  load: jsonb('load').$type<LoadRx>().notNull().default({ type: 'bodyweight' }),
  tempo: text('tempo'),
  restS: integer('rest_s'),
  rpeTarget: numeric('rpe_target'),
  notes: text('notes'),
  progressionRuleId: uuid('progression_rule_id'),
});

export const programItemAlternates = pgTable('program_item_alternates', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  itemId: uuid('item_id').notNull(),
  exerciseId: uuid('exercise_id').notNull(),
  rank: integer('rank').notNull().default(1),
  reason: text('reason'),
});

export const memberMaxes = pgTable('member_maxes', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  exerciseId: uuid('exercise_id').notNull(),
  kind: text('kind', { enum: ['tested', 'e1rm'] }).notNull().default('tested'),
  valueKg: numeric('value_kg').notNull(),
  measuredAt: date('measured_at', { mode: 'string' }).notNull(),
  source: text('source'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const programAssignments = pgTable('program_assignments', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  programId: uuid('program_id').notNull(),
  programVersionId: uuid('program_version_id').notNull(),
  memberId: uuid('member_id'),
  assignedBy: uuid('assigned_by'),
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  status: text('status', { enum: ['active', 'completed', 'cancelled'] }).notNull().default('active'),
  videosOptIn: boolean('videos_opt_in').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const workoutSessions = pgTable('workout_sessions', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  assignmentId: uuid('assignment_id'),
  programVersionId: uuid('program_version_id'),
  programDayId: uuid('program_day_id'),
  title: text('title'),
  status: text('status', { enum: ['active', 'completed', 'discarded'] }).notNull().default('active'),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
  feltRating: integer('felt_rating'),
  notes: text('notes'),
  deviceId: text('device_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  fieldsHlc: text('fields_hlc'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const setLog = pgTable('set_log', {
  opId: text('op_id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  kind: text('kind', { enum: ['set_logged', 'set_amended', 'set_voided', 'substitution'] }).notNull(),
  amends: text('amends'),
  exerciseId: uuid('exercise_id'),
  programItemId: uuid('program_item_id'),
  setNo: integer('set_no'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: uuid('actor_user_id'),
  deviceId: text('device_id').notNull(),
  clientSeq: bigint('client_seq', { mode: 'number' }).notNull(),
  clientTs: ts('client_ts').notNull(),
  hlc: text('hlc').notNull(),
  serverReceivedAt: ts('server_received_at').notNull().defaultNow(),
});

export const personalRecords = pgTable('personal_records', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  exerciseId: uuid('exercise_id').notNull(),
  kind: text('kind', { enum: ['e1rm', 'weight', 'reps', 'volume'] }).notNull(),
  value: numeric('value').notNull(),
  setOpId: text('set_op_id'),
  achievedAt: ts('achieved_at').notNull().defaultNow(),
});

export const bodyMetrics = pgTable('body_metrics', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  measuredAt: date('measured_at', { mode: 'string' }).notNull(),
  weightKg: numeric('weight_kg'),
  bodyFatPct: numeric('body_fat_pct'),
  measures: jsonb('measures').$type<Record<string, number>>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const equipmentScans = pgTable('equipment_scans', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  memberId: uuid('member_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
