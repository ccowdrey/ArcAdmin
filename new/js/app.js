// ArcOS Admin — App Initialization
// ==================================

document.addEventListener("DOMContentLoaded", () => {
  // Login form
  document.getElementById("loginEmail").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  document.getElementById("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  
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
function handleSignout() { Auth.signout(); }