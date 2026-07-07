-- Support for the ingest-trip-gps Edge Function (Cerbo GPS trip capture).
-- The function upserts points idempotently on (trip_id, timestamp); this
-- unique index makes that possible and prevents duplicate breadcrumbs on
-- batch retries. Run in the Supabase SQL editor.
--
-- If this index fails to create because legacy rows already share a
-- (trip_id, timestamp), de-duplicate first:
--   delete from trip_points a using trip_points b
--   where a.ctid < b.ctid and a.trip_id = b.trip_id and a.timestamp = b.timestamp;
create unique index if not exists trip_points_trip_ts_uident
  on trip_points(trip_id, timestamp);
