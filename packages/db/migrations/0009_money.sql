-- Money: effective-dated rate cards (never rewritten), packages with an
-- append-only ledger, payment records (provider refs only — no card data, ever).

CREATE TABLE rate_cards (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('session_type','trainer','trainer_session_type')),
  session_type_id uuid REFERENCES session_types(id) ON DELETE CASCADE,
  trainer_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'session_type' AND session_type_id IS NOT NULL AND trainer_user_id IS NULL) OR
    (scope = 'trainer' AND trainer_user_id IS NOT NULL AND session_type_id IS NULL) OR
    (scope = 'trainer_session_type' AND trainer_user_id IS NOT NULL AND session_type_id IS NOT NULL)
  )
);
CREATE INDEX rate_cards_lookup_idx ON rate_cards(gym_id, scope, effective_at DESC);

ALTER TABLE bookings ADD CONSTRAINT bookings_rate_card_fk
  FOREIGN KEY (rate_card_id) REFERENCES rate_cards(id);

CREATE TABLE packages (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name text NOT NULL,
  session_type_ids uuid[] NOT NULL DEFAULT '{}',   -- empty = valid for any session type
  quantity integer NOT NULL CHECK (quantity > 0),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  expires_days integer,
  transferable boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  purpose text NOT NULL CHECK (purpose IN ('package','fee')),
  provider text NOT NULL DEFAULT 'dev' CHECK (provider IN ('dev','stripe')),
  provider_ref text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE package_purchases (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES packages(id),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  price_paid_cents integer NOT NULL,
  payment_id uuid REFERENCES payments(id),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX package_purchases_member_idx ON package_purchases(gym_id, member_id);

ALTER TABLE bookings ADD CONSTRAINT bookings_package_purchase_fk
  FOREIGN KEY (package_purchase_id) REFERENCES package_purchases(id);

-- Balance = SUM(delta). Never a mutable counter (docs/DECISIONS.md D-009).
CREATE TABLE package_ledger (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES package_purchases(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  kind text NOT NULL CHECK (kind IN
    ('purchase','redemption','redemption_reversal','expiry','refund','transfer_in','transfer_out','adjustment')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX package_ledger_purchase_idx ON package_ledger(purchase_id);

SELECT setup_tenant_rls('rate_cards');
SELECT setup_tenant_rls('packages');
SELECT setup_tenant_rls('payments');
SELECT setup_tenant_rls('package_purchases');
SELECT setup_tenant_rls('package_ledger');
