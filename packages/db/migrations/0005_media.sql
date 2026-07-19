-- Media: local-adapter assets + versioned demo videos with approval workflow.

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('video','image','doc')),
  object_key text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_gym_idx ON media_assets(gym_id);

-- Stable identity that exercises/programs point at; delivery resolves to the
-- current published version, so replacing a video never breaks links.
CREATE TABLE video_groups (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'exercise_demo' CHECK (kind IN ('exercise_demo','form_check')),
  current_video_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE videos (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES video_groups(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  media_id uuid NOT NULL REFERENCES media_assets(id),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('processing','pending_review','published','retired')),
  duration_s integer,
  uploaded_by uuid,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, version)
);

-- Member records a working set for async trainer form review.
CREATE TABLE form_reviews (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  set_op_id text,
  media_id uuid REFERENCES media_assets(id),
  member_note text,
  trainer_user_id uuid,
  feedback text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX form_reviews_gym_idx ON form_reviews(gym_id, status);

SELECT setup_tenant_rls('media_assets', true);
SELECT setup_tenant_rls('video_groups');
SELECT setup_tenant_rls('videos');
SELECT setup_tenant_rls('form_reviews');
