# Testing the Trips feature

End-to-end path: **iPad records a trip → syncs to Supabase (`trips`/`trip_points`)
→ shows in the iPad Trip History tab and in ArcAdmin.**

The blocker for desk testing is that trips normally auto-start only when the
alternator reads >50 W (i.e. you're actually driving). Two ways around that:

1. **iPad manual QA control** — record a real trip on demand with simulated GPS.
2. **Supabase seed script** — populate `trips`/`trip_points` directly so the
   ArcAdmin views can be tested without the iPad at all.

---

## A. Test ArcAdmin now (no iPad needed)

1. Run `supabase/seed_test_trips.sql` in the Supabase SQL editor. It attaches two
   demo trips (Aspen → Glenwood Springs) to the newest profile — or edit it to
   target a specific customer's `user_id`.
2. Open the ArcAdmin **preview deploy** for this branch (Vercel builds one per
   branch/PR).
3. Sign in as a **super admin** and check:
   - **Trips tab** (sidebar) — the two seeded trips appear with miles/duration.
   - **A customer → user detail → Trips card** — day picker shows Today/Yesterday;
     picking a day lists that day's trips; tapping a trip replays its route on the
     map (OpenStreetMap tiles — the only tile host the site CSP allows).

> **Company-admin note:** a company admin will see the Trips card render but get
> **no rows**, because the `trips` RLS only grants "own" + `is_admin` today. To
> let builders see their customers' trips, add the company-scoped SELECT policy
> (see the PR description / handoff notes). Test that with a company-admin login
> only after that policy is in place.

---

## B. Test the iPad recorder (real end-to-end)

Requires Xcode + a signed-in Supabase session in the app.

1. Build & run (device or simulator). The app must be **signed in** — trip sync
   is skipped with no auth session.
2. Turn on **Builder Mode** (Settings). This reveals the QA record control.
3. Go to **Trips tab → Trip History**.
4. Simulate movement: Xcode **Debug → Simulate Location** → pick a moving route
   (e.g. "City Run" / "Freeway Drive"), or add `ColoradoMountains.gpx` to the
   scheme's location options.
5. Tap **Start Recording (QA)**. Let it run **≥ 2 minutes** and accumulate
   **≥ 5 points** (one every 15 s) — trips shorter than that are discarded by
   design. The "Recording… N points" banner shows progress.
6. Tap **Stop Recording**. The trip should:
   - appear in the Trip History list grouped under Today, with a replayed route
     and distance/duration/speed/battery stats;
   - sync to Supabase — confirm in the SQL editor:
     `select * from trips order by started_at desc limit 5;`
   - then show up in ArcAdmin (step A).

### Testing background recording
With the `location` background mode now in the Info.plist, background recording
requires **Always** location permission. Grant it when prompted, then background
the app mid-recording and confirm points keep accumulating.

---

## Trip is listed but clicking it shows no route

The status line above the map says why:

- **"Couldn't load route: …"** — the `trip_points` request failed; the message
  carries the API error.
- **"No route stored for this trip … the trip synced, its breadcrumbs did
  not"** — the trip summary row exists (with the recorder's point count) but
  no rows landed in `trip_points`. Admins can read all trip points (policy
  "Admins can read all trip points"), so this is a recorder-side upload
  failure, not permissions. As of 2026-10-06 every Cerbo trip stores all its
  points and every iPad trip stores none, so the iPad's trip-point sync is
  the thing to fix. `supabase/diagnose_trip_routes.sql` lists affected trips
  and the constraints the iPad's insert must satisfy; the failing request is
  in Supabase → Logs → API, path `/rest/v1/trip_points`, status ≥ 400.

> The company-admin note above is out of date: `trips_company_admin_read` and
> `trip_points_company_admin_read` now exist, so company admins see their
> customers' trips and routes.

> **Root cause of the iPad gap (2026-10-06):** stationary re-captures of the
> same GPS fix gave points identical timestamps, and the `(trip_id, timestamp)`
> unique index rejected the iPad's single-batch insert. Fixed in ArcOS-iPad
> (`TripRecorderService`): dedupe before upload, upsert with ignoreDuplicates,
> rows tagged `source = 'ipad'`. Trips synced before that build keep no route.

## What to watch for
- **App launches clean.** The recorder sets `allowsBackgroundLocationUpdates`
  only when the `location` background mode is declared — verify no launch crash.
- **Auto-detection threshold.** On a real drive, confirm a trip auto-starts when
  the alternator estimate crosses 50 W. If some rigs read low, the threshold may
  need tuning or a GPS-speed fallback.
- **Map tiles render.** ArcAdmin route maps must use OpenStreetMap tiles; other
  providers are blocked by the CSP in `vercel.json`.
