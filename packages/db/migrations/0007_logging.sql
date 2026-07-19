-- Workout logging: the offline sync domain. set_log is APPEND-ONLY.

CREATE TABLE workout_sessions (
  id uuid PRIMARY KEY,                    -- client-generated
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES program_assignments(id) ON DELETE SET NULL,
  program_version_id uuid REFERENCES program_versions(id),
  program_day_id uuid REFERENCES program_days(id),
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','discarded')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  felt_rating integer CHECK (felt_rating BETWEEN 1 AND 5),
  notes text,
  device_id text NOT NULL,
  actor_user_id uuid,
  fields_hlc text,                        -- LWW stamp for the mutable fields above
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ws_member_idx ON workout_sessions(gym_id, member_id, started_at DESC);

-- One row per immutable op; primary key is the client ULID, upserts are
-- ON CONFLICT DO NOTHING so retried batches are harmless.
CREATE TABLE set_log (
  op_id text PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('set_logged','set_amended','set_voided','substitution')),
  amends text REFERENCES set_log(op_id),
  exercise_id uuid REFERENCES exercises(id),
  program_item_id uuid REFERENCES program_day_items(id),
  set_no integer,
  payload jsonb NOT NULL DEFAULT '{}',
  actor_user_id uuid,
  device_id text NOT NULL,
  client_seq bigint NOT NULL,
  client_ts timestamptz NOT NULL,
  hlc text NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX set_log_device_seq_uq ON set_log(device_id, client_seq);
CREATE INDEX set_log_session_idx ON set_log(session_id);
CREATE INDEX set_log_gym_ex_idx ON set_log(gym_id, exercise_id, server_received_at DESC);

CREATE TABLE personal_records (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  kind text NOT NULL CHECK (kind IN ('e1rm','weight','reps','volume')),
  value numeric NOT NULL,
  set_op_id text REFERENCES set_log(op_id),
  achieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pr_member_idx ON personal_records(gym_id, member_id, exercise_id, kind, achieved_at DESC);

CREATE TABLE body_metrics (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  measured_at date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg numeric,
  body_fat_pct numeric,
  measures jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX body_metrics_member_idx ON body_metrics(gym_id, member_id, measured_at DESC);

CREATE TABLE equipment_scans (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES equipment_units(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_scans_gym_idx ON equipment_scans(gym_id, created_at DESC);

SELECT setup_tenant_rls('workout_sessions');
SELECT setup_tenant_rls('set_log');
SELECT setup_tenant_rls('personal_records');
SELECT setup_tenant_rls('body_metrics');
SELECT setup_tenant_rls('equipment_scans');
