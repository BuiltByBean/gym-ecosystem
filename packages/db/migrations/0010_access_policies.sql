-- Pre-tenant access fixes discovered while wiring the API:
-- 1) hostname -> gym resolution happens before any tenant context exists, and a
--    hostname mapping is public information (it is DNS). Reads open, writes tenant-scoped.
-- 2) users must see their own member rows across gyms (gym switcher / login).
-- 3) gyms visible to their members, not only their staff.

DROP POLICY tenant_isolation ON tenant_domains;
CREATE POLICY domains_public_read ON tenant_domains FOR SELECT USING (true);
CREATE POLICY domains_tenant_write ON tenant_domains
  USING (gym_id = app_current_gym()) WITH CHECK (gym_id = app_current_gym());

CREATE POLICY members_self_read ON members FOR SELECT
  USING (user_id = app_current_user());

DROP POLICY gym_self ON gyms;
CREATE POLICY gym_self ON gyms FOR SELECT USING (
  id = app_current_gym()
  OR EXISTS (SELECT 1 FROM gym_staff s
             WHERE s.gym_id = gyms.id AND s.user_id = app_current_user() AND s.status = 'active')
  OR EXISTS (SELECT 1 FROM members m
             WHERE m.gym_id = gyms.id AND m.user_id = app_current_user() AND m.archived_at IS NULL)
);
