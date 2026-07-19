-- Identity, tenancy, roles, audit.
-- Global tables WITHOUT RLS (documented exceptions, enforced-by-service):
--   users, sessions (pre-tenant auth), invites (capability-token lookup).

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  active_gym_id uuid,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE gyms (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'America/New_York',
  currency text NOT NULL DEFAULT 'USD',
  units text NOT NULL DEFAULT 'lb' CHECK (units IN ('lb','kg')),
  brand_primary text NOT NULL DEFAULT '#C8472B',
  brand_accent text NOT NULL DEFAULT '#1A1A1A',
  logo_media_id uuid,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD CONSTRAINT sessions_active_gym_fk
  FOREIGN KEY (active_gym_id) REFERENCES gyms(id) ON DELETE SET NULL;

CREATE TABLE gym_locations (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  hours jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gym_locations_gym_idx ON gym_locations(gym_id);

CREATE TABLE tenant_domains (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  hostname citext NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'subdomain' CHECK (kind IN ('subdomain','custom')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gym_staff (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','front_desk','trainer')),
  employment_type text CHECK (employment_type IN ('employee','contractor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gym_id, user_id, role)
);
CREATE INDEX gym_staff_user_idx ON gym_staff(user_id);

CREATE TABLE trainer_profiles (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio text,
  specialties text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  certifications jsonb NOT NULL DEFAULT '[]',
  target_client_load integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gym_id, user_id)
);

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  email citext NOT NULL,
  kind text NOT NULL CHECK (kind IN ('staff','member')),
  role text,
  member_id uuid,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_gym_idx ON invites(gym_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  reason text,
  ip text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_gym_idx ON audit_events(gym_id, created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

-- RLS ---------------------------------------------------------------------

-- gyms: visible when it is the active tenant, or when the requesting user belongs
-- to it (gym switcher / login flow reads memberships before a tenant is chosen).
ALTER TABLE gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE gyms FORCE ROW LEVEL SECURITY;
CREATE POLICY gym_self ON gyms FOR SELECT USING (
  id = app_current_gym()
  OR EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = gyms.id AND s.user_id = app_current_user() AND s.status = 'active')
);
CREATE POLICY gym_update ON gyms FOR UPDATE
  USING (id = app_current_gym()) WITH CHECK (id = app_current_gym());

-- gym_staff: tenant rows, plus users can always see their own membership rows.
ALTER TABLE gym_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_staff FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_tenant ON gym_staff
  USING (gym_id = app_current_gym()) WITH CHECK (gym_id = app_current_gym());
CREATE POLICY staff_self_read ON gym_staff FOR SELECT USING (user_id = app_current_user());

SELECT setup_tenant_rls('gym_locations');
SELECT setup_tenant_rls('tenant_domains');
SELECT setup_tenant_rls('trainer_profiles');

-- audit: tenant-scoped reads; inserts may also carry gym_id NULL (platform/auth events).
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT USING (gym_id = app_current_gym());
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (gym_id = app_current_gym() OR gym_id IS NULL);

-- notifications: tenant rows, plus recipients read/ack their own across gyms.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notif_tenant ON notifications
  USING (gym_id = app_current_gym()) WITH CHECK (gym_id = app_current_gym());
CREATE POLICY notif_self ON notifications FOR SELECT USING (user_id = app_current_user());
CREATE POLICY notif_self_ack ON notifications FOR UPDATE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
