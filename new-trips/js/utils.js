// ArcOS Admin — Utility Functions
// =================================

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", { month: "short", day: "numeric" });
}

function formatTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(dateStr) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function tierBadge(tier) {
  const t = (tier || 'base_camp').toLowerCase();
  const label = t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `<span class="tier tier-${t}">${label}</span>`;
}

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${label}</span><span class="info-value">${value || '—'}</span></div>`;
}

function localDate(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function localDateToUTCStart(dateStr) {
  return new Date(dateStr + "T00:00:00").toISOString();
}

function localDateToUTCEnd(dateStr) {
  return new Date(dateStr + "T23:59:59").toISOString();
}

// Slugify a string for URLs
function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Show/hide elements
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// Set active page
function setActivePage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
}

// Set active nav tab
function setActiveTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
}

// Modal helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('active'); el.style.display = 'flex'; }
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('active');
    m.style.display = 'none';
  });
}

// Escape HTML
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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
window.show = show;
window.hide = hide;
window.setActivePage = setActivePage;
window.setActiveTab = setActiveTab;
window.openModal = openModal;
window.closeModals = closeModals;
window.escHtml = escHtml;
