-- Scheduling: availability, bookings (double-booking excluded at the DB), incidents, check-ins.

CREATE TABLE session_types (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_min integer NOT NULL DEFAULT 60,
  capacity integer NOT NULL DEFAULT 1,
  requires_package boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Recurring weekly template, minutes since midnight in the gym's timezone.
CREATE TABLE availability_templates (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min integer NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  location_id uuid REFERENCES gym_locations(id) ON DELETE SET NULL,
  CHECK (end_min > start_min)
);
CREATE INDEX avail_templates_trainer_idx ON availability_templates(gym_id, trainer_user_id);

CREATE TABLE availability_exceptions (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('open','blocked','time_off')),
  start_min integer,
  end_min integer,
  note text
);
CREATE INDEX avail_exceptions_trainer_idx ON availability_exceptions(gym_id, trainer_user_id, date);

CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_user_id uuid NOT NULL REFERENCES users(id),
  session_type_id uuid NOT NULL REFERENCES session_types(id),
  location_id uuid REFERENCES gym_locations(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','completed','cancelled','late_cancelled','no_show')),
  booked_by uuid,
  rate_card_id uuid,
  rate_applied_cents integer,
  package_purchase_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (ends_at > starts_at),
  -- Trainer double-booking prevention across the gym's locations.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    gym_id WITH =,
    trainer_user_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('booked','completed'))
);
CREATE INDEX bookings_trainer_idx ON bookings(gym_id, trainer_user_id, starts_at);
CREATE INDEX bookings_time_idx ON bookings(gym_id, starts_at);

CREATE TABLE booking_attendees (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','checked_in','no_show','cancelled')),
  checked_in_at timestamptz,
  UNIQUE (booking_id, member_id)
);
CREATE INDEX booking_attendees_member_idx ON booking_attendees(gym_id, member_id);

-- Fee posting is separate from collection (docs/OPEN_QUESTIONS.md #10).
CREATE TABLE policy_incidents (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('late_cancel','no_show')),
  fee_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','waived','collected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid
);

CREATE TABLE checkins (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'front_desk' CHECK (source IN ('kiosk','front_desk','qr','app')),
  by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkins_gym_idx ON checkins(gym_id, created_at DESC);

SELECT setup_tenant_rls('session_types');
SELECT setup_tenant_rls('availability_templates');
SELECT setup_tenant_rls('availability_exceptions');
SELECT setup_tenant_rls('bookings');
SELECT setup_tenant_rls('booking_attendees');
SELECT setup_tenant_rls('policy_incidents');
SELECT setup_tenant_rls('checkins');
