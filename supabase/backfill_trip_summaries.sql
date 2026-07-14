-- One-time backfill: recompute every trip's summary from its stored points.
-- Fixes trips whose summary was frozen at 1000 points by the old PostgREST
-- read cap. Deterministic + idempotent — safe to run more than once.
-- Run in the Supabase SQL editor.
--
-- Recomputes: point_count, distance_km (haversine over ordered points),
-- duration_seconds, avg/max speed (km/h), start/end lat/lng, and — for trips
-- that are already ended — sets ended_at to the last breadcrumb's real time.

with pts as (
  select
    trip_id,
    timestamp,
    latitude,
    longitude,
    speed,
    lag(latitude)  over w as plat,
    lag(longitude) over w as plon
  from trip_points
  window w as (partition by trip_id order by timestamp)
),
seg as (
  select
    trip_id, timestamp, latitude, longitude, speed,
    case
      when plat is null then 0
      else 2 * 6371 * asin(sqrt(
             power(sin(radians(latitude  - plat) / 2), 2) +
             cos(radians(plat)) * cos(radians(latitude)) *
             power(sin(radians(longitude - plon) / 2), 2)
           ))
    end as seg_km
  from pts
),
agg as (
  select
    trip_id,
    count(*)                                              as point_count,
    round(sum(seg_km)::numeric, 2)                        as distance_km,
    extract(epoch from (max(timestamp) - min(timestamp)))::int as duration_seconds,
    round((max(coalesce(speed, 0)) * 3.6)::numeric, 1)    as max_speed_kmh,
    round((coalesce(avg(speed) filter (where speed > 0), 0) * 3.6)::numeric, 1) as avg_speed_kmh,
    (array_agg(latitude  order by timestamp asc))[1]      as start_lat,
    (array_agg(longitude order by timestamp asc))[1]      as start_lng,
    (array_agg(latitude  order by timestamp desc))[1]     as end_lat,
    (array_agg(longitude order by timestamp desc))[1]     as end_lng,
    max(timestamp)                                        as last_ts
  from seg
  group by trip_id
)
update trips t
set
  point_count      = a.point_count,
  distance_km      = a.distance_km,
  duration_seconds = a.duration_seconds,
  avg_speed_kmh    = a.avg_speed_kmh,
  max_speed_kmh    = a.max_speed_kmh,
  start_lat        = a.start_lat,
  start_lng        = a.start_lng,
  end_lat          = a.end_lat,
  end_lng          = a.end_lng,
  ended_at         = case when t.ended_at is not null then a.last_ts else t.ended_at end
from agg a
where t.id = a.trip_id;

-- Spot-check the longest trips afterward:
--   select id, source, point_count, distance_km, duration_seconds, max_speed_kmh
--   from trips order by duration_seconds desc limit 10;
