// ArcAdmin — Trips Page
// ======================
// 2026-04-23 lean rewrite for new design. List view only in this cut —
// the leaflet map + timeline detail panel from the legacy build is deferred
// until there's a proper /trips/:id detail page to host them.

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

    const searchMarkup = `
      <div class="search-input">
        <input type="text" id="tripsSearch" placeholder="Search by driver, email, or location" oninput="TripsPage.filter()">
        <div class="search-input-icon">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
      </div>
    `;

    if (trips.length === 0) {
      listEl.innerHTML = `${statsMarkup}${searchMarkup}<div class="data-empty">No trips match.</div>`;
      return;
    }

    const rows = trips.map((t) => {
      const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.trim() || t.profiles?.email || '—';
      const startLoc = t.start_location_name || (t.start_lat != null ? `${t.start_lat.toFixed(2)}, ${t.start_lng.toFixed(2)}` : '—');
      const endLoc = t.end_location_name || (t.end_lat != null ? `${t.end_lat.toFixed(2)}, ${t.end_lng.toFixed(2)}` : '—');
      const dist = t.distance_km ? (t.distance_km * 0.621371).toFixed(1) + ' mi' : '—';
      const duration = this._formatDuration(t.duration_seconds);

      return `
        <div class="data-table-row" style="cursor:pointer" onclick="TripsPage.showRoute('${t.id}')">
          <div class="data-table-cell data-table-cell--bold col-name">${escHtml(name)}</div>
          <div class="data-table-cell col-email t-muted">${escHtml(startLoc)} → ${escHtml(endLoc)}</div>
          <div class="data-table-cell col-vehicle t-muted">${dist}</div>
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
        <div class="t-muted t-detail" style="margin-bottom:8px">Route — tap a trip above to replay it</div>
        <div id="tripsMap" style="height:380px;border-radius:8px;overflow:hidden;border:1px solid var(--border-subtle)"></div>
      </div>
    `;
  },

  // Replay a trip's breadcrumb route on an inline Leaflet map. OpenStreetMap
  // tiles are the only tile host the site CSP (vercel.json) allows.
  async showRoute(tripId) {
    const wrap = document.getElementById('tripsMapWrap');
    const mapEl = document.getElementById('tripsMap');
    if (!wrap || !mapEl || typeof L === 'undefined') return;
    wrap.style.display = 'block';

    if (!this._map) {
      this._map = L.map(mapEl, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(this._map);
    }
    if (this._mapLayers) this._mapLayers.forEach((l) => this._map.removeLayer(l));
    this._mapLayers = [];

    try {
      const points = await supa(
        `trip_points?trip_id=eq.${tripId}&order=timestamp.asc&limit=5000&select=latitude,longitude`
      );
      const coords = (points || [])
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => [p.latitude, p.longitude]);

      if (coords.length === 0) {
        this._map.setView([39.5, -98.35], 4);
        setTimeout(() => this._map.invalidateSize(), 50);
        return;
      }

      const line = L.polyline(coords, { color: '#767BFB', weight: 4, opacity: 0.9 });
      line.addTo(this._map);
      const start = L.circleMarker(coords[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2ABC53', fillOpacity: 1 }).addTo(this._map);
      const end = L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#E7B400', fillOpacity: 1 }).addTo(this._map);
      this._mapLayers.push(line, start, end);

      this._map.fitBounds(line.getBounds(), { padding: [30, 30] });
      setTimeout(() => this._map.invalidateSize(), 50);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      console.error('Trip route load failed:', e);
    }
  },

  filter() {
    const q = (document.getElementById('tripsSearch')?.value || '').toLowerCase();
    if (!q) {
      this.filtered = this.trips;
    } else {
      this.filtered = this.trips.filter((t) => {
        const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.toLowerCase();
        const email = (t.profiles?.email || '').toLowerCase();
        const start = (t.start_location_name || '').toLowerCase();
        const end = (t.end_location_name || '').toLowerCase();
        return name.includes(q) || email.includes(q) || start.includes(q) || end.includes(q);
      });
    }
    this.render();
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
