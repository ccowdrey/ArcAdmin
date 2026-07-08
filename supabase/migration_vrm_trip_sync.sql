-- VRM trip sync — schema for pulling GPS tracks from Victron VRM into trips.
-- Run in the Supabase SQL editor. Pairs with the vrm-trip-sync Edge Function.

-- Per-vehicle VRM installation id (the number in the VRM URL: /installation/<id>/).
alter table vehicles add column if not exists vrm_site_id bigint;

-- Provenance so builders know where each trip / point came from.
alter table trips       add column if not exists source text;   -- 'ipad' | 'vrm'
alter table trip_points add column if not exists source text;   -- 'cerbo_gps' | 'ipad' | 'vrm'

-- Idempotent upserts for VRM-sourced trips: one trip per (vehicle, start).
create unique index if not exists trips_vrm_uident
  on trips(vehicle_id, started_at)
  where source = 'vrm';

-- Track the last VRM timestamp synced per vehicle so each run only pulls new data.
create table if not exists vrm_sync_state (
  vehicle_id     uuid primary key references vehicles(id) on delete cascade,
  last_synced_at timestamptz,   -- newest track time we've imported
  last_run_at    timestamptz,   -- when the sync last executed
  last_error     text,
  updated_at     timestamptz default now()
);

-- Per-vehicle VRM token store (used only if not relying on a single builder
-- token supplied via the VRM_API_TOKEN function secret). Service-role only:
-- RLS enabled with NO policies, so anon/authenticated clients cannot read tokens.
create table if not exists vrm_credentials (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  vrm_token  text not null,
  updated_at timestamptz default now()
);

alter table vrm_sync_state  enable row level security;
alter table vrm_credentials enable row level security;
-- (Intentionally no policies: only the service_role / Edge Function reads these.)
