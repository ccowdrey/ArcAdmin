-- Fleet Health: one call returns, per client, their newest telemetry row and
-- a 24-hour rollup, so the Fleet Health page can run its checks without
-- fetching every client's logs one by one.
--
-- security invoker: the caller's RLS decides which clients come back, so
-- builder admins and support staff only get their own company's clients and
-- admin_requires_mfa still applies. Clients the caller can't read come back
-- with null telemetry, the same as a van that has never logged.
--
-- Returns jsonb rather than typed columns so it doesn't depend on the exact
-- column types the iPad writes into system_logs.
--
-- Run in the Supabase SQL editor.
--
-- ROLLBACK:
--   drop function if exists public.fleet_health_snapshot(uuid[]);
--   drop index if exists public.system_logs_user_logged_at_idx;

-- Both lookups below are "this user's newest rows", which this index serves.
create index if not exists system_logs_user_logged_at_idx
  on public.system_logs (user_id, logged_at desc);

create or replace function public.fleet_health_snapshot(p_user_ids uuid[])
returns table (user_id uuid, latest jsonb, last_24h jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select
    u.id,
    (
      select to_jsonb(s) - 'latitude' - 'longitude'
      from system_logs s
      where s.user_id = u.id
      order by s.logged_at desc
      limit 1
    ),
    (
      select jsonb_build_object(
        'samples',     count(*),
        'min_soc',     min(d.battery_soc),
        'min_voltage', min(nullif(d.battery_voltage, 0)),
        'max_voltage', max(d.battery_voltage),
        'max_solar',   max(d.solar_power),
        -- Gaps of more than 20 minutes between consecutive readings.
        'gaps',        count(*) filter (where d.prev_at is not null
                                          and d.logged_at - d.prev_at > interval '20 minutes')
      )
      from (
        select s.logged_at, s.battery_soc, s.battery_voltage, s.solar_power,
               lag(s.logged_at) over (order by s.logged_at) as prev_at
        from system_logs s
        where s.user_id = u.id
          and s.logged_at > now() - interval '24 hours'
      ) d
    )
  from unnest(p_user_ids) as u(id);
$$;

revoke all on function public.fleet_health_snapshot(uuid[]) from public;
grant execute on function public.fleet_health_snapshot(uuid[]) to authenticated;
