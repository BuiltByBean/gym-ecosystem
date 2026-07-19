-- Programs: versioned structure, prescriptions, alternates, progression rules, assignment.
-- gym_id NULL on program trees = platform templates (shared read layer).

CREATE TABLE progression_rules (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('linear','double')),
  params jsonb NOT NULL DEFAULT '{}',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE programs (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  owner_trainer_id uuid,
  name text NOT NULL,
  description text,
  goal_tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_to_members boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX programs_gym_idx ON programs(gym_id, status);

CREATE TABLE program_versions (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  default_progression_rule_id uuid REFERENCES progression_rules(id),
  notes text,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, version)
);

CREATE TABLE program_blocks (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES program_versions(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Block 1',
  order_no integer NOT NULL DEFAULT 1
);

CREATE TABLE program_weeks (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES program_blocks(id) ON DELETE CASCADE,
  week_no integer NOT NULL,
  name text
);

CREATE TABLE program_days (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  week_id uuid NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
  day_no integer NOT NULL,
  name text NOT NULL DEFAULT 'Workout',
  focus text
);

-- load jsonb is a typed union:
--   {"type":"absolute","value":60,"unit":"kg"} | {"type":"percent_max","percent":80}
--   {"type":"rpe","rpe":8} | {"type":"bodyweight"}
CREATE TABLE program_day_items (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
  order_no integer NOT NULL,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  group_no integer,
  group_kind text NOT NULL DEFAULT 'straight'
    CHECK (group_kind IN ('straight','superset','circuit','emom','amrap','interval')),
  sets integer NOT NULL DEFAULT 3,
  reps text NOT NULL DEFAULT '8',
  load jsonb NOT NULL DEFAULT '{"type":"bodyweight"}',
  tempo text,
  rest_s integer,
  rpe_target numeric,
  notes text,
  progression_rule_id uuid REFERENCES progression_rules(id)
);
CREATE INDEX pdi_day_idx ON program_day_items(day_id, order_no);

CREATE TABLE program_item_alternates (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES program_day_items(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  rank integer NOT NULL DEFAULT 1,
  reason text
);

-- Canonical strength numbers powering percent_max loads (stored in kg).
CREATE TABLE member_maxes (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  kind text NOT NULL DEFAULT 'tested' CHECK (kind IN ('tested','e1rm')),
  value_kg numeric NOT NULL,
  measured_at date NOT NULL DEFAULT CURRENT_DATE,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_maxes_idx ON member_maxes(gym_id, member_id, exercise_id, measured_at DESC);

-- member_id NULL = published to the whole gym (free gym program offering).
CREATE TABLE program_assignments (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  program_version_id uuid NOT NULL REFERENCES program_versions(id),
  member_id uuid REFERENCES members(id) ON DELETE CASCADE,
  assigned_by uuid,
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  videos_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX program_assignments_member_idx ON program_assignments(gym_id, member_id, status);

SELECT setup_tenant_rls('progression_rules', true);
SELECT setup_tenant_rls('programs', true);
SELECT setup_tenant_rls('program_versions', true);
SELECT setup_tenant_rls('program_blocks', true);
SELECT setup_tenant_rls('program_weeks', true);
SELECT setup_tenant_rls('program_days', true);
SELECT setup_tenant_rls('program_day_items', true);
SELECT setup_tenant_rls('program_item_alternates', true);
SELECT setup_tenant_rls('member_maxes');
SELECT setup_tenant_rls('program_assignments');
