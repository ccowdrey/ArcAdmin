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
      console.warn('Trips fetch failed (table may not exist):', e);
      this.trips = [];
      this.filtered = [];
      if (listEl) {
        listEl.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 20px">
            <div style="font-size:32px;margin-bottom:12px">🚐</div>
            <div class="t-body t-muted" style="margin-bottom:6px">No trips recorded yet</div>
            <div class="t-detail t-muted">Trips will appear here once users start driving with ArcNode installed.</div>
          </div>
        `;
      }
    }
  },

  render() {
    const listEl = document.getElementById('tripsList');
    if (!listEl) return;

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
        <div class="data-table-row data-table-row--static">
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
    `;
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
