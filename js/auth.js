// ArcOS Admin — Authentication
// ==============================

const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes
const LOGIN_RATE_LIMIT_MS = 2000;                // 2s between login attempts
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;       // 5 minute lockout

const Auth = {
  _sessionTimer: null,
  _inactivityTimer: null,
  _loginAttempts: 0,
  _lastLoginAttempt: 0,
  _lockedUntil: 0,

  async login(email, password) {
    // Rate limiting
    const now = Date.now();
    if (now < this._lockedUntil) {
      const secsLeft = Math.ceil((this._lockedUntil - now) / 1000);
      throw new Error(`Too many attempts. Try again in ${secsLeft}s.`);
    }
    if (now - this._lastLoginAttempt < LOGIN_RATE_LIMIT_MS) {
      throw new Error("Please wait before trying again.");
    }
    this._lastLoginAttempt = now;

    try {
      const data = await supaLogin(email, password);
      token = data.access_token;
      this._loginAttempts = 0;

      const userId = data.user.id;

      // Check super admin
      const profile = await supa(`profiles?id=eq.${userId}&select=is_admin,email`);
      if (profile[0]?.is_admin) {
        userRole = 'super_admin';
        this._startSessionTimers();
        this.setupSuperAdmin(email);
        return;
      }

      // Check company admin
      const ca = await supa(`company_admins?user_id=eq.${userId}&select=company_id,role`);
      if (ca.length > 0) {
        userRole = 'company_admin';
        userCompanyId = ca[0].company_id;

        const companies = await supa(`companies?id=eq.${userCompanyId}&select=name`);
        userCompanyName = companies[0]?.name || 'Company';

        this._startSessionTimers();
        this.setupCompanyAdmin(email, userCompanyName);
        return;
      }

      // Not an admin — clear token and reject
      token = null;
      throw new Error("Access denied. You must be an admin to use this dashboard.");
    } catch (e) {
      this._loginAttempts++;
      if (this._loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        this._lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        this._loginAttempts = 0;
      }
      throw e;
    }
  },

  _startSessionTimers() {
    this._clearTimers();

    // Absolute session timeout (4h)
    this._sessionTimer = setTimeout(() => {
      this.signout();
      alert('Session expired. Please sign in again.');
    }, SESSION_TIMEOUT_MS);

    // Inactivity timeout (30min)
    this._resetInactivityTimer();
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(evt => {
      document.addEventListener(evt, this._onActivity, { passive: true });
    });
  },

  _onActivity: null, // assigned in init

  _resetInactivityTimer() {
    clearTimeout(this._inactivityTimer);
    this._inactivityTimer = setTimeout(() => {
      this.signout();
      alert('Signed out due to inactivity.');
    }, INACTIVITY_TIMEOUT_MS);
  },

  _clearTimers() {
    clearTimeout(this._sessionTimer);
    clearTimeout(this._inactivityTimer);
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(evt => {
      document.removeEventListener(evt, this._onActivity);
    });
  },

  setupSuperAdmin(email) {
    document.getElementById('navBrandLabel').textContent = 'Admin';
    document.getElementById('navEmail').textContent = email;
    show('tabUsers');
    show('tabCompanies');
    show('tabFirmware');
    show('navTabs');
    hide('loginPage');
    show('appShell');
    Router.navigate('/users');
  },

  setupCompanyAdmin(email, companyName) {
    Router.registerSlug(userCompanyId, companyName);
    document.getElementById('navBrandLabel').textContent = companyName;
    document.getElementById('navEmail').textContent = email;
    hide('tabUsers');
    hide('tabCompanies');
    hide('tabFirmware');
    hide('navTabs');
    hide('loginPage');
    show('appShell');
    Router.navigate(`/companies/${Router.getSlug(userCompanyId)}`);
  },

  signout() {
    this._clearTimers();
    token = null;
    userRole = null;
    userCompanyId = null;
    userCompanyName = null;
    hide('appShell');
    show('loginPage');
    document.getElementById('loginError').classList.add('hidden');
    window.history.replaceState({}, '', '/login');
  },

  isSuper() { return userRole === 'super_admin'; },
  isCompanyAdmin() { return userRole === 'company_admin'; },

  init() {
    // Bind activity handler so we can add/remove it
    this._onActivity = () => this._resetInactivityTimer();
  }
};

// Initialize auth on load
Auth.init();

window.Auth = Auth;