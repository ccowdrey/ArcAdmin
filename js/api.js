// ArcOS Admin — Supabase Config & API
// =====================================

const SUPA_URL = "https://agpsalkaajjivoytcipb.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFncHNhbGthYWpqaXZveXRjaXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDUxMDEsImV4cCI6MjA4NjQyMTEwMX0.rm3KLQIC4apB8Oe5zvYIhrsOdh8A_4oQgxMSqPdrUpo";

// ── State ──
let token = null;
let userRole = null; // 'super_admin' | 'company_admin'
let userCompanyId = null;
let userCompanyName = null;

// ── API Helper ──
async function supa(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function supaPost(table, data) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

async function supaPatch(path, data) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res;
}

async function supaDelete(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${token}`,
      "Prefer": "return=minimal"
    }
  });
  return res;
}

// ── Auth ──
async function supaLogin(email, password) {
  const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error("Invalid email or password");
  const data = await res.json();
  token = data.access_token;
  return data;
}

async function supaSignup(email, password, metadata = {}) {
  const res = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, data: metadata })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || data.error_description || "Signup failed");
  return data;
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
