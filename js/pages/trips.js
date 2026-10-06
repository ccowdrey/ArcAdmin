// ArcAdmin — Trips Page
// ======================
// 2026-04-23 lean rewrite for new design. Clicking a row replays the trip's
// breadcrumb route on an inline Leaflet map below the list (showRoute). The
// map area always reports what happened — loading, point count, "no points",
// or the fetch error — so a trip with no drawable route is never silent.

const TripsPage = {
  trips: [],
  filtered: [],

  async load() {
    const listEl = document.getElementById('tripsList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading trips...</div>';

    try {
      const trips = await supa(
        `trips?select=*,profiles(email,first_name,last_name)&order=started_at.desc&limit=200`
      );
      this.trips = trips;
      this._searchQ = '';
      this._dayFilter = '';
      this.filtered = trips;
      this.render();
    } catch (e) {
      // Surface the real error instead of masking every failure as "empty".
      // A successful-but-empty result is NOT an error and never reaches here —
      // it renders the normal empty state in render(). So an error card here
      // means a genuine fetch failure (e.g. PGRST200 = missing trips↔profiles
      // FK, PGRST205 = table missing, 401/403 = auth/RLS) and the message says
      // which — rather than the old catch-all that hid the cause.
      console.error('Trips fetch failed:', e);
      this.trips = [];
      this.filtered = [];
      if (listEl) {
        listEl.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 20px">
            <div style="font-size:32px;margin-bottom:12px">⚠️</div>
            <div class="t-body" style="margin-bottom:6px">Couldn't load trips</div>
            <div class="t-detail t-muted" style="word-break:break-word">${escHtml(e.message || String(e))}</div>
          </div>
        `;
      }
    }
  },

  render() {
    const listEl = document.getElementById('tripsList');
    if (!listEl) return;

    // The route map lives inside listEl; re-rendering the list (e.g. on search)
    // detaches its DOM node, so drop any stale Leaflet instance — it's recreated
    // when a row is next clicked.
    if (this._map) { this._map.remove(); this._map = null; this._mapLayers = []; }

    const trips = this.filtered;
    const totalKm = trips.reduce((sum, t) => sum + (t.distance_km || 0), 0);
    const totalSeconds = trips.reduce((sum, t) => sum + (t.duration_seconds || 0), 0);
    const uniqueDrivers = new Set(trips.map((t) => t.user_id)).size;

    const statsMarkup = `
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${trips.length}</span>
            <span class="stat-tile-label t-muted">Trips</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${(totalKm * 0.621371).toFixed(0)}</span>
            <span class="stat-tile-label t-muted">Total miles</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${this._formatDuration(totalSeconds)}</span>
            <span class="stat-tile-label t-muted">Drive time</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${uniqueDrivers}</span>
            <span class="stat-tile-label t-muted">Drivers</span>
          </div>
        </div>
      </div>
    `;

    const days = this._tripDays();
    const dayOptions = ['<option value="">All days</option>']
      .concat(days.map((d) => `<option value="${d}"${d === this._dayFilter ? ' selected' : ''}>${escHtml(this._dayLabel(d))}</option>`))
      .join('');
    const searchMarkup = `
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <div class="search-input" style="flex:1 1 260px;margin-bottom:0">
          <input type="text" id="tripsSearch" value="${escHtml(this._searchQ || '')}" placeholder="Search by driver, email, or location" oninput="TripsPage.filter()">
          <div class="search-input-icon">
            <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
        </div>
        <select id="tripsDay" onchange="TripsPage.setDay(this.value)" style="padding:10px 12px;border-radius:8px;min-width:150px">
          ${dayOptions}
        </select>
      </div>
    `;

    if (trips.length === 0) {
      listEl.innerHTML = `${statsMarkup}${searchMarkup}<div class="data-empty">No trips match.</div>`;
      this._restoreSearchFocus();
      return;
    }

    const rows = trips.map((t) => {
      const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.trim() || t.profiles?.email || '—';
      const startLoc = t.start_location_name || (t.start_lat != null ? `${t.start_lat.toFixed(2)}, ${t.start_lng.toFixed(2)}` : '—');
      const endLoc = t.end_location_name || (t.end_lat != null ? `${t.end_lat.toFixed(2)}, ${t.end_lng.toFixed(2)}` : '—');
      const dist = t.distance_km ? (t.distance_km * 0.621371).toFixed(1) + ' mi' : '—';
      // Breadcrumb count from the trip summary. A trip showing 0 / — here has
      // no route to draw (its points never reached trip_points), which is the
      // common reason a row "does nothing" when clicked.
      const pts = t.point_count != null ? `${t.point_count} pts` : '— pts';
      const duration = this._formatDuration(t.duration_seconds);

      return `
        <div class="data-table-row" data-trip-id="${t.id}" style="cursor:pointer" onclick="TripsPage.showRoute('${t.id}')">
          <div class="data-table-cell data-table-cell--bold col-name">${escHtml(name)}</div>
          <div class="data-table-cell col-email t-muted">${escHtml(startLoc)} → ${escHtml(endLoc)}</div>
          <div class="data-table-cell col-vehicle t-muted">${dist} <span class="t-detail">· ${pts}</span></div>
          <div class="data-table-cell col-tier t-muted">${duration}</div>
          <div class="data-table-cell col-last-active t-muted">${escHtml(t.started_at ? formatDate(t.started_at) : '—')}</div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = `
      ${statsMarkup}
      ${searchMarkup}
      <div class="data-table">
        <div class="data-table-headers">
          <div class="data-table-header col-name">Driver</div>
          <div class="data-table-header col-email">Route</div>
          <div class="data-table-header col-vehicle">Distance</div>
          <div class="data-table-header col-tier">Duration</div>
          <div class="data-table-header col-last-active">Date</div>
        </div>
        ${rows}
      </div>
      <div id="tripsMapWrap" style="display:none;margin-top:20px">
        <div class="t-muted t-detail" style="margin-bottom:8px">Route — colored by speed. Tap any point for exact mph + time.</div>
        <div id="tripsRouteStatus" class="t-detail t-muted" style="display:none;margin-bottom:8px"></div>
        <div id="tripsMap" style="height:380px;border-radius:8px;overflow:hidden;border:1px solid var(--border-subtle)"></div>
        ${tripSpeedLegendHtml()}
      </div>
    `;
    this._restoreSearchFocus();
  },

  // The innerHTML rebuild on each keystroke drops input focus; restore it so
  // typing in the search box stays smooth.
  _restoreSearchFocus() {
    if (!this._searchQ) return;
    const inp = document.getElementById('tripsSearch');
    if (inp) {
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
    }
  },

  // Replay a trip's breadcrumb route on an inline Leaflet map. OpenStreetMap
  // tiles are the only tile host the site CSP (vercel.json) allows.
  async showRoute(tripId) {
    const wrap = document.getElementById('tripsMapWrap');
    const mapEl = document.getElementById('tripsMap');
    if (!wrap || !mapEl || typeof L === 'undefined') return;
    wrap.style.display = 'block';
    this._selectRow(tripId);
    this._setRouteStatus('Loading route…');
    // The map sits below a list of up to 200 rows. Scroll to it immediately
    // (not only after points arrive) so a click near the top of the list
    // visibly does something even when the route turns out to be empty.
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Drop a cached map bound to a detached container (after a re-render/nav),
    // otherwise it renders into a removed node.
    if (this._map && this._map.getContainer() !== mapEl) {
      try { this._map.remove(); } catch (e) {}
      this._map = null;
      this._mapLayers = [];
    }
    if (!this._map) {
      this._map = L.map(mapEl, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(this._map);
    }
    if (this._mapLayers) this._mapLayers.forEach((l) => this._map.removeLayer(l));
    this._mapLayers = [];

    // Tag this request so a newer click (or a re-render that tore the map
    // down while we were fetching) can't draw stale points into the wrong map.
    const reqId = (this._routeReq = (this._routeReq || 0) + 1);
    try {
      // Page past the 1000-row API cap so long trips draw in full.
      const points = await supaAll(
        `trip_points?trip_id=eq.${tripId}&order=timestamp.asc&select=latitude,longitude,speed,timestamp`
      );
      if (reqId !== this._routeReq) return;
      if (!this._map || this._map.getContainer() !== document.getElementById('tripsMap')) return;

      if (!points || points.length === 0) {
        this._map.setView([39.5, -98.35], 4);
        setTimeout(() => this._map.invalidateSize(), 50);
        // Tell the two "empty" cases apart. The trips row carries point_count
        // (written by the recorder / ingest function from the points it stored):
        //  - point_count > 0 but nothing came back → the points exist and this
        //    account can't read them: the trip_points SELECT policy (RLS) only
        //    grants the trip's owner. See supabase/migration_trip_points_admin_read.sql.
        //  - point_count 0 / null → the breadcrumbs were never written, so there
        //    is genuinely no route (recorder/ingest problem, not an admin one).
        const trip = this.trips.find((t) => t.id === tripId);
        const reported = trip && trip.point_count != null ? Number(trip.point_count) : 0;
        if (reported > 0) {
          this._setRouteStatus(
            `This trip has ${reported.toLocaleString()} recorded GPS points, but none were returned to this account. ` +
            `Admin reads of trip_points are being blocked — check the trip_points SELECT policy (RLS).`,
            'error');
        } else {
          this._setRouteStatus(
            'No GPS points were stored for this trip, so there is no route to draw. ' +
            'The trip summary exists but its breadcrumbs never reached trip_points.',
            'error');
        }
        return;
      }

      // Speed-graded route + tappable per-interval speed points.
      this._mapLayers = drawTripRoute(this._map, points);
      setTimeout(() => this._map.invalidateSize(), 50);
      this._setRouteStatus(`${points.length.toLocaleString()} GPS points`);
    } catch (e) {
      console.error('Trip route load failed:', e);
      if (reqId !== this._routeReq) return;
      this._setRouteStatus(`Couldn't load route: ${e.message || e}`, 'error');
    }
  },

  // Status line above the map: loading / point count / why there's no route.
  _setRouteStatus(msg, kind) {
    const el = document.getElementById('tripsRouteStatus');
    if (!el) return;
    el.className = `t-detail ${kind === 'error' ? 't-danger' : 't-muted'}`;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  },

  _selectRow(tripId) {
    document.querySelectorAll('#tripsList .data-table-row[data-trip-id]').forEach((row) => {
      row.classList.toggle('data-table-row--selected', row.dataset.tripId === tripId);
    });
  },

  filter() {
    this._searchQ = document.getElementById('tripsSearch')?.value || '';
    this.applyFilters();
  },

  setDay(day) {
    this._dayFilter = day || '';
    this.applyFilters();
  },

  applyFilters() {
    const q = (this._searchQ || '').toLowerCase();
    const day = this._dayFilter || '';
    this.filtered = this.trips.filter((t) => {
      if (day && this._dayKey(t.started_at) !== day) return false;
      if (!q) return true;
      const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.toLowerCase();
      const email = (t.profiles?.email || '').toLowerCase();
      const start = (t.start_location_name || '').toLowerCase();
      const end = (t.end_location_name || '').toLowerCase();
      return name.includes(q) || email.includes(q) || start.includes(q) || end.includes(q);
    });
    this.render();
  },

  // Distinct local-day keys ('YYYY-MM-DD') present in the loaded trips, newest first.
  _tripDays() {
    const seen = {};
    for (const t of this.trips) {
      const k = this._dayKey(t.started_at);
      if (k) seen[k] = true;
    }
    return Object.keys(seen).sort().reverse();
  },

  _dayKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  _dayLabel(key) {
    const [y, m, day] = key.split('-').map(Number);
    if (!y || !m || !day) return key;
    const date = new Date(y, m - 1, day);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - date) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (date.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(undefined, opts);
  },

  _formatDuration(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },
};

window.TripsPage = TripsPage;
