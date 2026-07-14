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