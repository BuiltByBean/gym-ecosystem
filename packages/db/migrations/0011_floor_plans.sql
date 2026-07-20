-- Floor plans and wayfinding.
--
-- A member told to do "Leg Press 3x12" should not have to hunt the floor for it.
-- Plans are stored in real-world centimetres so distances and footprints mean
-- something; the UI renders cm through a viewBox rather than storing pixels.

CREATE TABLE floor_plans (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  location_id uuid REFERENCES gym_locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  width_cm integer NOT NULL DEFAULT 3000 CHECK (width_cm BETWEEN 200 AND 30000),
  height_cm integer NOT NULL DEFAULT 2000 CHECK (height_cm BETWEEN 200 AND 30000),
  grid_cm integer NOT NULL DEFAULT 50 CHECK (grid_cm BETWEEN 10 AND 500),
  -- optional traced background: the gym's existing architectural drawing
  background_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  background_opacity numeric NOT NULL DEFAULT 0.45 CHECK (background_opacity BETWEEN 0 AND 1),
  -- where members enter, so a map can be oriented ("from the front desk…")
  entrance_x_cm integer,
  entrance_y_cm integer,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX floor_plans_gym_idx ON floor_plans(gym_id);
-- at most one default plan per gym
CREATE UNIQUE INDEX floor_plans_default_uq ON floor_plans(gym_id) WHERE is_default;

-- Zones become drawable regions on a plan. Existing rows keep working: a zone
-- with no geometry is simply a name, exactly as before.
ALTER TABLE gym_zones
  ADD COLUMN floor_plan_id uuid REFERENCES floor_plans(id) ON DELETE SET NULL,
  ADD COLUMN x_cm integer,
  ADD COLUMN y_cm integer,
  ADD COLUMN width_cm integer,
  ADD COLUMN height_cm integer,
  ADD COLUMN color text NOT NULL DEFAULT '#5B6472';
CREATE INDEX gym_zones_plan_idx ON gym_zones(floor_plan_id);

-- Footprint lives on the model (every leg press is the same size); position
-- lives on the unit (each physical machine sits somewhere specific).
ALTER TABLE equipment_models
  ADD COLUMN footprint_w_cm integer NOT NULL DEFAULT 120 CHECK (footprint_w_cm BETWEEN 20 AND 1000),
  ADD COLUMN footprint_h_cm integer NOT NULL DEFAULT 180 CHECK (footprint_h_cm BETWEEN 20 AND 1000),
  ADD COLUMN how_to text;

ALTER TABLE equipment_units
  ADD COLUMN floor_plan_id uuid REFERENCES floor_plans(id) ON DELETE SET NULL,
  ADD COLUMN x_cm integer,
  ADD COLUMN y_cm integer,
  ADD COLUMN rotation_deg integer NOT NULL DEFAULT 0 CHECK (rotation_deg BETWEEN 0 AND 359);
CREATE INDEX equipment_units_plan_idx ON equipment_units(floor_plan_id) WHERE floor_plan_id IS NOT NULL;

-- Photos and how-to videos for a machine. Distinct from exercise demo videos:
-- this is "how this specific machine works", authored by gym staff during
-- setup, so it needs no publish workflow (only equipment.manage can write).
CREATE TABLE equipment_media (
  id uuid PRIMARY KEY,
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo', 'how_to_video')),
  caption text,
  order_no integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_media_model_idx ON equipment_media(gym_id, model_id, order_no);

SELECT setup_tenant_rls('floor_plans');
SELECT setup_tenant_rls('equipment_media');
