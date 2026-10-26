// ArcAdmin — Utility Functions
// =============================
// 2026-04-23 update: tierBadge now emits the new .badge--tier-X classes from
// arcadmin.css. setActiveTab removed (replaced by inline page handlers).
// openModal/closeModals are defined in app.js and registered globally there.

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Newest of a set of ISO timestamps (ignores null/blank).
function maxTimestamp(values) {
  const valid = (values || []).filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((newest, t) =>
    (new Date(t).getTime() > new Date(newest).getTime() ? t : newest)
  );
}

// The clients the signed-in person may see, as the Clients page lists them.
// Super admins get everyone; company admins and support staff get clients
// whose profiles.company_id is their company or who own a vehicle on one of
// its active build lines. Staff-only rows (company_admins / support_members
// with no vehicle) are left out; they belong on the Companies page.
async function fetchScopedClients() {
  const [users, subs, companyAdmins, vehicles, supportStaff] = await Promise.all([
    supa('profiles?select=*&order=created_at.desc'),
    supa('subscriptions?select=user_id,tier,status'),
    supa('company_admins?select=user_id,company_id,role'),
    supa('vehicles?select=user_id,make,model,year,build_line_id'),
    supa('support_members?select=user_id').catch(() => []),
  ]);

  const subMap = {};
  subs.forEach((s) => { subMap[s.user_id] = s; });
  const vehicleMap = {};
  vehicles.forEach((v) => { if (!vehicleMap[v.user_id]) vehicleMap[v.user_id] = v; });
  const adminUserIds = new Set([...companyAdmins, ...supportStaff].map((a) => a.user_id));
  const vehicleUserIds = new Set(vehicles.map((v) => v.user_id));

  // Company-scope filter for company admins and support staff: must match either
  //   (a) profiles.company_id === userCompanyId, OR
  //   (b) user owns a vehicle whose build_line belongs to this company
  let companyClientIds = null;
  if ((Auth.isCompanyAdmin() || Auth.isSupportMember()) && userCompanyId) {
    const buildLines = await supa(
      `build_lines?company_id=eq.${userCompanyId}&is_active=eq.true&select=id`
    );
    const buildLineIds = new Set(buildLines.map((b) => b.id));
    companyClientIds = new Set();
    users.forEach((u) => {
      if (u.company_id === userCompanyId) companyClientIds.add(u.id);
    });
    vehicles.forEach((v) => {
      if (v.build_line_id && buildLineIds.has(v.build_line_id) && v.user_id) {
        companyClientIds.add(v.user_id);
      }
    });
  }

  return users
    .map((u) => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || (u.email || '').split('@')[0];
      Router.registerSlug(u.id, name);
      const sub = subMap[u.id];
      const v = vehicleMap[u.id];
      return {
        id: u.id,
        displayName: name,
        email: u.email,
        tier: sub?.tier || 'base_camp',
        lastLogin: u.last_login_at,
        createdAt: u.created_at,
        isAdmin: !!u.is_admin,
        hasVehicle: !!v,
        vehicleLabel: v ? [v.year, v.make, v.model].filter(Boolean).join(' ').trim() : '',
      };
    })
    .filter((u) => vehicleUserIds.has(u.id) || u.isAdmin || !adminUserIds.has(u.id))
    // Company admins only see their own clients
    .filter((u) => !companyClientIds || companyClientIds.has(u.id));
}

// "Last active" per user, using the same signals as the client detail page:
// newest of last login, latest telemetry log, latest device-control action.
// `users` is [{ id, lastLogin }]. Returns Map(userId → ISO timestamp | null).
// Two limit=1 lookups per user, run a few at a time to avoid a request burst.
async function fetchLastActive(users, concurrency = 6) {
  const result = new Map();
  const queue = [...users];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      const [log, devLog] = await Promise.all([
        supa(`system_logs?user_id=eq.${u.id}&order=logged_at.desc&limit=1&select=logged_at`).catch(() => []),
        supa(`device_control_logs?user_id=eq.${u.id}&order=created_at.desc&limit=1&select=created_at`).catch(() => []),
      ]);
      result.set(u.id, maxTimestamp([u.lastLogin, log[0]?.logged_at, devLog[0]?.created_at]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return result;
}

// ── Sortable, paginated list (data-table card rows) ──
// Shared by the Clients page, the dashboard lists and the company client
// list. `ref` is the global expression for this instance (used in inline
// onclick handlers), e.g. 'ClientsPage.listView'.
//   columns: [{ key, label, cls, sortValue(row) }]   (sortValue → string | number | null)
//   rowHtml(row): markup for one row
//   onChange(): owner re-renders (call view.html() again)
class ListView {
  constructor({ ref, columns, rowHtml, onChange, perPage = 25, sortKey, sortDir = 'asc', noun = 'item', nounPlural }) {
    Object.assign(this, { ref, columns, rowHtml, onChange, perPage, sortKey, sortDir, noun });
    this.nounPlural = nounPlural || `${noun}s`;
    this.rows = [];
    this.page = 1;
  }

  setRows(rows, { keepPage = false } = {}) {
    this.rows = [...rows];
    if (!keepPage) this.page = 1;
    this._sort();
  }

  sortBy(key) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      const col = this.columns.find((c) => c.key === key);
      this.sortDir = col?.defaultDir || 'asc';
    }
    this.page = 1;
    this._sort();
    this.onChange();
  }

  goToPage(page) {
    this.page = Math.max(1, Math.min(this._totalPages(), page));
    this.onChange();
  }

  _totalPages() {
    return Math.max(1, Math.ceil(this.rows.length / this.perPage));
  }

  _sort() {
    const col = this.columns.find((c) => c.key === this.sortKey);
    if (!col?.sortValue) return;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const tie = this.columns[0].sortValue;
    this.rows.sort((a, b) => {
      const va = col.sortValue(a);
      const vb = col.sortValue(b);
      // Blanks (no vehicle, never active) sink to the bottom either way.
      const blankA = va === null || va === undefined || va === '';
      const blankB = vb === null || vb === undefined || vb === '';
      if (blankA !== blankB) return blankA ? 1 : -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      const ta = tie(a), tb = tie(b);
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }

  html() {
    const total = this.rows.length;
    const totalPages = this._totalPages();
    const page = Math.min(Math.max(1, this.page), totalPages);
    const startIdx = (page - 1) * this.perPage;
    const endIdx = Math.min(startIdx + this.perPage, total);

    const header = (c) => {
      if (!c.sortValue) return `<div class="data-table-header ${c.cls}">${c.label}</div>`;
      const active = this.sortKey === c.key;
      const arrow = active ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<div class="data-table-header ${c.cls}" role="button" tabindex="0" style="cursor:pointer;user-select:none"
        aria-sort="${active ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"
        onclick="${this.ref}.sortBy('${c.key}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${this.ref}.sortBy('${c.key}')}">${c.label}${arrow}</div>`;
    };

    const btn = (p) => `<button class="btn ${p === page ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="${this.ref}.goToPage(${p})" style="min-width:32px;padding:4px 8px">${p}</button>`;
    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="${this.ref}.goToPage(1)" ${page === 1 ? 'disabled' : ''} title="First">«</button>
          <button class="btn btn-ghost btn-sm" onclick="${this.ref}.goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>
          ${pageNumberButtons(page, totalPages, btn)}
          <button class="btn btn-ghost btn-sm" onclick="${this.ref}.goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>
          <button class="btn btn-ghost btn-sm" onclick="${this.ref}.goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last">»</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} ${total === 1 ? this.noun : this.nounPlural}</div>`;

    return `
      <div class="data-table">
        <div class="data-table-headers">${this.columns.map(header).join('')}</div>
        ${this.rows.slice(startIdx, endIdx).map(this.rowHtml).join('')}
      </div>
      ${pagination}
    `;
  }
}

// Numbered page buttons with ellipses (same pattern as the telemetry log pager).
function pageNumberButtons(current, total, btn) {
  const ellipsis = `<span class="t-muted" style="padding:0 4px">…</span>`;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1).map(btn).join('');
  const pages = [...new Set([1, 2, current - 1, current, current + 1, total - 1, total])]
    .filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  let html = '';
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) html += ellipsis;
    html += btn(p);
    prev = p;
  }
  return html;
}

// Column sort helpers shared by the client lists.
const sortText = (s) => (s || '').toLowerCase();
const sortTime = (t) => (t ? new Date(t).getTime() : null);
const lastActiveLabel = (row) =>
  row.lastActive !== undefined ? (row.lastActive ? timeAgo(row.lastActive) : '—') : '…';

// Shared column set + row markup for client lists (Clients page, dashboard
// All Users tab, company detail page).
const CLIENT_COLUMNS = [
  { key: 'name',       label: 'Name',        cls: 'col-name',        sortValue: (u) => sortText(u.displayName) },
  { key: 'email',      label: 'Email',       cls: 'col-email',       sortValue: (u) => sortText(u.email) },
  { key: 'vehicle',    label: 'Vehicle',     cls: 'col-vehicle',     sortValue: (u) => sortText(u.vehicleLabel) },
  { key: 'tier',       label: 'Tier',        cls: 'col-tier',        sortValue: (u) => sortText(u.tier) },
  // Most-recent-first is the useful first click for activity.
  { key: 'lastActive', label: 'Last active', cls: 'col-last-active', sortValue: (u) => sortTime(u.lastActive), defaultDir: 'desc' },
];

function clientRowHtml(u, href) {
  return `
    <button class="data-table-row" onclick="Router.navigate('${escHtml(href)}')">
      <div class="data-table-cell data-table-cell--bold data-table-cell--primary col-name">${escHtml(u.displayName)}</div>
      <div class="data-table-cell col-email t-muted" data-label="Email">${escHtml(u.email || '')}</div>
      <div class="data-table-cell col-vehicle t-muted" data-label="Vehicle">${escHtml(u.vehicleLabel || '—')}</div>
      <div class="data-table-cell col-tier" data-label="Tier">${tierBadge(u.tier)}</div>
      <div class="data-table-cell col-last-active t-muted" data-label="Last active">${escHtml(lastActiveLabel(u))}</div>
    </button>
  `;
}

// Returns a badge element. Matches CSS in arcadmin.css (.badge + modifier).
// Known tiers: explorer, base_camp, base, launching, pro (future).
function tierBadge(tier) {
  const raw = (tier || 'base_camp').toLowerCase();
  // Pretty label: "base_camp" → "Base Camp"
  const label = raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // Tier-specific styling modifier
  let modifier = 'badge--tier-base-camp';
  if (raw === 'explorer' || raw === 'pro' || raw === 'founder') modifier = 'badge--tier-explorer';
  else if (raw === 'base') modifier = 'badge--tier-base';
  else if (raw === 'base_camp') modifier = 'badge--tier-base-camp';
  return `<span class="badge ${modifier}">${label}</span>`;
}

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${escHtml(label)}</span><span class="info-value">${value || '—'}</span></div>`;
}

function localDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localDateToUTCStart(dateStr) {
  return new Date(dateStr + 'T00:00:00').toISOString();
}

function localDateToUTCEnd(dateStr) {
  return new Date(dateStr + 'T23:59:59').toISOString();
}

function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Returns a greeting appropriate for the time of day.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

// HTML-escape
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = (str == null) ? '' : String(str);
  return div.innerHTML;
}

// Run an async operation with a loading spinner on a button.
// Button stays disabled while running. Disables pointer-events via CSS.
// Accepts either a button element or an event-like object with `.currentTarget`.
async function withBtnLoading(btnOrEvent, asyncFn) {
  const btn = btnOrEvent && btnOrEvent.currentTarget ? btnOrEvent.currentTarget : btnOrEvent;
  if (btn && btn.classList) {
    btn.classList.add('btn--loading');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  }
  try {
    return await asyncFn();
  } finally {
    if (btn && btn.classList) {
      btn.classList.remove('btn--loading');
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }
}

// Show a fixed top-center toast. Auto-dismisses after `duration` ms.
// Kind: 'success' (default) | 'error'. Call from anywhere after an async op.
function showToast(message, kind = 'success', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Force reflow so the opacity transition runs
  // eslint-disable-next-line no-unused-expressions
  toast.offsetHeight;
  toast.classList.add('toast--visible');
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

window.formatDate = formatDate;
window.formatTime = formatTime;
window.formatDateTime = formatDateTime;
window.timeAgo = timeAgo;
window.maxTimestamp = maxTimestamp;
window.fetchLastActive = fetchLastActive;
window.fetchScopedClients = fetchScopedClients;
window.ListView = ListView;
window.sortText = sortText;
window.sortTime = sortTime;
window.lastActiveLabel = lastActiveLabel;
window.CLIENT_COLUMNS = CLIENT_COLUMNS;
window.clientRowHtml = clientRowHtml;
window.tierBadge = tierBadge;
window.infoRow = infoRow;
window.localDate = localDate;
window.localDateToUTCStart = localDateToUTCStart;
window.localDateToUTCEnd = localDateToUTCEnd;
window.slugify = slugify;
window.timeOfDayGreeting = timeOfDayGreeting;
window.escHtml = escHtml;
window.withBtnLoading = withBtnLoading;
window.showToast = showToast;

// ── Trip route rendering (shared by the Trips tab + user-detail Trips card) ──
// Draws a speed-graded route on a Leaflet map: the line is colored by speed,
// start/end markers are placed, and sampled points along the route are tappable
// to read the exact speed + time at that interval. Returns the layers it added
// so the caller can remove them before the next render.
//
// points: [{ latitude, longitude, speed (m/s), timestamp }], ordered by time.

// Fetch ALL rows for a PostgREST query, paging past the project's max-rows cap
// (1000 by default). Pass the path WITHOUT limit/offset — they're added here.
// Needed for trips longer than 1000 points (~2.5–4 h), which a single request
// would silently truncate.
async function supaAll(pathWithoutRange, pageSize) {
  const size = pageSize || 1000;
  const all = [];
  for (let offset = 0; ; offset += size) {
    const sep = pathWithoutRange.includes('?') ? '&' : '?';
    const chunk = await supa(`${pathWithoutRange}${sep}limit=${size}&offset=${offset}`);
    if (!chunk || chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < size) break;
  }
  return all;
}

function tripSpeedMph(mps) { return mps == null ? 0 : mps * 2.23694; }

function tripSpeedColor(mph) {
  // blue (slow) → green → yellow → orange → red (fast)
  if (mph < 15) return '#3B82F6';
  if (mph < 30) return '#22C55E';
  if (mph < 50) return '#EAB308';
  if (mph < 70) return '#F97316';
  return '#EF4444';
}

function drawTripRoute(map, points) {
  const layers = [];
  const pts = (points || []).filter((p) => p.latitude != null && p.longitude != null);
  if (pts.length === 0) return layers;

  // Speed-colored route, grouped into contiguous same-color bands so a long
  // trip is a handful of polylines instead of thousands (keeps it fast).
  let band = [[pts[0].latitude, pts[0].longitude]];
  let bandColor = tripSpeedColor(tripSpeedMph(pts[0].speed));
  const flush = () => {
    if (band.length >= 2) {
      const line = L.polyline(band, { color: bandColor, weight: 5, opacity: 0.9, lineCap: 'round' });
      line.addTo(map);
      layers.push(line);
    }
  };
  for (let i = 1; i < pts.length; i++) {
    const c = tripSpeedColor(tripSpeedMph(pts[i].speed));
    band.push([pts[i].latitude, pts[i].longitude]);
    if (c !== bandColor) {
      flush();
      band = [[pts[i].latitude, pts[i].longitude]]; // continue the next band from here
      bandColor = c;
    }
  }
  flush();

  // Start (green) / end (gold) markers.
  const first = pts[0], last = pts[pts.length - 1];
  layers.push(
    L.circleMarker([first.latitude, first.longitude],
      { radius: 6, color: '#fff', weight: 2, fillColor: '#2ABC53', fillOpacity: 1 }).addTo(map),
    L.circleMarker([last.latitude, last.longitude],
      { radius: 6, color: '#fff', weight: 2, fillColor: '#E7B400', fillOpacity: 1 }).addTo(map),
  );

  // Sampled speed points — tap/hover to read mph + time at that interval.
  // Cap at ~60 markers so long trips don't clutter the map.
  const step = Math.max(1, Math.floor(pts.length / 60));
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    const mph = Math.round(tripSpeedMph(p.speed));
    const time = p.timestamp
      ? new Date(p.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
      : '';
    const dot = L.circleMarker([p.latitude, p.longitude], {
      radius: 4, color: '#fff', weight: 1,
      fillColor: tripSpeedColor(tripSpeedMph(p.speed)), fillOpacity: 0.95,
    });
    dot.bindPopup(`<b>${mph} mph</b>${time ? ' · ' + time : ''}`);
    dot.bindTooltip(`${mph} mph`, { direction: 'top' });
    dot.addTo(map);
    layers.push(dot);
  }

  // Fit the map to the whole route.
  map.fitBounds(L.polyline(pts.map((p) => [p.latitude, p.longitude])).getBounds(), { padding: [30, 30] });
  return layers;
}

// Small HTML legend for the speed color scale (drop next to the map).
function tripSpeedLegendHtml() {
  const items = [
    ['#3B82F6', '<15'], ['#22C55E', '15–30'], ['#EAB308', '30–50'],
    ['#F97316', '50–70'], ['#EF4444', '70+'],
  ];
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:11px" class="t-muted">
    <span>Speed (mph):</span>
    ${items.map(([c, l]) => `<span style="display:inline-flex;align-items:center;gap:4px">
      <span style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${l}</span>`).join('')}
  </div>`;
}

window.drawTripRoute = drawTripRoute;
window.tripSpeedLegendHtml = tripSpeedLegendHtml;
window.supaAll = supaAll;