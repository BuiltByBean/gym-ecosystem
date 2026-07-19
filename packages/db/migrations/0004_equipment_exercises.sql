-- Equipment (models + physical units) and the exercise library graph.

CREATE TABLE equipment_classes (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE movement_patterns (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE muscles (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  region text NOT NULL
);

CREATE TABLE gym_zones (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  location_id uuid REFERENCES gym_locations(id) ON DELETE SET NULL,
  name text NOT NULL
);

CREATE TABLE equipment_models (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  manufacturer text,
  model text,
  photo_media_id uuid,
  notes text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_models_gym_idx ON equipment_models(gym_id);

CREATE TABLE equipment_model_classes (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES equipment_classes(id) ON DELETE CASCADE,
  UNIQUE (model_id, class_id)
);

CREATE TABLE equipment_units (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  tag_code text NOT NULL,
  zone_id uuid REFERENCES gym_zones(id) ON DELETE SET NULL,
  serial text,
  status text NOT NULL DEFAULT 'in_service'
    CHECK (status IN ('in_service','maintenance','out_of_service','retired')),
  purchased_at date,
  last_serviced_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gym_id, tag_code)
);
CREATE INDEX equipment_units_model_idx ON equipment_units(gym_id, model_id, status);

CREATE TABLE equipment_status_history (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES equipment_units(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_reports (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES equipment_units(id) ON DELETE CASCADE,
  reported_by_user_id uuid,
  reported_by_member_id uuid,
  description text NOT NULL,
  photo_media_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX maintenance_reports_gym_idx ON maintenance_reports(gym_id, status);

-- Exercises: one table, two layers. gym_id NULL = platform library.
CREATE TABLE exercises (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  movement_pattern_id uuid NOT NULL REFERENCES movement_patterns(id),
  equipment_class_id uuid REFERENCES equipment_classes(id),
  difficulty integer NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
  cues text[] NOT NULL DEFAULT '{}',
  video_group_id uuid,
  forked_from uuid REFERENCES exercises(id),
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exercises_platform_name_uq ON exercises(lower(name)) WHERE gym_id IS NULL;
CREATE UNIQUE INDEX exercises_gym_name_uq ON exercises(gym_id, lower(name)) WHERE gym_id IS NOT NULL;
CREATE INDEX exercises_pattern_idx ON exercises(movement_pattern_id);

CREATE TABLE exercise_muscles (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_id uuid NOT NULL REFERENCES muscles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('primary','secondary')),
  UNIQUE (exercise_id, muscle_id)
);

-- The graph. Two stored kinds; regression = progression read backwards,
-- same_movement_pattern derived from the taxonomy column (see docs/DECISIONS.md D-005).
CREATE TABLE exercise_relationships (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  from_exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  to_exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('substitutes_for','progression_of')),
  rank integer NOT NULL DEFAULT 100,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_exercise_id <> to_exercise_id)
);
CREATE UNIQUE INDEX exrel_platform_uq ON exercise_relationships(from_exercise_id, to_exercise_id, kind) WHERE gym_id IS NULL;
CREATE UNIQUE INDEX exrel_gym_uq ON exercise_relationships(gym_id, from_exercise_id, to_exercise_id, kind) WHERE gym_id IS NOT NULL;
CREATE INDEX exrel_from_idx ON exercise_relationships(from_exercise_id, kind);
CREATE INDEX exrel_to_idx ON exercise_relationships(to_exercise_id, kind);

CREATE TABLE equipment_exercise_links (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  UNIQUE (model_id, exercise_id)
);
CREATE INDEX eel_exercise_idx ON equipment_exercise_links(gym_id, exercise_id);

SELECT setup_tenant_rls('gym_zones');
SELECT setup_tenant_rls('equipment_models');
SELECT setup_tenant_rls('equipment_model_classes');
SELECT setup_tenant_rls('equipment_units');
SELECT setup_tenant_rls('equipment_status_history');
SELECT setup_tenant_rls('maintenance_reports');
SELECT setup_tenant_rls('exercises', true);
SELECT setup_tenant_rls('exercise_muscles', true);
SELECT setup_tenant_rls('exercise_relationships', true);
SELECT setup_tenant_rls('equipment_exercise_links');
