// ArcAdmin — Supabase Config & API
// =================================
// 2026-04-23 update: added JWT auto-refresh. Wraps all request methods so that
// if the access token expires (PGRST303 / 401), we refresh once using the
// stored refresh_token and retry the original request. This fixes the
// "Good Van Co delete -> JWT expired" class of errors where the tab had been
// open longer than the token's 1-hour lifetime.

const SUPA_URL = "https://agpsalkaajjivoytcipb.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFncHNhbGthYWpqaXZveXRjaXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDUxMDEsImV4cCI6MjA4NjQyMTEwMX0.rm3KLQIC4apB8Oe5zvYIhrsOdh8A_4oQgxMSqPdrUpo";

// ── State ──
let token = null;
let refreshToken = null;
let userRole = null;         // 'super_admin' | 'company_admin'
let userCompanyId = null;
let userCompanyName = null;

// Prevents concurrent refresh storms: if 10 parallel requests all see a 401,
// they should share a single refresh call. This holds the in-flight refresh
// promise so subsequent callers await the same one.
let refreshInFlight = null;

// ── Internal: token persistence ──
const STORAGE_KEY = 'arcadmin_session';

function saveSession() {
  if (!token) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      access_token: token,
      refresh_token: refreshToken,
      saved_at: Date.now(),
    }));
  } catch (e) {
    console.warn('Failed to persist session:', e);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.access_token) return false;
    token = data.access_token;
    refreshToken = data.refresh_token || null;
    return true;
  } catch (e) {
    return false;
  }
}

function clearSession() {
  token = null;
  refreshToken = null;
  userRole = null;
  userCompanyId = null;
  userCompanyName = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

// ── Internal: JWT refresh ──
// Returns true if refresh succeeded, false otherwise. If false, caller should
// treat the session as expired and route to login.
async function refreshAccessToken() {
  if (!refreshToken) return false;
  
  // De-dupe concurrent refresh calls
  if (refreshInFlight) return refreshInFlight;
  
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        console.warn('Token refresh failed:', res.status);
        return false;
      }
      const data = await res.json();
      if (!data.access_token) return false;
      token = data.access_token;
      refreshToken = data.refresh_token || refreshToken;
      saveSession();
      console.log('🔄 Token refreshed successfully');
      return true;
    } catch (e) {
      console.warn('Token refresh error:', e);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  
  return refreshInFlight;
}

// ── Internal: detect if a fetch response indicates an expired token ──
async function isJwtExpired(res, bodyText) {
  if (res.status === 401) return true;
  if (res.status === 403) return false; // RLS denial — not a token issue
  // PGRST303 = "JWT expired" from PostgREST
  if (bodyText && bodyText.includes('PGRST303')) return true;
  if (bodyText && bodyText.toLowerCase().includes('jwt expired')) return true;
  return false;
}

// ── Internal: retry-on-expired wrapper ──
// Takes a function that builds and sends a fetch request. If the response
// indicates an expired JWT, we refresh once and re-run the builder with the
// new token, then return the second response. Never retries more than once.
async function withAuthRetry(requestFn) {
  let res = await requestFn();
  if (res.ok) return res;
  
  // Clone so we can read the body without consuming the response
  const clone = res.clone();
  let bodyText = '';
  try { bodyText = await clone.text(); } catch (e) {}
  
  if (await isJwtExpired(res, bodyText)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry once with the fresh token
      res = await requestFn();
    } else {
      // Refresh failed — session is dead. Clear and redirect to login.
      clearSession();
      if (typeof window !== 'undefined' && window.onAuthExpired) {
        window.onAuthExpired();
      }
    }
  }
  
  return res;
}

// ── API Helpers ──
// All fetch methods below go through withAuthRetry. The builder closure
// rebuilds headers on every call so the CURRENT token is used (important
// for retries after refresh).

async function supa(path) {
  const res = await withAuthRetry(() => fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }));
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPost(table, data, options = {}) {
  const preferParts = ['return=minimal'];
  if (options.upsert) preferParts.push('resolution=merge-duplicates');
  const res = await withAuthRetry(() => fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: preferParts.join(','),
    },
    body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

async function supaPatch(path, data) {
  const res = await withAuthRetry(() => fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

async function supaDelete(path) {
  const res = await withAuthRetry(() => fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=minimal',
    },
  }));
  // Caller decides whether to throw; preserve original behavior (no throw)
  return res;
}

// ── Auth ──
async function supaLogin(email, password) {
  const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Invalid email or password');
  const data = await res.json();
  token = data.access_token;
  refreshToken = data.refresh_token || null;
  saveSession();
  return data;
}

async function supaSignup(email, password, metadata = {}) {
  const res = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: metadata }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || 'Signup failed');
  return data;
}

async function supaInvite(email, metadata = {}) {
  const res = await withAuthRetry(() => fetch(`${SUPA_URL}/functions/v1/invite-admin`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: metadata.first_name || '',
      last_name: metadata.last_name || '',
    }),
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invite failed');
  return data;
}

// ── Background refresh timer ──
// Refresh every 45 minutes to stay well ahead of the 60-minute expiry.
// This keeps long-open tabs alive without needing a 401 retry to trigger.
let refreshTimer = null;

function startBackgroundRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (token && refreshToken) {
      refreshAccessToken().catch((e) => console.warn('Background refresh failed:', e));
    }
  }, 45 * 60 * 1000); // 45 minutes
}

function stopBackgroundRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ── Exports (global) ──
window.SUPA_URL = SUPA_URL;
window.SUPA_KEY = SUPA_KEY;
window.supa = supa;
window.supaPost = supaPost;
window.supaPatch = supaPatch;
window.supaDelete = supaDelete;
window.supaLogin = supaLogin;
window.supaSignup = supaSignup;
window.supaInvite = supaInvite;
window.loadSession = loadSession;
window.clearSession = clearSession;
window.saveSession = saveSession;
window.refreshAccessToken = refreshAccessToken;
window.startBackgroundRefresh = startBackgroundRefresh;
window.stopBackgroundRefresh = stopBackgroundRefresh;

// Attempt to restore session on page load
loadSession();