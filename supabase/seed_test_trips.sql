-- Seed test trips for the ArcAdmin Trips views (global Trips tab + the
-- per-customer Trips card on the user detail page).
--
-- Run in the Supabase SQL editor. The editor runs as a privileged role and
-- bypasses RLS, so these inserts succeed regardless of the trips policies.
--
-- By default this attaches two demo trips (yesterday + today) to the NEWEST
-- profile. To target a specific customer instead, first find their id:
--     select id, email from profiles order by created_at desc limit 20;
-- then replace the `select id ... limit 1` line below with:
--     v_user := '<paste-user-id>';

do $$
declare
  v_user  uuid;
  v_trip  uuid;
  v_start timestamptz;
  trip_idx int;
  i int;
  n int := 40;                       -- points per trip
  lat0 double precision; lon0 double precision;
  lat1 double precision; lon1 double precision;
  frac double precision;
begin
  select id into v_user from profiles order by created_at desc nulls last limit 1;
  if v_user is null then
    raise exception 'No profiles found to attach seed trips to';
  end if;

  for trip_idx in 0..1 loop
    v_trip  := gen_random_uuid();
    v_start := date_trunc('hour', now()) - (trip_idx || ' day')::interval - interval '2 hour';

    -- Aspen -> Glenwood Springs descent (matches ColoradoMountains.gpx theme)
    lat0 := 39.1911; lon0 := -106.8175;
    lat1 := 39.5505; lon1 := -107.3248;

    insert into trips (
      id, user_id, started_at, ended_at, distance_km, duration_seconds,
      point_count, avg_speed_kmh, max_speed_kmh,
      start_location_name, end_location_name,
      start_lat, start_lng, end_lat, end_lng
    ) values (
      v_trip, v_user, v_start, v_start + interval '45 min', 68.4, 2700,
      n, 91.2, 108.5,
      'Aspen, CO', 'Glenwood Springs, CO',
      lat0, lon0, lat1, lon1
    );

    for i in 0..n-1 loop
      frac := i::double precision / (n - 1);
      insert into trip_points (
        trip_id, timestamp, latitude, longitude, speed, altitude, heading,
        accuracy, battery_soc, solar_power, alternator_power
      ) values (
        v_trip,
        v_start + (frac * 2700 || ' seconds')::interval,
        lat0 + (lat1 - lat0) * frac + sin(frac * 12) * 0.004,
        lon0 + (lon1 - lon0) * frac + cos(frac * 10) * 0.004,
        22 + 6 * sin(frac * 8),          -- speed (m/s)
        2400 - 1600 * frac,              -- altitude (descending)
        240 + 20 * sin(frac * 6),        -- heading
        5,                               -- accuracy (m)
        88 - 10 * frac,                  -- battery SOC drifting down
        300 + 250 * sin(frac * 3),       -- solar power
        900 + 200 * sin(frac * 5)        -- alternator power
      );
    end loop;
  end loop;

  raise notice 'Seeded 2 test trips (% points each) for user %', n, v_user;
end $$;

-- To remove seed data later (deletes ONLY the Aspen->Glenwood demo trips):
--   delete from trips where start_location_name = 'Aspen, CO'
--                       and end_location_name = 'Glenwood Springs, CO';
--   (trip_points cascade if the FK is ON DELETE CASCADE; otherwise delete
--    trip_points for those trip ids first.)
