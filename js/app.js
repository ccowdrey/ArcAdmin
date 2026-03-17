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
      // Update subtitle based on flow type
      const subEl = document.querySelector('#setPasswordPage .sub');
      if (subEl) subEl.textContent = type === 'recovery' ? 'Set New Password' : 'Set Your Password';
      const descEl = document.querySelector('#setPasswordPage .login-box > div[style*="13px"]');
      if (descEl && type === 'recovery') descEl.textContent = "Enter a new password for your account.";
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
// ── Forgot Password Handlers ──
function showForgotPassword(e) {
  e.preventDefault();
  document.getElementById("forgotEmail").value = document.getElementById("loginEmail").value;
  document.getElementById("forgotError").classList.add("hidden");
  showForgotStep1();
  hide("loginPage");
  show("forgotPasswordPage");
  setTimeout(() => document.getElementById("forgotEmail").focus(), 100);
}

function showForgotStep1(e) {
  if (e) e.preventDefault();
  document.getElementById("forgotStep1").classList.remove("hidden");
  document.getElementById("forgotStep2").classList.add("hidden");
  document.getElementById("forgotSubtitle").textContent = "Reset Password";
  document.getElementById("forgotError").classList.add("hidden");
  document.getElementById("forgotBtn").disabled = false;
  document.getElementById("forgotBtn").textContent = "Send Reset Code";
}

function showLogin(e) {
  e.preventDefault();
  hide("forgotPasswordPage");
  show("loginPage");
  setTimeout(() => document.getElementById("loginEmail").focus(), 100);
}

async function handleForgotPassword() {
  const email = document.getElementById("forgotEmail").value.trim();
  const errEl = document.getElementById("forgotError");
  const btn = document.getElementById("forgotBtn");

  errEl.classList.add("hidden");

  if (!email) {
    errEl.textContent = "Please enter your email address";
    errEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, type: "recovery", create_user: false })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.msg || data.error_description || "Failed to send code");
    }

    // Move to step 2
    document.getElementById("forgotStep1").classList.add("hidden");
    document.getElementById("forgotStep2").classList.remove("hidden");
    document.getElementById("forgotSubtitle").textContent = "Check Your Email";
    document.getElementById("forgotToken").value = "";
    document.getElementById("resetPassword").value = "";
    document.getElementById("resetConfirmPassword").value = "";
    setTimeout(() => document.getElementById("forgotToken").focus(), 100);

  } catch (e) {
    errEl.textContent = e.message || "Failed to send reset code";
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Send Reset Code";
  }
}

async function handleResetPassword() {
  const email = document.getElementById("forgotEmail").value.trim();
  const token_val = document.getElementById("forgotToken").value.trim();
  const password = document.getElementById("resetPassword").value;
  const confirm = document.getElementById("resetConfirmPassword").value;
  const errEl = document.getElementById("forgotError");
  const btn = document.getElementById("resetBtn");

  errEl.classList.add("hidden");

  if (!token_val) { errEl.textContent = "Please enter the code from your email"; errEl.classList.remove("hidden"); return; }
  if (!password || password.length < 8) { errEl.textContent = "Password must be at least 8 characters"; errEl.classList.remove("hidden"); return; }
  if (password !== confirm) { errEl.textContent = "Passwords do not match"; errEl.classList.remove("hidden"); return; }

  btn.disabled = true;
  btn.textContent = "Verifying...";

  try {
    // Verify OTP to get a session
    const verifyRes = await fetch(`${SUPA_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, token: token_val, type: "recovery" })
    });

    if (!verifyRes.ok) {
      const data = await verifyRes.json();
      throw new Error(data.msg || data.error_description || "Invalid or expired code");
    }

    const session = await verifyRes.json();
    const sessionToken = session.access_token;

    // Update password using the verified session
    btn.textContent = "Setting password...";
    const updateRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (!updateRes.ok) {
      const data = await updateRes.json();
      throw new Error(data.msg || data.error_description || "Failed to update password");
    }

    // Success — go back to login
    hide("forgotPasswordPage");
    show("loginPage");
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginError").textContent = "";
    // Show a brief success message in the login error box (reuse it as info)
    const loginErr = document.getElementById("loginError");
    loginErr.style.background = "#2ABC5320";
    loginErr.style.borderColor = "#2ABC5340";
    loginErr.style.color = "#2ABC53";
    loginErr.textContent = "Password updated! Sign in with your new password.";
    loginErr.classList.remove("hidden");
    setTimeout(() => {
      loginErr.classList.add("hidden");
      loginErr.style.background = "";
      loginErr.style.borderColor = "";
      loginErr.style.color = "";
    }, 5000);
    setTimeout(() => document.getElementById("loginPassword").focus(), 100);

  } catch (e) {
    errEl.textContent = e.message || "Failed to reset password";
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Set New Password";
  }
}