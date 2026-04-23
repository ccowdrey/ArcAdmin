// ArcAdmin — Client-Side Router
// ==============================
// 2026-04-23 rewrite: sidebar-nav architecture with role-aware menu rendering.
// Page visibility controlled by .page + .page.active class pair.
// Sidebar items rendered from a definition list so super admin vs. company
// admin menus diverge cleanly.

const Router = {
  routes: {},
  currentPath: '',
  basePath: '',
  history: [],  // simple back-stack so page-breadcrumb-back can use goBack()

  // Slug maps for friendly URLs
  slugMap: {},
  idMap: {},

  // ── Route registration ──
  on(path, handler) {
    this.routes[path] = handler;
  },

  registerSlug(id, name) {
    let slug = this.slugify(name);
    if (this.idMap[slug] && this.idMap[slug] !== id) {
      let counter = 2;
      while (this.idMap[slug + '-' + counter] && this.idMap[slug + '-' + counter] !== id) counter++;
      slug = slug + '-' + counter;
    }
    this.slugMap[id] = slug;
    this.idMap[slug] = id;
  },

  slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  },

  resolveId(slugOrId) {
    return this.idMap[slugOrId] || slugOrId;
  },

  getSlug(id) {
    return this.slugMap[id] || id;
  },

  // ── Navigation ──
  // Accepts either a short token ("dashboard", "clients") or a full path ("/clients/abc").
  navigate(pathOrToken, pushState = true) {
    const path = pathOrToken.startsWith('/') ? pathOrToken : this._tokenToPath(pathOrToken);
    if (pushState) {
      this.history.push(this.currentPath);
      window.history.pushState({}, '', this.basePath + path);
    }
    this.currentPath = path;
    this.resolve(path);
    this._updateActiveNav();
    if (window.gtag) gtag('event', 'page_view', { page_path: path });
  },

  goBack() {
    // Prefer the in-app history stack (doesn't leave the site if arriving direct)
    if (this.history.length > 0) {
      const prev = this.history.pop();
      window.history.pushState({}, '', this.basePath + prev);
      this.currentPath = prev;
      this.resolve(prev);
      this._updateActiveNav();
    } else {
      window.history.back();
    }
  },

  _tokenToPath(token) {
    const map = {
      'dashboard':  '/dashboard',
      'clients':    '/clients',
      'companies':  '/companies',
      'trips':      '/trips',
      'firmware':   '/firmware',
    };
    return map[token] || `/${token}`;
  },

  resolve(path) {
    // Exact match first
    if (this.routes[path]) { this.routes[path](); return; }
    // Pattern match (e.g. /companies/:id)
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const params = this.matchRoute(pattern, path);
      if (params) { handler(params); return; }
    }
    // Fallback: go home
    if (path !== '/' && this.routes['/']) {
      this.navigate('/', false);
    }
  },

  matchRoute(pattern, path) {
    const pp = pattern.split('/');
    const pa = path.split('/');
    if (pp.length !== pa.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) {
        params[pp[i].slice(1)] = decodeURIComponent(pa[i]);
      } else if (pp[i] !== pa[i]) {
        return null;
      }
    }
    return params;
  },

  // ── Page visibility ──
  showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
  },

  // ── Sidebar rendering ──
  // Menus are defined as arrays and rendered by role. Swap the definition
  // and the nav updates — no DOM plumbing in individual page handlers.

  menus: {
    super_admin: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home' },
      { id: 'clients',   label: 'Clients',   icon: 'users' },
      { id: 'companies', label: 'Companies', icon: 'luggage' },
      { id: 'trips',     label: 'Trips',     icon: 'map' },
      { id: 'firmware',  label: 'Firmware',  icon: 'code' },
    ],
    company_admin: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home' },
      { id: 'clients',   label: 'Clients',   icon: 'users' },
      { id: 'companies', label: 'My Company', icon: 'luggage' },
    ],
  },

  renderSidebar(role, user) {
    const primaryMenu = this.menus[role] || this.menus.super_admin;
    const primary = document.getElementById('sidebarPrimary');
    const footer = document.getElementById('sidebarFooter');
    if (!primary || !footer) return;

    primary.innerHTML = primaryMenu.map(item => `
      <button class="sidebar-item" data-nav="${item.id}" onclick="Router.navigate('${item.id}')">
        <span class="sidebar-item-icon">${this._icon(item.icon)}</span>
        <span class="sidebar-item-label">${item.label}</span>
      </button>
    `).join('');

    const initial = (user.name || user.email || '?').charAt(0).toUpperCase();
    const displayName = user.name || user.email || 'User';
    footer.innerHTML = `
      <div class="sidebar-item" style="cursor:default">
        <span class="sidebar-avatar">${initial}</span>
        <span class="sidebar-item-label">${escHtml(displayName)}</span>
      </div>
      <button class="sidebar-item" onclick="Auth.signout()">
        <span class="sidebar-item-icon">${this._icon('logout')}</span>
        <span class="sidebar-item-label">Log out</span>
      </button>
    `;
  },

  _updateActiveNav() {
    // First path segment determines the active nav item.
    // e.g. /companies/abc → companies is active.
    const firstSeg = (this.currentPath.split('/')[1] || '').toLowerCase();
    document.querySelectorAll('.sidebar-item[data-nav]').forEach(item => {
      const isActive = item.getAttribute('data-nav') === firstSeg;
      item.classList.toggle('sidebar-item--active', isActive);
    });
  },

  // ── Icon library (inline SVG) ──
  // Stroke-based icons matching Figma's lucide-like style at 16×16.
  _icon(name) {
    const icons = {
      home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      luggage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="6" width="14" height="16" rx="2"/><path d="M8 6V3h8v3"/><line x1="9" y1="10" x2="9" y2="18"/><line x1="15" y1="10" x2="15" y2="18"/></svg>`,
      map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
      code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
      logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    };
    return icons[name] || '';
  },

  // ── Init ──
  init() {
    window.addEventListener('popstate', () => this.resolve(window.location.pathname));
  },
};

// Minimal HTML-escape helper (available globally since other pages use it)
if (typeof window.escHtml === 'undefined') {
  window.escHtml = function(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
}

window.Router = Router;
Router.init();
