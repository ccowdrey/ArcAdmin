// ArcAdmin — Authentication
// ==========================
// 2026-04-23 rewrite: integrates with new JWT-refreshing api.js.
// Role detection feeds Router.renderSidebar() to swap menus between
// super_admin and company_admin.

const SESSION_TIMEOUT_MS    = 4 * 60 * 60 * 1000; // 4 hours absolute
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;     // 30 minutes idle
const LOGIN_RATE_LIMIT_MS   = 2000;               // 2s between login attempts
const MAX_LOGIN_ATTEMPTS    = 5;
const LOCKOUT_DURATION_MS   = 5 * 60 * 1000;      // 5 minute lockout

const Auth = {
  _sessionTimer: null,
  _inactivityTimer: null,
  _loginAttempts: 0,
  _lastLoginAttempt: 0,
  _lockedUntil: 0,
  _userEmail: null,
  _userName: null,

  // ── Entry point from the login button ──
  async login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errBox = document.getElementById('loginError');
    errBox.classList.add('hidden');

    if (!email || !password) {
      errBox.textContent = 'Enter email and password.';
      errBox.classList.remove('hidden');
      return;
    }

    try {
      await this._loginInternal(email, password);
    } catch (e) {
      errBox.textContent = e.message || 'Login failed.';
      errBox.classList.remove('hidden');
    }
  },

  async _loginInternal(email, password) {
    // Rate limiting
    const now = Date.now();
    if (now < this._lockedUntil) {
      const secsLeft = Math.ceil((this._lockedUntil - now) / 1000);
      throw new Error(`Too many attempts. Try again in ${secsLeft}s.`);
    }
    if (now - this._lastLoginAttempt < LOGIN_RATE_LIMIT_MS) {
      throw new Error('Please wait before trying again.');
    }
    this._lastLoginAttempt = now;

    try {
      const data = await supaLogin(email, password);
      // supaLogin now also stashes the refresh_token automatically
      this._loginAttempts = 0;
      this._userEmail = email;

      const userId = data.user.id;

      // Fetch profile — needed for name and admin flag
      const profile = await supa(`profiles?id=eq.${userId}&select=is_admin,email,first_name,last_name`);
      const p = profile[0] || {};
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      this._userName = fullName || email;

      // Check super admin
      if (p.is_admin) {
        userRole = 'super_admin';
        this._startSessionTimers();
        this._enterApp('super_admin');
        return;
      }

      // Check company admin
      const ca = await supa(`company_admins?user_id=eq.${userId}&select=company_id,role`);
      if (ca.length > 0) {
        userRole = 'company_admin';
        userCompanyId = ca[0].company_id;

        const companies = await supa(`companies?id=eq.${userCompanyId}&select=name`);
        userCompanyName = companies[0]?.name || 'Company';
        Router.registerSlug(userCompanyId, userCompanyName);

        this._startSessionTimers();
        this._enterApp('company_admin');
        return;
      }

      // Not an admin
      clearSession();
      throw new Error('Access denied. You must be an admin to use this dashboard.');
    } catch (e) {
      this._loginAttempts++;
      if (this._loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        this._lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        this._loginAttempts = 0;
      }
      throw e;
    }
  },

  _enterApp(role) {
    // Render sidebar for this role
    Router.renderSidebar(role, {
      name: this._userName,
      email: this._userEmail,
    });

    document.getElementById('loginPage').classList.add('hidden');
    const setPw = document.getElementById('setPasswordPage');
    if (setPw) setPw.classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    // Turn on proactive 45-minute refresh
    if (typeof startBackgroundRefresh === 'function') startBackgroundRefresh();

    // Initial route
    if (role === 'company_admin') {
      Router.navigate('dashboard');
    } else {
      Router.navigate('dashboard');
    }
  },

  // ── Called by api.js when refresh_token is invalid ──
  onAuthExpired() {
    this.signout();
    const errBox = document.getElementById('loginError');
    if (errBox) {
      errBox.textContent = 'Your session expired. Please sign in again.';
      errBox.classList.remove('hidden');
    }
  },

  // ── Session management ──
  _startSessionTimers() {
    this._clearTimers();

    this._sessionTimer = setTimeout(() => {
      this.signout();
      alert('Session expired. Please sign in again.');
    }, SESSION_TIMEOUT_MS);

    this._resetInactivityTimer();
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(evt => {
      document.addEventListener(evt, this._onActivity, { passive: true });
    });
  },

  _onActivity: null,

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

  signout() {
    this._clearTimers();
    if (typeof stopBackgroundRefresh === 'function') stopBackgroundRefresh();
    clearSession();
    this._userEmail = null;
    this._userName = null;

    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    const errBox = document.getElementById('loginError');
    if (errBox) errBox.classList.add('hidden');

    window.history.replaceState({}, '', '/login');
  },

  showSignup() {
    // Placeholder for a "Create account" flow. For now, just show a hint.
    const errBox = document.getElementById('loginError');
    if (errBox) {
      errBox.textContent = 'New accounts are created by invitation. Contact your administrator.';
      errBox.classList.remove('hidden');
    }
  },

  completeSetPassword() {
    // Stub — wired when the set-password flow lands. Not in this cut.
    console.warn('completeSetPassword not yet wired');
  },

  isSuper() { return userRole === 'super_admin'; },
  isCompanyAdmin() { return userRole === 'company_admin'; },

  init() {
    this._onActivity = () => this._resetInactivityTimer();

    // Hook up Enter key on login form
    const pw = document.getElementById('loginPassword');
    if (pw) pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.login(); });
    const em = document.getElementById('loginEmail');
    if (em) em.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.login(); });
  },
};

// Bridge for api.js to call when refresh fails
window.onAuthExpired = () => Auth.onAuthExpired();

Auth.init();
window.Auth = Auth;
