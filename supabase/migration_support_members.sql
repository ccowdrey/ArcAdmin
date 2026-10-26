-- ArcNode Admin — Support Desk: builder support staff (Support tab only)
-- ======================================================================
-- Why a separate table: the existing builder policies (build_lines,
-- build_line_systems, company_manuals, company_codes, profiles, chat_*,
-- device_control_logs, company_admins itself) admit ANY company_admins row
-- for the company without checking its role. A "support" role inside
-- company_admins would therefore get owner-level API access, including
-- editing company_admins rows to promote itself. Support staff live here
-- instead, and only the Support Desk helpers and the portal login read this
-- table, so none of those policies ever match them.
--
-- Builder member = a support_members row. Builder admin = company_admins
-- owner/admin (unchanged). Arc staff = profiles.is_admin (unchanged).
--
-- Run in the Supabase SQL editor after migration_support_desk.sql. Re-runnable.
--
-- Add someone (Arc staff, SQL editor). They need an ArcNode login first
-- (invite them from Supabase Auth, or have them sign up):
--   insert into public.support_members (user_id, company_id)
--   select u.id, c.id from auth.users u, public.companies c
--   where lower(u.email) = lower('person@builder.com') and c.name = 'Builder name';
-- Remove: delete from public.support_members where user_id = '<uuid>';
--
-- ROLLBACK: drop table public.support_members cascade; then re-run
-- migration_support_desk.sql to restore the original helpers.

create table if not exists public.support_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists support_members_company on public.support_members (company_id);

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Same names as migration_support_desk.sql, so its policies pick these up.

create or replace function public.support_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.support_members where user_id = auth.uid());
$$;

-- A company_admins row wins if someone has both.
create or replace function public.support_my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select company_id from public.company_admins
     where user_id = auth.uid() order by created_at nulls last limit 1),
    (select company_id from public.support_members where user_id = auth.uid()));
$$;

-- Builder admins are owner/admin rows in company_admins. Support members are
-- never builder admins, so builder-only articles stay hidden from them.
create or replace function public.support_is_builder_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.support_is_arc_staff()
      or exists (select 1 from public.company_admins
                 where user_id = auth.uid()
                   and coalesce(role, 'admin') in ('owner', 'admin'));
$$;

create or replace function public.support_is_portal_user()
returns boolean language sql stable security definer set search_path = public as $$
  select public.support_is_arc_staff()
      or exists (select 1 from public.company_admins where user_id = auth.uid())
      or public.support_is_member();
$$;

-- admin_mfa_satisfied() only knows portal admins, so it would let a support
-- member through on a password-only session. Support tables use this instead.
create or replace function public.support_mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select public.admin_mfa_satisfied()
     and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' or not public.support_is_member());
$$;

revoke all on function public.support_is_member(), public.support_mfa_satisfied() from public;
grant execute on function public.support_is_member(), public.support_my_company(),
                          public.support_is_builder_admin(), public.support_is_portal_user(),
                          public.support_mfa_satisfied() to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.support_members enable row level security;

drop policy if exists support_members_read   on public.support_members;
drop policy if exists support_members_manage on public.support_members;

-- Members see their own row (the portal login reads it); builder admins see
-- their company's support staff; Arc staff see all.
create policy support_members_read on public.support_members for select to authenticated
  using (user_id = auth.uid()
         or public.support_is_arc_staff()
         or (public.support_is_builder_admin() and company_id = public.support_my_company()));
-- Only Arc staff add or remove support staff for now.
create policy support_members_manage on public.support_members for all to authenticated
  using (public.support_is_arc_staff()) with check (public.support_is_arc_staff());

do $$
declare t text;
begin
  foreach t in array array['support_members','kb_articles','kb_article_revisions','support_calls','kb_search_misses'] loop
    execute format('drop policy if exists admin_requires_mfa on public.%I', t);
    execute format(
      'create policy admin_requires_mfa on public.%I as restrictive for all to authenticated '
      'using ((select public.support_mfa_satisfied())) '
      'with check ((select public.support_mfa_satisfied()))', t);
  end loop;
end $$;

grant select, insert, update, delete on public.support_members to authenticated;
