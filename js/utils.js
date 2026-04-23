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