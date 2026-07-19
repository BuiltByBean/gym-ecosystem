-- Extensions + RLS helper functions. Every later migration uses setup_tenant_rls().
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Tenant context, set per-request/per-job via set_config(..., true) inside a transaction.
-- Missing setting => NULL => every policy evaluates false => fail closed.
CREATE OR REPLACE FUNCTION app_current_gym() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.gym_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- shared=false: strict per-tenant isolation.
-- shared=true : rows with gym_id IS NULL are platform content, readable by every tenant,
--               writable only by owner/superuser (seeds, platform tooling).
CREATE OR REPLACE FUNCTION setup_tenant_rls(tbl regclass, shared boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  IF shared THEN
    EXECUTE format('CREATE POLICY tenant_shared_read ON %s FOR SELECT USING (gym_id IS NULL OR gym_id = app_current_gym())', tbl);
    EXECUTE format('CREATE POLICY tenant_write ON %s USING (gym_id = app_current_gym()) WITH CHECK (gym_id = app_current_gym())', tbl);
  ELSE
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (gym_id = app_current_gym()) WITH CHECK (gym_id = app_current_gym())', tbl);
  END IF;
END $fn$;
