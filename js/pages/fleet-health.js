// ArcAdmin — Fleet Health
// =======================
// Canned health checks across the clients this person can see (same scope
// as the Clients page). Telemetry comes from the fleet_health_snapshot RPC
// (supabase/migration_fleet_health.sql): each client's newest system_logs row
// plus a 24-hour rollup. RLS decides whose rows come back.
//
// A vehicle is Online when its newest reading is under ONLINE_MINUTES old,
// Stale up to STALE_HOURS, and Offline after that (or if it never logged).
// Health checks only run on Online vehicles.

const FLEET_ONLINE_MINUTES = 15;
const FLEET_STALE_HOURS = 24;
const FLEET_RPC_BATCH = 200;

// Thresholds are for a 12 V system; voltage limits scale for 24 V / 48 V.
// They match js/analysis.js so this page and the client page agree.
const FLEET_CHECKS = [
  {
    key: 'battery', label: 'Battery at risk',
    test: (r) => {
      const soc = fleetNum(r.latest?.battery_soc);
      if (soc == null) return null;
      if (soc < 20) return { text: `Battery ${soc.toFixed(0)}%`, rank: soc };
      if (soc < 35 && !r.charging) return { text: `Battery ${soc.toFixed(0)}%, not charging`, rank: soc };
      return null;
    },
  },
  {
    key: 'water', label: 'Low fresh water',
    test: (r) => {
      const fw = fleetNum(r.latest?.fresh_water_level);
      return fw != null && fw < 15 ? { text: `Fresh water ${fw.toFixed(0)}%`, rank: fw } : null;
    },
  },
  {
    key: 'grey', label: 'Grey tank full',
    test: (r) => {
      const g = fleetNum(r.latest?.grey_water_level);
      return g != null && g > 80 ? { text: `Grey tank ${g.toFixed(0)}%`, rank: 100 - g } : null;
    },
  },
  {
    key: 'voltage', label: 'Voltage out of range',
    test: (r) => {
      const lo = fleetNum(r.day?.min_voltage), hi = fleetNum(r.day?.max_voltage);
      const k = r.nominalV / 12;
      const parts = [];
      if (lo != null && lo < 11.8 * k) parts.push(`low ${lo.toFixed(1)} V`);
      if (hi != null && hi > 14.8 * k) parts.push(`high ${hi.toFixed(1)} V`);
      if (!parts.length) return null;
      const text = `Voltage ${parts.join(', ')} in 24 h`;
      return { text: text.charAt(0).toUpperCase() + text.slice(1), rank: lo != null ? lo / k : 0 };
    },
  },
  {
    key: 'solar', label: 'No solar',
    test: (r) => {
      // Needs ~12 h of readings so a short session doesn't look like a dead panel.
      const peak = fleetNum(r.day?.max_solar), samples = fleetNum(r.day?.samples) || 0;
      return peak != null && samples >= 48 && peak < 50
        ? { text: `Peak solar ${peak.toFixed(0)} W in 24 h`, rank: peak } : null;
    },
  },
  {
    key: 'temp', label: 'Temperature',
    test: (r) => {
      const t = fleetNum(r.latest?.ruuvi_indoor_temp_f);
      if (t == null) return null;
      if (t < 40) return { text: `Inside ${t.toFixed(0)}°F, freeze risk`, rank: t };
      if (t > 95) return { text: `Inside ${t.toFixed(0)}°F, heat risk`, rank: 200 - t };
      return null;
    },
  },
  {
    // Gaps describe the iPad's logging (it sleeps or leaves the van's Wi-Fi),
    // not the van's health, so they don't count toward "Needs attention".
    key: 'gaps', label: 'Data gaps', informational: true,
    test: (r) => {
      const g = fleetNum(r.day?.gaps) || 0;
      return g >= 3 ? { text: `${g} gaps over 20 min in 24 h`, rank: -g } : null;
    },
  },
];

const FLEET_STATUS = {
  online:  { label: 'Online',  badge: 'badge--success' },
  stale:   { label: 'Stale',   badge: 'badge--warning' },
  offline: { label: 'Offline', badge: 'badge--tier-base' },
};

function fleetNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const FleetHealthPage = {
  rows: [],
  active: 'attention',
  loadedAt: null,
  _loadSeq: 0,

  listView: new ListView({
    ref: 'FleetHealthPage.listView',
    columns: [
      { key: 'name',     label: 'Customer', cls: 'col-name',     sortValue: (r) => sortText(r.displayName) },
      { key: 'email',    label: 'Email',    cls: 'col-email',    sortValue: (r) => sortText(r.email) },
      { key: 'vehicle',  label: 'Vehicle',  cls: 'col-vehicle',  sortValue: (r) => sortText(r.vehicleLabel) },
      { key: 'status',   label: 'Status',   cls: 'col-tier',     sortValue: (r) => r.statusOrder },
      { key: 'finding',  label: 'Reading',  cls: 'col-finding',  sortValue: (r) => r.findingRank },
      { key: 'lastSeen', label: 'Last seen', cls: 'col-last-active', sortValue: (r) => sortTime(r.lastSeen), defaultDir: 'desc' },
    ],
    sortKey: 'finding',
    noun: 'vehicle',
    rowHtml: (r) => `
      <button class="data-table-row" onclick="Router.navigate('/clients/${escHtml(Router.getSlug(r.id))}')">
        <div class="data-table-cell data-table-cell--bold data-table-cell--primary col-name">${escHtml(r.displayName)}</div>
        <div class="data-table-cell col-email t-muted" data-label="Email">${escHtml(r.email || '')}</div>
        <div class="data-table-cell col-vehicle t-muted" data-label="Vehicle">${escHtml(r.vehicleLabel || '—')}</div>
        <div class="data-table-cell col-tier" data-label="Status"><span class="badge ${FLEET_STATUS[r.status].badge}">${FLEET_STATUS[r.status].label}</span></div>
        <div class="data-table-cell col-finding" data-label="Reading">${escHtml(r.findingText || '—')}</div>
        <div class="data-table-cell col-last-active t-muted" data-label="Last seen">${escHtml(r.lastSeen ? timeAgo(r.lastSeen) : 'Never')}</div>
      </button>
    `,
    onChange: () => FleetHealthPage.render(),
  }),

  async load() {
    const listEl = document.getElementById('fleetList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading fleet...</div>';
    const seq = ++this._loadSeq;

    try {
      const clients = (await fetchScopedClients()).filter((c) => c.hasVehicle);
      const snap = new Map();
      for (let i = 0; i < clients.length; i += FLEET_RPC_BATCH) {
        const ids = clients.slice(i, i + FLEET_RPC_BATCH).map((c) => c.id);
        const rows = await supaRpc('fleet_health_snapshot', { p_user_ids: ids });
        rows.forEach((r) => snap.set(r.user_id, r));
      }
      if (seq !== this._loadSeq) return;

      const now = Date.now();
      this.rows = clients.map((c) => {
        const s = snap.get(c.id) || {};
        const latest = s.latest || null;
        const lastSeen = latest?.logged_at || null;
        const ageMin = lastSeen ? (now - new Date(lastSeen).getTime()) / 60000 : Infinity;
        const status = ageMin < FLEET_ONLINE_MINUTES ? 'online'
          : ageMin < FLEET_STALE_HOURS * 60 ? 'stale' : 'offline';
        const v = fleetNum(latest?.battery_voltage) || 0;
        const row = {
          ...c,
          latest,
          day: s.last_24h || null,
          lastSeen,
          status,
          statusOrder: { online: 0, stale: 1, offline: 2 }[status],
          nominalV: v > 36 ? 48 : v > 18 ? 24 : 12,
          charging: (fleetNum(latest?.solar_power) || 0) > 5 || !!latest?.shore_connected || !!latest?.engine_running,
        };
        row.flags = {};
        if (status === 'online') {
          FLEET_CHECKS.forEach((chk) => {
            const hit = chk.test(row);
            if (hit) row.flags[chk.key] = hit;
          });
        }
        return row;
      });
      this.loadedAt = new Date();
      this.renderChips();
      this.apply();
    } catch (e) {
      console.error('Fleet health load failed:', e);
      const missing = /fleet_health_snapshot/.test(e.message || '') && /404|PGRST202/.test(e.message || '');
      if (listEl) listEl.innerHTML = `<div class="data-empty">${missing
        ? 'Fleet Health needs its database update. Run supabase/migration_fleet_health.sql in the Supabase SQL editor.'
        : `Failed to load fleet — ${escHtml(e.message || 'unknown error')}`}</div>`;
    }
  },

  // Chip definitions: "Needs attention" (any check), each check, then status views.
  _chips() {
    const online = this.rows.filter((r) => r.status === 'online');
    return [
      { key: 'attention', label: 'Needs attention', rows: online.filter((r) => FLEET_CHECKS.some((chk) => !chk.informational && r.flags[chk.key])) },
      ...FLEET_CHECKS.map((chk) => ({ key: chk.key, label: chk.label, check: chk, rows: online.filter((r) => r.flags[chk.key]) })),
      { key: 'stale',   label: 'Stale',   rows: this.rows.filter((r) => r.status === 'stale') },
      { key: 'offline', label: 'Offline', rows: this.rows.filter((r) => r.status === 'offline') },
      { key: 'all',     label: 'All vehicles', rows: this.rows },
    ];
  },

  select(key) {
    this.active = key;
    this.renderChips();
    this.apply();
  },

  apply() {
    const chip = this._chips().find((c) => c.key === this.active) || this._chips()[0];
    const q = (document.getElementById('fleetSearch')?.value || '').toLowerCase();
    const rows = chip.rows
      .filter((r) => !q || r.displayName.toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) || r.vehicleLabel.toLowerCase().includes(q))
      .map((r) => {
        const hits = chip.check ? [r.flags[chip.check.key]]
          : FLEET_CHECKS.filter((chk) => !chk.informational && r.flags[chk.key]).map((chk) => r.flags[chk.key]);
        let findingText = hits.map((h) => h.text).join(' · ');
        if (!findingText) {
          findingText = r.status === 'online' ? 'No issues'
            : r.lastSeen ? `No reading for ${timeAgo(r.lastSeen).replace(' ago', '')}` : 'No data yet';
        }
        // Worst first: a check's own rank, else the number of issues, else staleness.
        const findingRank = chip.check ? hits[0].rank
          : hits.length ? -hits.length
          : r.lastSeen ? -new Date(r.lastSeen).getTime() / 1e12 : 1;
        return { ...r, findingText, findingRank };
      });
    this.listView.setRows(rows);
    this.render();
  },

  renderChips() {
    const el = document.getElementById('fleetChips');
    if (el) {
      el.innerHTML = this._chips().map((c) => `
        <button class="support-chip" aria-pressed="${c.key === this.active}" onclick="FleetHealthPage.select('${c.key}')">
          ${escHtml(c.label)} <span class="fleet-chip-count">${c.rows.length}</span>
        </button>
      `).join('');
    }
    const counts = { online: 0, stale: 0, offline: 0 };
    this.rows.forEach((r) => { counts[r.status]++; });
    const sum = document.getElementById('fleetSummary');
    if (sum) {
      sum.textContent = `${counts.online} online · ${counts.stale} stale · ${counts.offline} offline` +
        (this.loadedAt ? ` · updated ${this.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
    }
  },

  render() {
    const list = document.getElementById('fleetList');
    if (!list) return;
    if (this.listView.rows.length === 0) {
      const searching = !!document.getElementById('fleetSearch')?.value;
      list.innerHTML = `<div class="data-empty">${searching ? 'No vehicles match your search'
        : this.active === 'all' ? 'No vehicles yet' : 'Nothing to flag here'}</div>`;
      return;
    }
    list.innerHTML = this.listView.html();
  },

  exportCsv() {
    const rows = this.listView.rows;
    if (!rows.length) { showToast('Nothing to export'); return; }
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Customer', 'Email', 'Vehicle', 'Status', 'Reading', 'Last seen']]
      .concat(rows.map((r) => [r.displayName, r.email, r.vehicleLabel, FLEET_STATUS[r.status].label, r.findingText, r.lastSeen || '']))
      .map((cols) => cols.map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fleet-health-${this.active}-${localDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

window.FleetHealthPage = FleetHealthPage;
