import { pgTable, uuid, text, integer, timestamp, date, bigint } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const equipmentClasses = pgTable('equipment_classes', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
});

export const movementPatterns = pgTable('movement_patterns', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
});

export const muscles = pgTable('muscles', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  region: text('region').notNull(),
});

export const gymZones = pgTable('gym_zones', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  locationId: uuid('location_id'),
  name: text('name').notNull(),
});

export const equipmentModels = pgTable('equipment_models', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default('other'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  photoMediaId: uuid('photo_media_id'),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const equipmentModelClasses = pgTable('equipment_model_classes', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  modelId: uuid('model_id').notNull(),
  classId: uuid('class_id').notNull(),
});

export type EquipmentStatus = 'in_service' | 'maintenance' | 'out_of_service' | 'retired';

export const equipmentUnits = pgTable('equipment_units', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  modelId: uuid('model_id').notNull(),
  tagCode: text('tag_code').notNull(),
  zoneId: uuid('zone_id'),
  serial: text('serial'),
  status: text('status', { enum: ['in_service', 'maintenance', 'out_of_service', 'retired'] })
    .notNull()
    .default('in_service'),
  purchasedAt: date('purchased_at', { mode: 'string' }),
  lastServicedAt: date('last_serviced_at', { mode: 'string' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const equipmentStatusHistory = pgTable('equipment_status_history', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  changedBy: uuid('changed_by'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const maintenanceReports = pgTable('maintenance_reports', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  reportedByUserId: uuid('reported_by_user_id'),
  reportedByMemberId: uuid('reported_by_member_id'),
  description: text('description').notNull(),
  photoMediaId: uuid('photo_media_id'),
  status: text('status', { enum: ['open', 'in_progress', 'resolved'] }).notNull().default('open'),
  resolution: text('resolution'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const exercises = pgTable('exercises', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  name: text('name').notNull(),
  movementPatternId: uuid('movement_pattern_id').notNull(),
  equipmentClassId: uuid('equipment_class_id'),
  difficulty: integer('difficulty').notNull().default(2),
  cues: text('cues').array().notNull().default([]),
  videoGroupId: uuid('video_group_id'),
  forkedFrom: uuid('forked_from'),
  archivedAt: ts('archived_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const exerciseMuscles = pgTable('exercise_muscles', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  exerciseId: uuid('exercise_id').notNull(),
  muscleId: uuid('muscle_id').notNull(),
  role: text('role', { enum: ['primary', 'secondary'] }).notNull(),
});

export const exerciseRelationships = pgTable('exercise_relationships', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  fromExerciseId: uuid('from_exercise_id').notNull(),
  toExerciseId: uuid('to_exercise_id').notNull(),
  kind: text('kind', { enum: ['substitutes_for', 'progression_of'] }).notNull(),
  rank: integer('rank').notNull().default(100),
  reason: text('reason'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const equipmentExerciseLinks = pgTable('equipment_exercise_links', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  modelId: uuid('model_id').notNull(),
  exerciseId: uuid('exercise_id').notNull(),
});

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id'),
  kind: text('kind', { enum: ['video', 'image', 'doc'] }).notNull(),
  objectKey: text('object_key').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  uploadedBy: uuid('uploaded_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const videoGroups = pgTable('video_groups', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  kind: text('kind', { enum: ['exercise_demo', 'form_check'] }).notNull().default('exercise_demo'),
  currentVideoId: uuid('current_video_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const videos = pgTable('videos', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  groupId: uuid('group_id').notNull(),
  version: integer('version').notNull().default(1),
  mediaId: uuid('media_id').notNull(),
  status: text('status', { enum: ['processing', 'pending_review', 'published', 'retired'] })
    .notNull()
    .default('pending_review'),
  durationS: integer('duration_s'),
  uploadedBy: uuid('uploaded_by'),
  publishedBy: uuid('published_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const formReviews = pgTable('form_reviews', {
  id: uuid('id').primaryKey(),
  gymId: uuid('gym_id').notNull(),
  memberId: uuid('member_id').notNull(),
  setOpId: text('set_op_id'),
  mediaId: uuid('media_id'),
  memberNote: text('member_note'),
  trainerUserId: uuid('trainer_user_id'),
  feedback: text('feedback'),
  status: text('status', { enum: ['pending', 'reviewed'] }).notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  reviewedAt: ts('reviewed_at'),
});
