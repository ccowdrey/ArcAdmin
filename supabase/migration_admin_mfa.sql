-- ArcNode Admin — require two-factor (AAL2) for builder-portal admin access
-- ==========================================================================
-- Threat: someone gets an admin's email + password (phishing, reuse, shared
-- login) and scrapes client / vehicle / build data. The portal's login checks
-- run in the browser, and the anon key is public, so anyone holding a
-- password can skip the UI and call the REST API directly. The only control
-- that holds is in the database.
--
-- What this does: adds a RESTRICTIVE policy to each sensitive table. If the
-- caller is a portal admin (profiles.is_admin or a company_admins row), the
-- caller's JWT must be AAL2 (password + authenticator code) to touch rows that
-- aren't their own. Restrictive policies are ANDed with the existing
-- permissive ones, so this never grants new access. It only narrows it.
--
-- Unaffected:
--   • Non-admin users (iPad / ArcRemote customers): the check passes.
--   • An admin's OWN rows (their profile, vehicles, logs, the build line and
--     company of their own van), so a builder using the iPad app with their
--     admin login keeps working without MFA.
--   • service_role (Edge Functions, Cerbo ingest): it bypasses RLS.
--
-- ROLLOUT ORDER (important — running this first locks admins out of data):
--   1. Supabase Dashboard → Authentication → Multi-Factor: TOTP enabled
--      (enroll + verify).
--   2. Deploy the portal (the MFA screen ships with this migration).
--   3. Have every admin sign in once and enroll an authenticator.
--   4. Run the PRE-FLIGHT query below; confirm RLS is ON for every table.
--   5. Run this file in the SQL editor.
--
-- PRE-FLIGHT — RLS must be enabled or the restrictive policy does nothing:
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relname in (
--     'profiles','vehicles','subscriptions','daily_summaries','system_logs',
--     'device_control_logs','trips','trip_points','company_admins','companies',
--     'company_codes','build_lines','build_line_systems','vehicle_documents',
--     'company_manuals');
--
-- ROLLBACK (drops only what this file adds):
--   do $$ declare t text; begin
--     for t in select tablename from pg_policies
--              where schemaname = 'public' and policyname = 'admin_requires_mfa'
--     loop execute format('drop policy admin_requires_mfa on public.%I', t); end loop;
--   end $$;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they read profiles / company_admins / vehicles without
-- re-entering RLS (avoids policy recursion).

create or replace function public.is_portal_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_admin is true)
      or exists (select 1 from public.company_admins
                 where user_id = auth.uid());
$$;

-- True when the caller may use admin reach: either not an admin at all, or an
-- admin whose session passed the second factor.
create or replace function public.admin_mfa_satisfied()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not public.is_portal_admin();
$$;

-- The caller's own vehicles / build lines / companies (the iPad path).
create or replace function public.my_vehicle_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select id from public.vehicles where user_id = auth.uid();
$$;

create or replace function public.my_build_line_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select build_line_id from public.vehicles
  where user_id = auth.uid() and build_line_id is not null;
$$;

create or replace function public.my_company_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select bl.company_id from public.build_lines bl
  where bl.id in (select public.my_build_line_ids());
$$;

revoke all on function public.is_portal_admin(),
                       public.admin_mfa_satisfied(),
                       public.my_vehicle_ids(),
                       public.my_build_line_ids(),
                       public.my_company_ids() from public;
grant execute on function public.is_portal_admin(),
                          public.admin_mfa_satisfied(),
                          public.my_vehicle_ids(),
                          public.my_build_line_ids(),
                          public.my_company_ids() to authenticated;

-- ── Restrictive policies ────────────────────────────────────────────────────
-- Each entry: table → "this row is the caller's own" expression. Tables that
-- don't exist, or don't have the referenced column, are skipped with a NOTICE
-- rather than failing the whole migration.

do $$
declare
  r record;
  own text;
begin
  for r in select * from (values
    ('profiles',            'id = (select auth.uid())'),
    ('vehicles',            'user_id = (select auth.uid())'),
    ('subscriptions',       'user_id = (select auth.uid())'),
    ('daily_summaries',     'user_id = (select auth.uid())'),
    ('system_logs',         'user_id = (select auth.uid())'),
    ('device_control_logs', 'user_id = (select auth.uid())'),
    ('trips',               'user_id = (select auth.uid())'),
    ('trip_points',         'trip_id in (select id from public.trips where user_id = (select auth.uid()))'),
    ('company_admins',      'user_id = (select auth.uid())'),
    ('build_lines',         'id in (select public.my_build_line_ids())'),
    ('build_line_systems',  'build_line_id in (select public.my_build_line_ids())'),
    ('vehicle_documents',   'vehicle_id in (select public.my_vehicle_ids()) or build_line_id in (select public.my_build_line_ids())'),
    ('company_manuals',     'company_id in (select public.my_company_ids())'),
    ('companies',           'id in (select public.my_company_ids())'),
    ('company_codes',       'false')
  ) as t(tbl, own_expr)
  loop
    if to_regclass('public.' || r.tbl) is null then
      raise notice 'skip %: table not found', r.tbl;
      continue;
    end if;

    if not (select relrowsecurity from pg_class where oid = ('public.' || r.tbl)::regclass) then
      raise warning '%: RLS is DISABLED — this policy has no effect until RLS is enabled', r.tbl;
    end if;

    own := r.own_expr;
    begin
      execute format('drop policy if exists admin_requires_mfa on public.%I', r.tbl);
      execute format(
        'create policy admin_requires_mfa on public.%I as restrictive for all to authenticated '
        'using ((select public.admin_mfa_satisfied()) or (%s)) '
        'with check ((select public.admin_mfa_satisfied()) or (%s))',
        r.tbl, own, own);
    exception when undefined_column or datatype_mismatch or undefined_function then
      raise notice 'skip %: %', r.tbl, sqlerrm;
    end;
  end loop;
end $$;
