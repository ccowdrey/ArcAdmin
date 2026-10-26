-- ArcNode Admin — Support staff: read-only Clients and vehicle details
-- ====================================================================
-- Builder support staff (support_members rows) can look up their company's
-- clients and the vehicle detail page: profile, subscription, vehicle,
-- telemetry (system_logs), device logger (device_control_logs) and trips.
-- Read only: this file adds SELECT policies and nothing else, so they still
-- can't edit articles, build lines, admins, tiers or vehicle settings.
--
-- "Their company's clients" matches the Clients page for builder admins:
-- profiles.company_id is the company, or the user owns a vehicle on one of
-- the company's build lines.
--
-- Two-factor: is_portal_admin() now counts support members, so the existing
-- admin_requires_mfa policies (migration_admin_mfa.sql) make them use an AAL2
-- session for anyone's rows but their own, the same as builder admins.
--
-- Run in the Supabase SQL editor after migration_support_members.sql.
-- Re-runnable.
--
-- ROLLBACK:
--   do $$ declare t text; begin
--     for t in select tablename from pg_policies
--              where schemaname = 'public' and policyname = 'support_member_read_clients'
--     loop execute format('drop policy support_member_read_clients on public.%I', t); end loop;
--   end $$;
--   drop function if exists public.support_member_client_ids();
--   then re-run migration_admin_mfa.sql's is_portal_admin() definition.

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.is_portal_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_admin is true)
      or exists (select 1 from public.company_admins
                 where user_id = auth.uid())
      or exists (select 1 from public.support_members
                 where user_id = auth.uid());
$$;

-- User ids of the caller's company clients, for support members only
-- (empty for everyone else).
create or replace function public.support_member_client_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  join public.support_members sm on sm.company_id = p.company_id
  where sm.user_id = auth.uid()
  union
  select v.user_id
  from public.vehicles v
  join public.build_lines bl on bl.id = v.build_line_id
  join public.support_members sm on sm.company_id = bl.company_id
  where sm.user_id = auth.uid() and v.user_id is not null;
$$;

revoke all on function public.support_member_client_ids() from public;
grant execute on function public.support_member_client_ids() to authenticated;

-- ── Read policies ───────────────────────────────────────────────────────────
-- Each entry: table → "this row belongs to one of my company's clients".
-- Missing tables are skipped with a NOTICE.

do $$
declare
  r record;
begin
  for r in select * from (values
    ('profiles',            'id in (select public.support_member_client_ids())'),
    ('subscriptions',       'user_id in (select public.support_member_client_ids())'),
    ('vehicles',            'user_id in (select public.support_member_client_ids())'),
    ('system_logs',         'user_id in (select public.support_member_client_ids())'),
    ('device_control_logs', 'user_id in (select public.support_member_client_ids())'),
    ('trips',               'user_id in (select public.support_member_client_ids())'),
    ('trip_points',         'trip_id in (select t.id from public.trips t
                               where t.user_id in (select public.support_member_client_ids()))')
  ) as x(tbl, expr)
  loop
    if to_regclass('public.' || r.tbl) is null then
      raise notice 'skipping %, table not found', r.tbl;
      continue;
    end if;
    execute format('drop policy if exists support_member_read_clients on public.%I', r.tbl);
    execute format(
      'create policy support_member_read_clients on public.%I for select to authenticated '
      'using (public.support_is_member() and (%s))', r.tbl, r.expr);
  end loop;
end $$;
