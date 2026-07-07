-- Add vehicle_id to trips so admin surfaces can scope by vehicle (matching
-- device_control_logs / live_status / device_state, which are vehicle-keyed).
-- The iPad stamps vehicle_id on new trips after this column exists; this
-- migration also backfills existing trips.
--
-- Run in the Supabase SQL editor.

alter table trips add column if not exists vehicle_id uuid references vehicles(id);
create index if not exists trips_vehicle_id_idx on trips(vehicle_id);

-- Backfill: attach each existing trip to its owner's canonical (oldest)
-- vehicle — the same rule the app's fetchVehicleId uses.
update trips t
set vehicle_id = v.id
from (
  select distinct on (user_id) user_id, id
  from vehicles
  order by user_id, created_at asc nulls last
) v
where t.user_id = v.user_id
  and t.vehicle_id is null;

-- Verify:
--   select count(*) filter (where vehicle_id is null) as unassigned,
--          count(*) as total
--   from trips;
