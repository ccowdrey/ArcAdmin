-- ArcNode Admin — Support staff: read their company's build lines
-- ===============================================================
-- The Log a call form lists a builder's vehicles by reading build_lines for
-- the company, then vehicles on those lines. Support staff (support_members
-- rows) had no read access to build_lines, so their vehicle list was empty.
-- This adds one SELECT policy and nothing else: they still can't add, edit
-- or delete build lines.
--
-- Two-factor: build_lines already has the admin_requires_mfa policy from
-- migration_admin_mfa.sql, and is_portal_admin() counts support members
-- (migration_support_member_clients.sql), so this needs an AAL2 session.
--
-- Run in the Supabase SQL editor after migration_support_member_roles.sql.
-- Re-runnable.
--
-- Verify (as a support member, signed in with two-factor, in the portal):
--   Support → Log a call → the Vehicle list shows the company's vehicles.
--
-- ROLLBACK:
--   drop policy if exists support_member_read_build_lines on public.build_lines;

drop policy if exists support_member_read_build_lines on public.build_lines;
create policy support_member_read_build_lines on public.build_lines for select to authenticated
  using (public.support_is_member()
         and company_id in (select sm.company_id from public.support_members sm
                            where sm.user_id = auth.uid()));
