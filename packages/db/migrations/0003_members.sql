-- Members, health screening, waivers, grants, imports.

CREATE TABLE members (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email citext,
  phone text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('prospect','active','frozen','inactive','cancelled')),
  membership_type text,
  date_of_birth date,
  joined_at date,
  emergency_name text,
  emergency_phone text,
  goals_note text,
  preferred_times jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_gym_user_uq ON members(gym_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX members_gym_status_idx ON members(gym_id, status);
CREATE INDEX members_gym_name_idx ON members(gym_id, last_name, first_name);

-- description is app-layer encrypted; the exclusion arrays stay queryable plaintext
-- (they contain taxonomy ids, not health details) so the substitution engine can filter.
CREATE TABLE member_limitations (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  description_enc text NOT NULL,
  excluded_pattern_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX member_limitations_member_idx ON member_limitations(gym_id, member_id);

CREATE TABLE health_screening_templates (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  questions jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE health_screenings (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES health_screening_templates(id),
  answers_enc text NOT NULL,
  flagged boolean NOT NULL DEFAULT false,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_screenings_member_idx ON health_screenings(gym_id, member_id);

CREATE TABLE waiver_templates (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  body_md text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only legal artifact: exact doc hash, signer, timestamp, IP.
CREATE TABLE waiver_signatures (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES waiver_templates(id),
  template_version integer NOT NULL,
  doc_sha256 text NOT NULL,
  signed_name text NOT NULL,
  signer_relationship text NOT NULL DEFAULT 'self',
  ip text,
  user_agent text,
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waiver_signatures_member_idx ON waiver_signatures(gym_id, member_id);

CREATE TABLE member_trainer_grants (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('health','progress_photos')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX mtg_member_idx ON member_trainer_grants(gym_id, member_id, trainer_user_id);

CREATE TABLE trainer_assignments (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source text NOT NULL DEFAULT 'manual'
);
CREATE INDEX trainer_assignments_member_idx ON trainer_assignments(gym_id, member_id);
CREATE INDEX trainer_assignments_trainer_idx ON trainer_assignments(gym_id, trainer_user_id);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dry_run','applied','failed')),
  totals jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_no integer NOT NULL,
  raw jsonb NOT NULL,
  mapped jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','applied')),
  error text
);
CREATE INDEX import_rows_job_idx ON import_rows(import_job_id);

SELECT setup_tenant_rls('members');
SELECT setup_tenant_rls('member_limitations');
SELECT setup_tenant_rls('health_screening_templates', true);
SELECT setup_tenant_rls('health_screenings');
SELECT setup_tenant_rls('waiver_templates', true);
SELECT setup_tenant_rls('waiver_signatures');
SELECT setup_tenant_rls('member_trainer_grants');
SELECT setup_tenant_rls('trainer_assignments');
SELECT setup_tenant_rls('import_jobs');
SELECT setup_tenant_rls('import_rows');
