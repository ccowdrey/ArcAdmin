-- Why does a trip show in ArcAdmin but draw no route?
-- Read-only diagnostics for the Supabase SQL editor (runs as a privileged
-- role, so it sees past RLS and shows the ground truth).
--
-- Findings 2026-10-06: trip_points already has "Admins can read all trip
-- points" (is_admin) plus company-admin and owner SELECT policies, so RLS is
-- NOT what blocks admin reads. Trips with no route are iPad-written trips
-- (source is null, id in uppercase) whose summary row synced but whose
-- breadcrumbs never reached trip_points. Cerbo trips (source = 'cerbo_relay')
-- store every point.
--
-- Root cause (fixed in ArcOS-iPad, TripRecorderService.syncTripToSupabase):
-- the iPad re-captured the same GPS fix while stationary, producing points
-- with identical timestamps; trip_points is unique on (trip_id, timestamp)
-- (index trip_points_trip_ts_uident, added for the Cerbo ingest), and the
-- iPad sent all points in one plain INSERT, so the whole batch was rejected.
-- The iPad now de-duplicates, upserts with ignoreDuplicates, and tags rows
-- with source = 'ipad'. Trips synced before that fix stay route-less; their
-- points only ever existed on the iPad.

-- 1. Claimed vs stored points per trip. stored = 0 with point_count > 0 is a
--    trip whose breadcrumb upload failed.
select t.id, t.source, t.started_at, t.point_count,
       (select count(*) from trip_points p where p.trip_id = t.id) as stored
from trips t
order by t.started_at desc
limit 50;

-- 2. Same, iPad trips only.
select t.id, t.started_at, t.point_count, t.distance_km,
       (select count(*) from trip_points p where p.trip_id = t.id) as stored
from trips t
where t.source is null or t.source = 'ipad'
order by t.started_at desc;

-- 3. What the iPad's INSERT into trip_points has to satisfy. Any of these can
--    reject its batch: the INSERT policy's WITH CHECK, a NOT NULL column it
--    doesn't send, or the (trip_id, timestamp) unique index if two points in
--    one batch share a timestamp.
select policyname, cmd, roles, with_check
from pg_policies
where tablename = 'trip_points' and cmd = 'INSERT';

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'trip_points'
order by ordinal_position;

select indexname, indexdef
from pg_indexes
where tablename = 'trip_points';

-- 4. Policies on both tables, for reference.
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('trips', 'trip_points')
order by tablename, policyname;

-- The failing request itself is in Supabase Dashboard → Logs → API, filtered
-- to path /rest/v1/trip_points with status >= 400, around the trip's
-- started_at. The error body names the cause (23505 unique violation, 23503
-- FK, 42501 RLS, 23502 not-null).
