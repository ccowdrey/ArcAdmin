// ArcOS Admin — App Initialization
// ==================================

document.addEventListener("DOMContentLoaded", () => {
  // ── Check for invite/recovery token in URL hash ──
  const hash = window.location.hash.substring(1);
  if (hash) {
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const type = params.get('type');
    
    if (accessToken && (type === 'invite' || type === 'recovery')) {
      // Store the token and show set-password page
      token = accessToken;
      hide('loginPage');
      hide('appShell');
      show('setPasswordPage');
      // Clear the hash from the URL
      history.replaceState(null, '', window.location.pathname);
      // Focus the password field
      setTimeout(() => document.getElementById('newPassword')?.focus(), 100);
      return; // Don't proceed with normal init
    }
  }
  
  // Login form
  document.getElementById("loginEmail").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  document.getElementById("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  
  // Set password form
  document.getElementById("newPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("confirmPassword")?.focus(); });
  document.getElementById("confirmPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") handleSetPassword(); });
  
  // Set max date on all date pickers
  const today = localDate();
  document.querySelectorAll('input[type="date"]').forEach(el => { el.max = today; });
  
  // Register routes
  Router.on('/login', () => {
    hide('appShell');
    show('loginPage');
  });
  
  Router.on('/users', () => {
    if (!token) { Router.navigate('/login'); return; }
    if (!Auth.isSuper()) { Router.navigate('/'); return; }
    UsersPage.load();
  });
  
  Router.on('/users/:userId', (params) => {
    if (!token) { Router.navigate('/login'); return; }
    UserDetailPage.load(params);
  });
  
  Router.on('/companies', () => {
    if (!token) { Router.navigate('/login'); return; }
    if (!Auth.isSuper()) { Router.navigate('/'); return; }
    CompaniesPage.load();
  });
  
  Router.on('/companies/:companyId', (params) => {
    if (!token) { Router.navigate('/login'); return; }
    CompanyDetailPage.load(params);
  });
  
  Router.on('/trips', () => {
    if (!token) { Router.navigate('/login'); return; }
    if (!Auth.isSuper()) { Router.navigate('/'); return; }
    TripsPage.load();
  });
  
  Router.on('/companies/:companyId/clients/:clientId', (params) => {
    if (!token) { Router.navigate('/login'); return; }
    UserDetailPage.load({ userId: Router.resolveId(params.clientId) });
  });
  
  Router.on('/', () => {
    if (!token) { Router.navigate('/login'); return; }
    if (Auth.isSuper()) Router.navigate('/users');
    else if (Auth.isCompanyAdmin()) Router.navigate(`/companies/${userCompanyId}`);
    else Router.navigate('/login');
  });
  
  // Initialize router
  Router.init();
  
  // Start on login if no token
  if (!token) {
    const path = window.location.pathname;
    if (path === '/' || path === '/login' || path === '') {
      Router.navigate('/login', false);
    }
  }
});

// ── Login Handler ──
async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");
  
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Signing in...";
  
  try {
    await Auth.login(email, password);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
  
  btn.disabled = false;
  btn.textContent = "Sign In";
}

// ── Nav handlers (called from HTML) ──
function navUsers() { Router.navigate('/users'); }
function navCompanies() { Router.navigate('/companies'); }
function navTrips() { Router.navigate('/trips'); }
function handleSignout() { Auth.signout(); }

// ── Set Password Handler (invite flow) ──
async function handleSetPassword() {
  const password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const errEl = document.getElementById('setPasswordError');
  const successEl = document.getElementById('setPasswordSuccess');
  const btn = document.getElementById('setPasswordBtn');
  
  errEl.classList.add('hidden');
  successEl.classList.add('hidden');
  
  if (!password || password.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.classList.remove('hidden');
    return;
  }
  
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match';
    errEl.classList.remove('hidden');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Setting password...';
  
  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.msg || data.error_description || 'Failed to set password');
    }
    
    successEl.textContent = 'Password set! Redirecting to login...';
    successEl.classList.remove('hidden');
    
    // Sign out the invite token session, redirect to login
    token = null;
    setTimeout(() => {
      hide('setPasswordPage');
      show('loginPage');
      Router.navigate('/login', false);
    }, 2000);
    
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
  
  btn.disabled = false;
  btn.textContent = 'Set Password';
}