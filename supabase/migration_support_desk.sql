-- ArcNode Admin — Support Desk (troubleshooting KB, call log, support hours)
-- ==========================================================================
-- Backs the Support tab (/support, /support/calls, /support/hours, KB editor).
-- Builder support staff troubleshoot customer calls against the KB and log
-- each call; Arc staff see every builder's activity and report support hours.
--
-- Roles, mapped onto ArcAdmin's existing model (no new role columns):
--   Arc staff       profiles.is_admin = true            (portal super admin)
--   Builder admin   company_admins.role in owner/admin  (company admin)
--   Builder member  company_admins.role = 'support'     (Support tab only)
-- A user's company comes from company_admins, same as the portal's login.
-- iPad / ArcRemote customers (no company_admins row) can't read anything here.
--
-- Access (enforced here, not just in the UI):
--                 Arc staff        Builder admin            Builder member
--   Read KB       all + drafts     published + builder-only published, not builder-only
--   Edit KB       yes              no                       no
--   Log a call    any company      own company              own company
--   See calls     all              own company              own company
--   Edit a call   any              own calls                own calls
--   Search misses yes              no                       no
--
-- Content is NOT in this file. The repo is public and the KB holds the
-- Builder Mode PIN and default router / Cerbo passwords. Load articles and
-- the calls logged so far from the private handoff package's seed SQL
-- (run it in the SQL editor), or write articles in the portal's KB editor.
--
-- Run in the Supabase SQL editor after migration_admin_mfa.sql (this file
-- reuses its admin_mfa_satisfied() helper). Re-runnable.
--
-- Verify:
--   select count(*) from kb_articles;                         -- 46 after seed
--   select month, hours from support_hours_monthly order by 1; -- Oct 2026: 1.08
--
-- ROLLBACK:
--   drop view if exists public.support_hours_monthly;
--   drop table if exists public.kb_search_misses, public.support_calls,
--                        public.kb_article_revisions, public.kb_articles cascade;
--   drop function if exists public.kb_search(text,int), public.support_people(),
--     public.support_is_arc_staff(), public.support_my_company(),
--     public.support_is_builder_admin(), public.support_is_portal_user(),
--     public.support_unaccent(text), public.kb_articles_search_doc(),
--     public.kb_articles_revision(), public.support_calls_guard();

-- Supabase installs extensions into the `extensions` schema. Functions below
-- put it on their search_path so this works whether unaccent / pg_trgm were
-- already enabled in public or are created fresh here.
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;  -- "eberspacher" finds "Eberspächer"
create extension if not exists pg_trgm  with schema extensions;  -- typos: "breezonc" finds Breezonic
grant usage on schema extensions to authenticated;
set search_path = public, extensions;

-- unaccent() isn't IMMUTABLE, so it can't go in an index expression directly.
create or replace function public.support_unaccent(t text)
returns text language sql immutable parallel safe
set search_path = public, extensions
as $$ select unaccent(coalesce(t, '')) $$;

-- ── Role helpers ────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they read profiles / company_admins without re-entering
-- RLS (same pattern as migration_admin_mfa.sql).

create or replace function public.support_is_arc_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_admin is true);
$$;

create or replace function public.support_my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_admins
  where user_id = auth.uid()
  order by created_at nulls last
  limit 1;
$$;

-- Arc staff or a builder owner/admin. Rows saved before roles existed have a
-- null role and are treated as admin, matching the portal's default.
create or replace function public.support_is_builder_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.support_is_arc_staff()
      or exists (select 1 from public.company_admins
                 where user_id = auth.uid()
                   and coalesce(role, 'admin') in ('owner', 'admin'));
$$;

-- Anyone who can sign in to the portal: Arc staff or any company_admins row.
create or replace function public.support_is_portal_user()
returns boolean language sql stable security definer set search_path = public as $$
  select public.support_is_arc_staff()
      or exists (select 1 from public.company_admins where user_id = auth.uid());
$$;

revoke all on function public.support_is_arc_staff(), public.support_my_company(),
                       public.support_is_builder_admin(), public.support_is_portal_user()
  from public;
grant execute on function public.support_is_arc_staff(), public.support_my_company(),
                          public.support_is_builder_admin(), public.support_is_portal_user()
  to authenticated;

-- ===========================================================================
-- Knowledge base
-- ===========================================================================
-- All text fields are Markdown. Links to other articles use [label](kb:slug).
create table if not exists public.kb_articles (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title          text not null,
  category       text not null,
  symptom        text not null,
  keywords       text not null default '',        -- synonyms, part names, how callers phrase it
  source         text,                            -- e.g. 'User Manual v1.1', 'Support playbook'
  builder_only   boolean not null default false,  -- Builder Mode PIN, Cerbo passwords, wiring
  top_call       boolean not null default false,
  safety         boolean not null default false,
  sort_order     int not null default 1000,
  ask_first      text[] not null default '{}',
  steps          jsonb not null default '[]',     -- [{text, note, branches:[{kind:'yes'|'no'|'other', label, text}]}]
  tell_customer  text,
  escalate_when  text,
  stop_warning   text,
  related        text[] not null default '{}',    -- slugs
  status         text not null default 'published' check (status in ('draft','published','archived')),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  search_doc     tsvector
);

create or replace function public.kb_articles_search_doc() returns trigger
language plpgsql set search_path = public, extensions as $$
declare body text;
begin
  select coalesce(string_agg(
           coalesce(s->>'text','') || ' ' || coalesce(s->>'note','') || ' ' ||
           coalesce((select string_agg(coalesce(b->>'label','') || ' ' || coalesce(b->>'text',''), ' ')
                     from jsonb_array_elements(coalesce(s->'branches','[]'::jsonb)) b), ''),
         ' '), '')
    into body from jsonb_array_elements(new.steps) s;
  new.search_doc :=
      setweight(to_tsvector('english', support_unaccent(new.title)), 'A')
   || setweight(to_tsvector('english', support_unaccent(coalesce(new.keywords,'') || ' ' || new.category)), 'B')
   || setweight(to_tsvector('english', support_unaccent(coalesce(new.symptom,'') || ' ' || array_to_string(new.ask_first,' '))), 'C')
   || setweight(to_tsvector('english', support_unaccent(body || ' ' || coalesce(new.tell_customer,'') || ' ' || coalesce(new.escalate_when,''))), 'D');
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

drop trigger if exists kb_articles_search on public.kb_articles;
create trigger kb_articles_search before insert or update on public.kb_articles
  for each row execute function public.kb_articles_search_doc();
create index if not exists kb_articles_search_idx on public.kb_articles using gin (search_doc);
create index if not exists kb_articles_title_trgm on public.kb_articles using gin (title gin_trgm_ops);

-- Edit history so changes to troubleshooting steps can be reviewed or rolled back.
create table if not exists public.kb_article_revisions (
  id          bigserial primary key,
  article_id  uuid not null references public.kb_articles(id) on delete cascade,
  snapshot    jsonb not null,
  edited_by   uuid references auth.users(id) on delete set null,
  edited_at   timestamptz not null default now()
);
create index if not exists kb_article_revisions_article on public.kb_article_revisions (article_id, edited_at desc);

create or replace function public.kb_articles_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- skip no-op updates (e.g. re-running the seed)
  if (to_jsonb(old) - 'search_doc' - 'updated_at' - 'updated_by')
   = (to_jsonb(new) - 'search_doc' - 'updated_at' - 'updated_by') then
    return new;
  end if;
  insert into public.kb_article_revisions(article_id, snapshot, edited_by)
  values (old.id, to_jsonb(old) - 'search_doc', auth.uid());
  return new;
end $$;
drop trigger if exists kb_articles_rev on public.kb_articles;
create trigger kb_articles_rev after update on public.kb_articles
  for each row execute function public.kb_articles_revision();

-- Ranked search. SECURITY INVOKER, so kb_articles RLS decides what each
-- caller sees. Weights: title > keywords/category > symptom/ask-first > body.
create or replace function public.kb_search(q text, max_results int default 20)
returns table (slug text, title text, category text, symptom text,
               builder_only boolean, top_call boolean, safety boolean, rank real)
language sql stable set search_path = public, extensions as $$
  with qq as (
    select websearch_to_tsquery('english', support_unaccent(q)) as tsq,
           nullif(replace(plainto_tsquery('english', support_unaccent(q))::text, ' & ', ' | '), '')::tsquery as anyq,
           support_unaccent(lower(q)) as uq
  )
  select a.slug, a.title, a.category, a.symptom, a.builder_only, a.top_call, a.safety,
         (coalesce(ts_rank(a.search_doc, qq.anyq), 0) * 2
          + ts_rank(a.search_doc, qq.tsq) * 4
          + word_similarity(qq.uq, support_unaccent(lower(a.title || ' ' || a.keywords))))::real as rank
  from public.kb_articles a, qq
  where a.status = 'published'
    and ((qq.anyq is not null and a.search_doc @@ qq.anyq)
         or word_similarity(qq.uq, support_unaccent(lower(a.title || ' ' || a.keywords))) > 0.5)
  order by rank desc, a.top_call desc, a.sort_order
  limit greatest(1, least(coalesce(max_results, 20), 100));
$$;
grant execute on function public.kb_search(text, int) to authenticated;

-- ===========================================================================
-- Call log and search misses
-- ===========================================================================
-- FKs use ON DELETE SET NULL so deleting a vehicle, company or user (see the
-- FK cascade migrations / delete-user function) never blocks on, or erases,
-- support history. Hours stay on the books with "Someone" as the person.
create table if not exists public.support_calls (
  id            uuid primary key default gen_random_uuid(),
  called_at     timestamptz not null default now(),
  minutes       int check (minutes between 0 and 1440),
  question      text not null check (length(question) <= 4000),  -- what the caller asked, in their words
  company_id    uuid references public.companies(id) on delete set null,  -- the builder this time is billed to
  vehicle_id    uuid references public.vehicles(id) on delete set null,   -- optional
  vehicle_ref   text check (length(vehicle_ref) <= 120),         -- free-text fallback, e.g. a van number
  category      text,
  article_id    uuid references public.kb_articles(id) on delete set null,
  outcome       text not null default 'open' check (outcome in ('resolved','arc','rixens','open')),
  notes         text check (length(notes) <= 8000),
  logged_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  edited_by     uuid references auth.users(id) on delete set null,
  legacy_id     text unique                                      -- id from the Claude artifact import
);
create index if not exists support_calls_called_at on public.support_calls (called_at desc);
create index if not exists support_calls_company   on public.support_calls (company_id, called_at);
create index if not exists support_calls_logged_by on public.support_calls (logged_by, called_at);

-- Stamp edits server-side and stop builders from re-assigning who logged a
-- call (that would move hours between people). Arc staff and service_role
-- (seed / import) can set these fields directly.
create or replace function public.support_calls_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.support_is_arc_staff() then
    new.logged_by := old.logged_by;
    new.created_at := old.created_at;
    new.legacy_id := old.legacy_id;
  end if;
  if auth.uid() is not null then
    new.edited_at := now();
    new.edited_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists support_calls_guard on public.support_calls;
create trigger support_calls_guard before update on public.support_calls
  for each row execute function public.support_calls_guard();

create table if not exists public.kb_search_misses (
  id          bigserial primary key,
  query       text not null check (length(query) <= 200),
  searched_by uuid default auth.uid() references auth.users(id) on delete set null,
  company_id  uuid default public.support_my_company() references public.companies(id) on delete set null,
  searched_at timestamptz not null default now()
);

-- Hours per person, per builder, per month. Drives the Hours report.
-- security_invoker so support_calls RLS applies to whoever reads it.
create or replace view public.support_hours_monthly with (security_invoker = true) as
select date_trunc('month', called_at)::date       as month,
       logged_by,
       company_id,
       count(*)                                   as calls,
       count(minutes)                             as timed_calls,
       coalesce(sum(minutes), 0)                  as minutes,
       round(coalesce(sum(minutes), 0) / 60.0, 2) as hours
from public.support_calls
group by 1, 2, 3;

-- Display names for the people on calls the caller can see. Builders can't
-- read Arc staff profiles directly, but need "Logged by" names on their calls.
create or replace function public.support_people()
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id,
         coalesce(nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''),
                  split_part(p.email, '@', 1))
  from public.profiles p
  where public.admin_mfa_satisfied()
    and p.id in (select c.logged_by from public.support_calls c
                 where public.support_is_arc_staff()
                    or c.company_id = public.support_my_company()
                 union
                 select r.edited_by from public.kb_article_revisions r
                 where public.support_is_arc_staff());
$$;
revoke all on function public.support_people() from public;
grant execute on function public.support_people() to authenticated;

-- ===========================================================================
-- Row-level security
-- ===========================================================================
alter table public.kb_articles          enable row level security;
alter table public.kb_article_revisions enable row level security;
alter table public.support_calls        enable row level security;
alter table public.kb_search_misses     enable row level security;

drop policy if exists kb_read       on public.kb_articles;
drop policy if exists kb_write      on public.kb_articles;
drop policy if exists kb_rev_read   on public.kb_article_revisions;
drop policy if exists calls_read    on public.support_calls;
drop policy if exists calls_insert  on public.support_calls;
drop policy if exists calls_update  on public.support_calls;
drop policy if exists calls_delete  on public.support_calls;
drop policy if exists misses_insert on public.kb_search_misses;
drop policy if exists misses_read   on public.kb_search_misses;

-- KB: portal users read published articles; builder-only articles need a
-- builder admin or Arc staff. Drafts and archived articles are Arc staff only.
create policy kb_read on public.kb_articles for select to authenticated
  using (public.support_is_portal_user()
         and (status = 'published' or public.support_is_arc_staff())
         and (not builder_only or public.support_is_builder_admin()));
-- Only Arc staff create or edit articles. Widen later if builders should contribute drafts.
create policy kb_write on public.kb_articles for all to authenticated
  using (public.support_is_arc_staff()) with check (public.support_is_arc_staff());
create policy kb_rev_read on public.kb_article_revisions for select to authenticated
  using (public.support_is_arc_staff());

-- Calls: Arc staff see and edit all. Builder users see their company's calls and edit their own.
create policy calls_read on public.support_calls for select to authenticated
  using (public.support_is_arc_staff()
         or (company_id is not null and company_id = public.support_my_company()));
create policy calls_insert on public.support_calls for insert to authenticated
  with check (logged_by = auth.uid()
              and (public.support_is_arc_staff()
                   or (company_id is not null and company_id = public.support_my_company())));
create policy calls_update on public.support_calls for update to authenticated
  using (public.support_is_arc_staff()
         or (logged_by = auth.uid() and company_id = public.support_my_company()))
  with check (public.support_is_arc_staff()
              or (company_id is not null and company_id = public.support_my_company()));
create policy calls_delete on public.support_calls for delete to authenticated
  using (public.support_is_arc_staff());

create policy misses_insert on public.kb_search_misses for insert to authenticated
  with check (public.support_is_portal_user()
              and searched_by = auth.uid()
              and company_id is not distinct from public.support_my_company());
create policy misses_read on public.kb_search_misses for select to authenticated
  using (public.support_is_arc_staff());

-- Two-factor, same rule as migration_admin_mfa.sql. Everyone who can reach
-- these tables is a portal admin, so there are no "own rows" exemptions.
do $$
declare t text;
begin
  foreach t in array array['kb_articles','kb_article_revisions','support_calls','kb_search_misses'] loop
    execute format('drop policy if exists admin_requires_mfa on public.%I', t);
    execute format(
      'create policy admin_requires_mfa on public.%I as restrictive for all to authenticated '
      'using ((select public.admin_mfa_satisfied())) '
      'with check ((select public.admin_mfa_satisfied()))', t);
  end loop;
end $$;

grant select, insert, update, delete on public.kb_articles, public.support_calls to authenticated;
grant select on public.kb_article_revisions, public.support_hours_monthly to authenticated;
grant select, insert on public.kb_search_misses to authenticated;
grant usage on sequence public.kb_search_misses_id_seq to authenticated;

reset search_path;
