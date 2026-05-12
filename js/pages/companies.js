// ArcAdmin — Companies Page
// ==========================
// Handles BOTH the companies list AND the company detail page.
// Replaces the legacy two-module split (CompaniesPage + CompanyDetailPage).
//
// Detail page is tabbed: Overview | Build Lines | Manuals.
// The overflow menu (3-dots button) provides: Add Admin, Add Build Line, Delete.

const CompaniesPage = {
  // ── List state ──
  all: [],

  // ── Detail state ──
  companyId: null,
  company: null,
  clients: [],
  admins: [],
  activeTab: 'overview',

  // ═══════════════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════════════

  async load() {
    const listEl = document.getElementById('companiesList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading companies...</div>';

    try {
      const [companies, profiles, subs, admins] = await Promise.all([
        supa('companies?select=*&order=created_at.desc'),
        supa('profiles?select=id,company_id,first_name,last_name,email'),
        supa('subscriptions?select=user_id,tier,status'),
        supa('company_admins?select=*'),
      ]);

      this.all = companies.map((c) => {
        const clients = profiles.filter((p) => p.company_id === c.id);
        const clientSubs = clients.map((cl) => subs.find((s) => s.user_id === cl.id)).filter(Boolean);
        const companyAdmins = admins.filter((a) => a.company_id === c.id);
        Router.registerSlug(c.id, c.name);
        return {
          ...c,
          _clientCount: clients.length,
          _explorerCount: clientSubs.filter((s) => s.tier === 'explore' || s.tier === 'explorer').length,
        };
      });

      this.renderList(this.all);
    } catch (e) {
      console.error('Companies load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  renderList(rows) {
    const list = document.getElementById('companiesList');
    if (!list) return;

    if (!rows || rows.length === 0) {
      list.innerHTML = '<div class="data-empty">No companies yet. Click + Add Company to create one.</div>';
      return;
    }

    list.innerHTML = `
      <div class="data-table">
        <div class="data-table-headers">
          <div class="data-table-header col-name">Company</div>
          <div class="data-table-header col-email">Billing email</div>
          <div class="data-table-header col-vehicle">Clients</div>
          <div class="data-table-header col-last-active">Created</div>
        </div>
        ${rows.map((c) => `
          <button class="data-table-row" onclick="Router.navigate('/companies/${escHtml(Router.getSlug(c.id))}')">
            <div class="data-table-cell data-table-cell--bold col-name">${escHtml(c.name)}</div>
            <div class="data-table-cell col-email t-muted">${escHtml(c.billing_email || '—')}</div>
            <div class="data-table-cell col-vehicle t-muted">${c._clientCount || 0}</div>
            <div class="data-table-cell col-last-active t-muted">${escHtml(c.created_at ? formatDate(c.created_at) : '—')}</div>
          </button>
        `).join('')}
      </div>
    `;
  },

  filter() {
    const q = (document.getElementById('companiesSearch')?.value || '').toLowerCase();
    if (!q) { this.renderList(this.all); return; }
    const filtered = this.all.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.billing_email || '').toLowerCase().includes(q) ||
      (c.website || '').toLowerCase().includes(q)
    );
    this.renderList(filtered);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DETAIL
  // ═══════════════════════════════════════════════════════════════════════

  async loadDetail({ companyId }) {
    this.companyId = companyId;
    this.activeTab = 'overview';

    // Reset tab UI to Overview
    document.querySelectorAll('#pageCompanyDetail .tab[data-company-tab]').forEach((el) => {
      el.classList.toggle('tab--active', el.getAttribute('data-company-tab') === 'overview');
    });

    const nameEl = document.getElementById('companyDetailName');
    const emailEl = document.getElementById('companyDetailEmail');
    const contentEl = document.getElementById('companyDetailContent');
    if (nameEl) nameEl.textContent = 'Loading...';
    if (emailEl) emailEl.textContent = '';
    if (contentEl) contentEl.innerHTML = '<div class="data-empty">Loading company details...</div>';

    try {
      const [companyArr, profiles, subs, adminsArr] = await Promise.all([
        supa(`companies?id=eq.${companyId}&select=*`),
        supa(`profiles?company_id=eq.${companyId}&select=*`),
        supa('subscriptions?select=user_id,tier,status'),
        supa(`company_admins?company_id=eq.${companyId}&select=*`),
      ]);

      if (!companyArr[0]) {
        if (contentEl) contentEl.innerHTML = '<div class="data-empty">Company not found.</div>';
        return;
      }

      this.company = companyArr[0];

      // Enrich clients with their vehicle + tier
      const enrichedClients = await Promise.all(
        profiles.map(async (p) => {
          const vehicles = await supa(`vehicles?user_id=eq.${p.id}&select=*`);
          const sub = subs.find((s) => s.user_id === p.id);
          const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || (p.email || '').split('@')[0];
          Router.registerSlug(p.id, name);
          return {
            id: p.id,
            displayName: name,
            email: p.email,
            vehicle: vehicles[0],
            vehicleLabel: vehicles[0] ? [vehicles[0].year, vehicles[0].make, vehicles[0].model].filter(Boolean).join(' ') : '',
            tier: sub?.tier || 'base_camp',
            lastLogin: p.last_login_at,
          };
        })
      );
      this.clients = enrichedClients;

      // Enrich admins
      const enrichedAdmins = await Promise.all(
        adminsArr.map(async (a) => {
          const prof = await supa(`profiles?id=eq.${a.user_id}&select=*`);
          const p = prof[0] || {};
          return {
            id: a.user_id,
            adminRowId: a.id,
            role: a.role,
            createdAt: a.created_at,
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || '',
            email: p.email || '',
          };
        })
      );
      this.admins = enrichedAdmins;

      // Header
      const ownerAdmin = enrichedAdmins.find((a) => a.role === 'owner') || enrichedAdmins[0];
      if (nameEl) nameEl.textContent = this.company.name;
      if (emailEl) emailEl.textContent = this.company.billing_email || ownerAdmin?.email || '';

      this._renderTab();
    } catch (e) {
      console.error('Company detail load failed:', e);
      if (contentEl) contentEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('#pageCompanyDetail .tab[data-company-tab]').forEach((el) => {
      el.classList.toggle('tab--active', el.getAttribute('data-company-tab') === tab);
    });
    this._renderTab();
  },

  _renderTab() {
    const contentEl = document.getElementById('companyDetailContent');
    if (!contentEl || !this.company) return;

    if (this.activeTab === 'overview') {
      contentEl.innerHTML = this._renderOverview();
      // Overview references a #companyCodesList div — populate it async.
      this.loadCodes();
    } else if (this.activeTab === 'build-lines') {
      contentEl.innerHTML = '<div class="data-empty">Loading build lines...</div>';
      if (window.BuildLinesPage && BuildLinesPage.loadForCompany) {
        BuildLinesPage.loadForCompany(this.companyId, this.company.name, contentEl);
      }
    } else if (this.activeTab === 'manuals') {
      contentEl.innerHTML = '<div class="data-empty">Loading manuals...</div>';
      if (window.ManualsLibrary && ManualsLibrary.loadForCompany) {
        ManualsLibrary.loadForCompany(this.companyId, contentEl);
      } else {
        contentEl.innerHTML = '<div class="data-empty">Manuals library not available.</div>';
      }
    }
  },

  _renderOverview() {
    const c = this.company;
    const explorerCount = this.clients.filter((cl) => cl.tier === 'explore' || cl.tier === 'explorer').length;
    const baseCount = this.clients.filter((cl) => cl.tier === 'base_camp' || cl.tier === 'base').length;

    // Admins section
    const adminsMarkup = this.admins.length === 0
      ? '<div class="t-muted t-detail">No admins yet. Use the menu to add one.</div>'
      : this.admins.map((a) => `
          <div class="data-table-row data-table-row--static" style="padding:12px 16px">
            <div class="data-table-cell data-table-cell--bold" style="flex:1 1 200px;min-width:150px">${escHtml(a.name)}</div>
            <div class="data-table-cell t-muted" style="flex:1 1 220px;min-width:150px">${escHtml(a.email)}</div>
            <div class="data-table-cell" style="width:100px">
              <span class="badge ${a.role === 'owner' ? 'badge--tier-explorer' : 'badge--tier-base-camp'}">${escHtml(a.role || 'admin')}</span>
            </div>
            <div class="data-table-cell" style="width:80px;text-align:right">
              <button class="btn btn-ghost btn-sm" onclick="CompaniesPage.removeAdmin('${escHtml(a.adminRowId)}')">Remove</button>
            </div>
          </div>
        `).join('');

    // Clients section
    const clientsMarkup = this.clients.length === 0
      ? '<div class="t-muted t-detail">No clients yet.</div>'
      : `
        <div class="data-table-headers">
          <div class="data-table-header col-name">Name</div>
          <div class="data-table-header col-email">Email</div>
          <div class="data-table-header col-vehicle">Vehicle</div>
          <div class="data-table-header col-tier">Tier</div>
          <div class="data-table-header col-last-active">Last active</div>
        </div>
        ${this.clients.map((cl) => `
          <button class="data-table-row" onclick="Router.navigate('/companies/${escHtml(Router.getSlug(CompaniesPage.companyId))}/clients/${escHtml(Router.getSlug(cl.id))}')">
            <div class="data-table-cell data-table-cell--bold col-name">${escHtml(cl.displayName)}</div>
            <div class="data-table-cell col-email t-muted">${escHtml(cl.email || '')}</div>
            <div class="data-table-cell col-vehicle t-muted">${escHtml(cl.vehicleLabel || '—')}</div>
            <div class="data-table-cell col-tier">${tierBadge(cl.tier)}</div>
            <div class="data-table-cell col-last-active t-muted">${escHtml(cl.lastLogin ? timeAgo(cl.lastLogin) : '—')}</div>
          </button>
        `).join('')}
      `;

    // Brand / logo section
    // Preview box is sized for horizontal logos up to 200×56 (the iPad app
    // header is 24pt tall; we render the preview ~2.3× scale so builders
    // can see fine detail). Logos are object-fit:contain so anything from
    // a square mark to a 200×56 wordmark renders correctly inside the box.
    const logoMarkup = c.logo_url
      ? `
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div style="width:240px;height:80px;border-radius:12px;border:1px solid var(--border-default);background:var(--bg-muted);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;padding:8px">
            <img src="${escHtml(c.logo_url)}" style="max-width:100%;max-height:100%;object-fit:contain" onerror="this.style.display='none'">
          </div>
          <div style="flex:1;min-width:200px">
            <div class="t-body" style="font-weight:500">Custom logo uploaded</div>
            <div class="t-muted t-detail">Replaces the Arc logo in the ArcNode iPad app header for every client under this company.</div>
            <div style="margin-top:12px;display:flex;gap:8px">
              <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0">
                Replace
                <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" style="display:none" onchange="CompaniesPage.uploadLogo(this.files[0])">
              </label>
              <button class="btn btn-ghost btn-sm t-danger" onclick="CompaniesPage.removeLogo()">Remove</button>
            </div>
          </div>
        </div>
      `
      : `
        <label style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px;border:2px dashed var(--border-default);border-radius:8px;cursor:pointer;background:var(--bg-muted)"
               onmouseover="this.style.borderColor='var(--brand-primary)'"
               onmouseout="this.style.borderColor='var(--border-default)'">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-secondary)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div class="t-body">Upload company logo</div>
          <div class="t-muted t-detail">PNG, SVG, JPG, or WebP. Replaces the Arc logo in the ArcNode iPad app header for every client under this company. Recommended: horizontal wordmark on transparent background, up to 200×56 px (3.5:1) — the app scales to header height while preserving aspect ratio.</div>
          <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" style="display:none" onchange="CompaniesPage.uploadLogo(this.files[0])">
        </label>
      `;

    return `
      <div class="w-full flex flex-col gap-8">

        <div class="stat-grid">
          <div class="stat-tile">
            <div class="stat-tile-top">
              <span class="stat-tile-value">${this.clients.length}</span>
              <span class="stat-tile-label t-muted">Clients</span>
            </div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-top">
              <span class="stat-tile-value">${explorerCount}</span>
              <span class="stat-tile-label t-muted">Explorers</span>
            </div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-top">
              <span class="stat-tile-value">${baseCount}</span>
              <span class="stat-tile-label t-muted">Base Camp</span>
            </div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-top">
              <span class="stat-tile-value">—</span>
              <span class="stat-tile-label t-muted">Qtr Commission</span>
            </div>
            <span class="stat-delta stat-delta--neutral">Coming soon</span>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Brand</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">Custom logo shown in the ArcNode iPad app header for clients of this company.</div>
          ${logoMarkup}
        </div>

        <div class="card">
          <div class="card-title">Admins</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">People who can manage this company in ArcAdmin.</div>
          <div class="flex flex-col gap-2">${adminsMarkup}</div>
        </div>

        <div class="card">
          <div class="card-title">Invite codes</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">Clients enter these codes during onboarding to join this company.</div>
          <div id="companyCodesList"><div class="t-muted">Loading...</div></div>
          <div style="margin-top:16px">
            <button class="btn btn-secondary btn-sm" onclick="openModal('addCodeModal')">+ New invite code</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Clients</div>
          <div class="data-table">${clientsMarkup}</div>
        </div>

      </div>
    `;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // OVERFLOW MENU
  // ═══════════════════════════════════════════════════════════════════════

  toggleOverflow(event) {
    event.stopPropagation();
    const menu = document.getElementById('companyOverflowMenu');
    if (menu) menu.classList.toggle('hidden');
  },

  closeOverflow() {
    const menu = document.getElementById('companyOverflowMenu');
    if (menu) menu.classList.add('hidden');
  },

  addAdmin() {
    this.closeOverflow();
    openModal('addAdminModal');
  },

  addBuildLine() {
    this.closeOverflow();
    // Let BuildLinesPage handle the modal open with fresh state
    if (window.BuildLinesPage && BuildLinesPage.openAddModal) {
      BuildLinesPage.openAddModal(this.companyId);
    } else {
      openModal('buildLineModal');
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRAND / LOGO
  // ═══════════════════════════════════════════════════════════════════════

  async uploadLogo(file) {
    if (!file) return;
    if (!this.companyId) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Logo must be under 5 MB.');
      return;
    }
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      // Cache-bust by appending a timestamp — Supabase Storage caches public
      // URLs aggressively, so reusing the same path means the iPad app keeps
      // serving the old logo until the CDN TTL expires.
      const path = `company-logos/${this.companyId}-${Date.now()}.${ext}`;

      const uploadRes = await fetch(`${SUPA_URL}/storage/v1/object/van-manuals/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'image/png',
          'x-upsert': 'true',
        },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());

      const publicUrl = `${SUPA_URL}/storage/v1/object/public/van-manuals/${path}`;
      await supaPatch(`companies?id=eq.${this.companyId}`, { logo_url: publicUrl });

      this.company.logo_url = publicUrl;
      // Re-render the overview tab to show the new logo
      this._renderTab();
    } catch (e) {
      alert(`Logo upload failed: ${e.message}`);
    }
  },

  async removeLogo() {
    if (!this.companyId) return;
    if (!confirm('Remove the custom logo? Clients will see the Arc logo again on their next launch.')) return;
    try {
      await supaPatch(`companies?id=eq.${this.companyId}`, { logo_url: null });
      this.company.logo_url = null;
      this._renderTab();
    } catch (e) {
      alert(`Remove failed: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ADMIN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  async confirmAddAdmin(event) {
    const name = document.getElementById('newAdminName').value.trim();
    const email = document.getElementById('newAdminEmail').value.trim();
    const role = document.getElementById('newAdminRole').value;
    const errBox = document.getElementById('addAdminError');
    errBox.classList.add('hidden');

    if (!name || !email) {
      errBox.textContent = 'Name and email required.';
      errBox.classList.remove('hidden');
      return;
    }

    await withBtnLoading(event, async () => {
      try {
        const [firstName, ...rest] = name.split(' ');
        const lastName = rest.join(' ');

        // 1. Send the invite. The edge function creates the auth user (if new)
        //    and sends the Loops email. The response MAY include the user id.
        const inviteResult = await supaInvite(email, { first_name: firstName, last_name: lastName });

        // 2. Resolve the user id. Try (in order):
        //    a) the id from the invite response
        //    b) the id from an existing profile by email
        //    c) retry profile lookup up to 5x with short backoff (the auth
        //       user may have been created but the profiles trigger might
        //       not have committed yet).
        let userId =
          inviteResult?.user_id ||
          inviteResult?.user?.id ||
          inviteResult?.id ||
          null;

        if (!userId) {
          for (let attempt = 0; attempt < 5; attempt++) {
            const rows = await supa(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
            if (rows[0]?.id) { userId = rows[0].id; break; }
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        if (!userId) {
          throw new Error(
            'The invite email was sent, but we could not locate the user record. ' +
            'Ask the user to confirm their email, then try adding them again.'
          );
        }

        // 3. Ensure a profiles row exists with the provided name. The invite
        //    edge function should create this via a trigger, but some environments
        //    don't have the trigger installed — upsert as a safety net.
        try {
          await supaPost('profiles', {
            id: userId,
            email,
            first_name: firstName || '',
            last_name: lastName || '',
          }, { upsert: true });
        } catch (_) {
          // Non-fatal: the profile row likely already exists
        }

        // 4. Link to this company as an admin. Duplicate insert will be
        //    rejected by the unique constraint, so catch and continue.
        try {
          await supaPost('company_admins', {
            user_id: userId,
            company_id: this.companyId,
            role: role || 'admin',
          });
        } catch (linkErr) {
          // If they're already an admin of this company, that's fine —
          // only re-throw if it's a different error.
          if (!String(linkErr.message || linkErr).toLowerCase().includes('duplicate')) {
            throw linkErr;
          }
        }

        closeModals();
        document.getElementById('newAdminName').value = '';
        document.getElementById('newAdminEmail').value = '';

        showToast(`Admin added — invite sent to ${email}`, 'success');

        if (Auth.isCompanyAdmin() && window.DashboardPage && window.location.pathname.includes('dashboard')) {
          await DashboardPage.load();
        } else {
          await this.loadDetail({ companyId: this.companyId });
        }
      } catch (e) {
        console.error('[Companies] confirmAddAdmin failed:', e);
        errBox.textContent = e.message || 'Failed to add admin.';
        errBox.classList.remove('hidden');
      }
    });
  },

  async removeAdmin(adminRowId) {
    if (!confirm('Remove this admin from the company?')) return;
    try {
      await supaDelete(`company_admins?id=eq.${adminRowId}`);
      await this.loadDetail({ companyId: this.companyId });
    } catch (e) {
      alert(`Failed to remove: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // INVITE CODES
  // ═══════════════════════════════════════════════════════════════════════

  async loadCodes() {
    const listEl = document.getElementById('companyCodesList');
    if (!listEl) return;

    try {
      const codes = await supa(
        `company_codes?company_id=eq.${this.companyId}&select=*&order=created_at.desc`
      );

      if (!codes || codes.length === 0) {
        listEl.innerHTML = '<div class="t-muted t-detail">No invite codes yet.</div>';
        return;
      }

      listEl.innerHTML = codes.map((c) => {
        const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
        const isExhausted = c.max_uses != null && (c.current_uses ?? 0) >= c.max_uses;
        const active = c.is_active && !isExpired && !isExhausted;

        let statusBadge;
        if (!c.is_active)     statusBadge = '<span class="badge badge--tier-base-camp">Disabled</span>';
        else if (isExpired)   statusBadge = '<span class="badge badge--danger">Expired</span>';
        else if (isExhausted) statusBadge = '<span class="badge badge--danger">Exhausted</span>';
        else                  statusBadge = '<span class="badge badge--success">Active</span>';

        const usageText = c.max_uses != null
          ? `${c.current_uses || 0} / ${c.max_uses} uses`
          : `${c.current_uses || 0} uses`;

        const expiryText = c.expires_at
          ? `Expires ${formatDate(c.expires_at)}`
          : 'No expiry';

        return `
          <div class="data-table-row data-table-row--static" style="padding:12px 14px;gap:12px">
            <div style="flex:1 1 180px;min-width:140px">
              <div class="t-body" style="font-weight:600;font-family:ui-monospace,monospace;letter-spacing:1px">${escHtml(c.code)}</div>
              ${c.label ? `<div class="t-muted" style="font-size:11px;margin-top:2px">${escHtml(c.label)}</div>` : ''}
            </div>
            <div class="t-muted t-detail" style="width:140px">${escHtml(usageText)}</div>
            <div class="t-muted t-detail" style="width:160px">${escHtml(expiryText)}</div>
            <div style="width:100px">${statusBadge}</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" onclick="CompaniesPage.toggleCode('${escHtml(c.id)}', ${!c.is_active})">${c.is_active ? 'Disable' : 'Enable'}</button>
              <button class="btn btn-ghost btn-sm t-danger" onclick="CompaniesPage.deleteCode('${escHtml(c.id)}')">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('[Codes] load failed:', e);
      listEl.innerHTML = `<div class="t-danger t-detail">Failed to load codes — ${escHtml(e.message || '')}</div>`;
    }
  },

  async toggleCode(codeId, setActive) {
    try {
      await supaPatch(`company_codes?id=eq.${codeId}`, { is_active: setActive });
      await this.loadCodes();
    } catch (e) {
      alert(`Failed to update code: ${e.message}`);
    }
  },

  async deleteCode(codeId) {
    if (!confirm('Delete this invite code? Any clients who already used it will keep their company link.')) return;
    try {
      await supaDelete(`company_codes?id=eq.${codeId}`);
      await this.loadCodes();
    } catch (e) {
      alert(`Failed to delete code: ${e.message}`);
    }
  },

  async createCode(event) {
    const value = document.getElementById('newCodeValue').value.trim().toUpperCase();
    const label = document.getElementById('newCodeLabel').value.trim();
    const maxUses = document.getElementById('newCodeMaxUses').value;
    const expires = document.getElementById('newCodeExpires').value;
    const errBox = document.getElementById('addCodeError');
    errBox.classList.add('hidden');

    if (!value) {
      errBox.textContent = 'Code is required.';
      errBox.classList.remove('hidden');
      return;
    }

    await withBtnLoading(event, async () => {
      try {
        await supaPost('company_codes', {
          company_id: this.companyId,
          code: value,
          label: label || null,
          max_uses: maxUses ? parseInt(maxUses, 10) : null,
          expires_at: expires ? localDateToUTCEnd(expires) : null,
          is_active: true,
        });
        closeModals();
        document.getElementById('newCodeValue').value = '';
        document.getElementById('newCodeLabel').value = '';
        document.getElementById('newCodeMaxUses').value = '';
        document.getElementById('newCodeExpires').value = '';

        showToast(`Invite code ${value} created`, 'success');

        if (Auth.isCompanyAdmin() && window.DashboardPage && window.location.pathname.includes('dashboard')) {
          await DashboardPage.load();
        } else {
          await this.loadCodes();
        }
      } catch (e) {
        errBox.textContent = e.message || 'Failed to create code.';
        errBox.classList.remove('hidden');
      }
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DELETE COMPANY
  // ═══════════════════════════════════════════════════════════════════════

  async deleteCompany() {
    this.closeOverflow();
    if (!this.company) return;

    const typed = prompt(
      `This will permanently delete "${this.company.name}" and remove all associated admins and invite codes. ` +
      `Client profiles will be unlinked but not deleted.\n\nType the company name to confirm:`
    );
    if (typed === null) return;
    if (typed.trim() !== this.company.name) {
      alert("Company name didn't match. Deletion cancelled.");
      return;
    }

    try {
      await supaDelete(`companies?id=eq.${this.companyId}`);
      Router.navigate('companies');
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE COMPANY (from list page's + Add Company button)
  // ═══════════════════════════════════════════════════════════════════════

  async createCompany() {
    const name = document.getElementById('newCompanyName').value.trim();
    const adminName = document.getElementById('newCompanyAdminName').value.trim();
    const adminEmail = document.getElementById('newCompanyAdminEmail').value.trim();
    const billingEmail = document.getElementById('newCompanyBillingEmail').value.trim();
    const website = document.getElementById('newCompanyWebsite').value.trim();
    const errBox = document.getElementById('addCompanyError');
    errBox.classList.add('hidden');

    if (!name || !adminEmail) {
      errBox.textContent = 'Company name and admin email required.';
      errBox.classList.remove('hidden');
      return;
    }

    try {
      // 1. Create the company
      const res = await fetch(`${SUPA_URL}/rest/v1/companies`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          name,
          website: website || null,
          billing_email: billingEmail || adminEmail,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const [newCompany] = await res.json();

      // 2. Invite the admin
      if (adminEmail) {
        try {
          const [firstName, ...rest] = adminName.split(' ');
          await supaInvite(adminEmail, { first_name: firstName || '', last_name: rest.join(' ') });
          // Link the new auth user to this company as owner
          const profiles = await supa(`profiles?email=eq.${encodeURIComponent(adminEmail)}&select=id`);
          if (profiles[0]) {
            await supaPost('company_admins', {
              user_id: profiles[0].id,
              company_id: newCompany.id,
              role: 'owner',
            });
          }
        } catch (inviteErr) {
          console.warn('Admin invite had an issue (company still created):', inviteErr);
        }
      }

      closeModals();
      ['newCompanyName', 'newCompanyAdminName', 'newCompanyAdminEmail', 'newCompanyBillingEmail', 'newCompanyWebsite']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
      Router.navigate(`/companies/${Router.getSlug(newCompany.id)}`);
    } catch (e) {
      errBox.textContent = e.message || 'Failed to create company.';
      errBox.classList.remove('hidden');
    }
  },
};

// Backward compat — legacy code paths referenced CompanyDetailPage by name
window.CompaniesPage = CompaniesPage;
window.CompanyDetailPage = CompaniesPage;