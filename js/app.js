// ArcAdmin — App Bootstrap
// =========================
// 2026-04-23 rewrite for the new sidebar-nav architecture. Registers routes,
// wires up global helpers (modal open/close, click-outside for overflow menu),
// and kicks off the initial render.

document.addEventListener('DOMContentLoaded', () => {

  // ── Check for invite / password-recovery tokens in the URL hash ──
  const hash = window.location.hash.substring(1);
  if (hash) {
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const type = params.get('type');

    if (accessToken && (type === 'invite' || type === 'recovery')) {
      // Temporarily stash token so the set-password request has auth
      token = accessToken;
      saveSession();

      document.getElementById('loginPage').classList.add('hidden');
      document.getElementById('appShell').classList.add('hidden');
      document.getElementById('setPasswordPage').classList.remove('hidden');

      // Clear the hash from the address bar
      history.replaceState(null, '', window.location.pathname);
      return;
    }
  }

  // ── Register routes ──
  // All routes require auth. When token is missing, bounce to login.

  const requireAuth = (handler) => (params) => {
    if (!token) { showLogin(); return; }
    handler(params);
  };

  Router.on('/login', () => {
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
  });

  Router.on('/dashboard', requireAuth(() => {
    Router.showPage('pageDashboard');
    if (window.DashboardPage) DashboardPage.load();
  }));

  Router.on('/clients', requireAuth(() => {
    Router.showPage('pageClients');
    if (window.ClientsPage) ClientsPage.load();
  }));

  Router.on('/clients/:userId', requireAuth((params) => {
    Router.showPage('pageUserDetail');
    if (window.UserDetailPage) UserDetailPage.load(params);
  }));

  Router.on('/companies', requireAuth(() => {
    // Super admin only. Company admins are redirected to their own build lines.
    if (Auth.isCompanyAdmin()) { Router.navigate('models'); return; }
    if (!Auth.isSuper()) { Router.navigate('dashboard'); return; }
    Router.showPage('pageCompanies');
    if (window.CompaniesPage) CompaniesPage.load();
  }));

  Router.on('/companies/:companyId', requireAuth((params) => {
    // Company admins can only view their OWN company
    const resolvedId = Router.resolveId(params.companyId);
    if (Auth.isCompanyAdmin() && resolvedId !== userCompanyId) {
      Router.navigate('models');
      return;
    }
    Router.showPage('pageCompanyDetail');
    if (window.CompaniesPage && CompaniesPage.loadDetail) {
      CompaniesPage.loadDetail({ companyId: resolvedId });
    }
  }));

  Router.on('/companies/:companyId/clients/:clientId', requireAuth((params) => {
    Router.showPage('pageUserDetail');
    if (window.UserDetailPage) UserDetailPage.load({ userId: Router.resolveId(params.clientId) });
  }));

  Router.on('/companies/:companyId/builds/:buildLineId', requireAuth((params) => {
    Router.showPage('pageBuildLineDetail');
    if (window.BuildLinesPage && BuildLinesPage.loadDetail) {
      BuildLinesPage.loadDetail({
        companyId: Router.resolveId(params.companyId),
        buildLineId: Router.resolveId(params.buildLineId),
      });
    }
  }));

  // Company admin's view of their own build lines. Renders the same
  // per-company build-line list UI that super admins see inside a company tab,
  // but as a standalone page scoped to the user's own company.
  Router.on('/models', requireAuth(() => {
    if (!Auth.isCompanyAdmin() && !Auth.isSuper()) { Router.navigate('dashboard'); return; }
    Router.showPage('pageModels');
    if (window.ModelsPage) ModelsPage.load();
  }));

  Router.on('/models/:buildLineId', requireAuth((params) => {
    if (!Auth.isCompanyAdmin() && !Auth.isSuper()) { Router.navigate('dashboard'); return; }
    const companyId = Auth.isCompanyAdmin() ? userCompanyId : null;
    if (!companyId) { Router.navigate('dashboard'); return; }
    Router.showPage('pageBuildLineDetail');
    if (window.BuildLinesPage && BuildLinesPage.loadDetail) {
      BuildLinesPage.loadDetail({
        companyId,
        buildLineId: Router.resolveId(params.buildLineId),
      });
    }
  }));

  Router.on('/trips', requireAuth(() => {
    if (!Auth.isSuper()) { Router.navigate('dashboard'); return; }
    Router.showPage('pageTrips');
    if (window.TripsPage) TripsPage.load();
  }));

  Router.on('/firmware', requireAuth(() => {
    if (!Auth.isSuper()) { Router.navigate('dashboard'); return; }
    Router.showPage('pageFirmware');
    if (window.FirmwarePage) FirmwarePage.load();
  }));

  Router.on('/', () => {
    if (!token) { showLogin(); return; }
    Router.navigate('dashboard', false);
  });

  // ── Wire up global UI behaviors ──
  wireModalBackdrops();
  wireOverflowMenuAutoClose();

  // ── Boot ──
  if (!token) {
    showLogin();
    return;
  }

  // Have a stored token from localStorage — need to validate it and restore the
  // role/profile context. Simplest approach: reload profile, re-derive role.
  bootstrapFromStoredSession();
});

// ── Helpers ──

function showLogin() {
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
}

async function bootstrapFromStoredSession() {
  try {
    // We don't have the user id in localStorage — grab it by decoding the JWT.
    const payload = parseJwtPayload(token);
    if (!payload || !payload.sub) {
      clearSession();
      showLogin();
      return;
    }
    const userId = payload.sub;

    const profile = await supa(`profiles?id=eq.${userId}&select=is_admin,email,first_name,last_name`);
    const p = profile[0] || {};
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    Auth._userEmail = p.email || payload.email || '';
    Auth._userName = fullName || Auth._userEmail;

    if (p.is_admin) {
      userRole = 'super_admin';
    } else {
      const ca = await supa(`company_admins?user_id=eq.${userId}&select=company_id,role`);
      if (ca.length > 0) {
        userRole = 'company_admin';
        userCompanyId = ca[0].company_id;
        const companies = await supa(`companies?id=eq.${userCompanyId}&select=name`);
        userCompanyName = companies[0]?.name || 'Company';
        Router.registerSlug(userCompanyId, userCompanyName);
      } else {
        clearSession();
        showLogin();
        return;
      }
    }

    Auth._startSessionTimers();
    if (typeof startBackgroundRefresh === 'function') startBackgroundRefresh();
    Router.renderSidebar(userRole, { name: Auth._userName, email: Auth._userEmail });

    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    // Honor deep-link on reload; otherwise go to dashboard
    const path = window.location.pathname;
    if (path === '/' || path === '/login' || path === '') {
      Router.navigate('dashboard', false);
    } else {
      Router.currentPath = path;
      Router.resolve(path);
      Router._updateActiveNav();
    }
  } catch (e) {
    console.error('Bootstrap failed:', e);
    clearSession();
    showLogin();
  }
}

function parseJwtPayload(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - payload.length % 4) % 4);
    return JSON.parse(atob(payload + padding));
  } catch (e) {
    return null;
  }
}

// ── Modal helpers (used by all pages) ──

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  // Also clear any inline error boxes
  document.querySelectorAll('.modal-overlay .error-box').forEach(e => e.classList.add('hidden'));
}

function wireModalBackdrops() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModals();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModals();
  });
}

// ── Overflow menu auto-close ──
// Click anywhere outside the menu (or its trigger) and it closes.
function wireOverflowMenuAutoClose() {
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.overflow-menu:not(.hidden)').forEach(menu => {
      const wrapper = menu.closest('.overflow-menu-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  });
}

// ── Misc globals (kept for backward compat with legacy page modules) ──
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

window.openModal = openModal;
window.closeModals = closeModals;
window.show = show;
window.hide = hide;