-- Structured intake, carried over from the earlier Personal-Trainer project's
-- client form (medical history, medications, surgical history, clearance).
--
-- It lives in its own table rather than as columns on members for the reason
-- ARCHITECTURE.md §8 gives: health data has to stay separable, and every field
-- here is sensitive enough to be encrypted and read only through health.read.

CREATE TABLE member_health_profiles (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- non-sensitive enough to filter on, and useful for programming
  training_experience text CHECK (training_experience IN ('beginner','intermediate','advanced','athlete')),
  physician_clearance boolean NOT NULL DEFAULT false,
  height_cm numeric,
  -- free text about a person's body and medication: encrypted at rest
  medical_history_enc text,
  medications_enc text,
  surgical_history_enc text,
  physical_limitations_enc text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);
CREATE INDEX member_health_profiles_member_idx ON member_health_profiles(gym_id, member_id);

-- A link to an existing demo (YouTube, vendor site) so a gym is not blocked on
-- filming its own library. An uploaded, published video always wins.
ALTER TABLE exercises ADD COLUMN external_video_url text;

SELECT setup_tenant_rls('member_health_profiles');
