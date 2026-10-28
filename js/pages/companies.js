// ArcAdmin — Companies Page
// ==========================
// Handles BOTH the companies list AND the company detail page.
// Replaces the legacy two-module split (CompaniesPage + CompanyDetailPage).
//
// Detail page tabs: Overview | Build Lines | Manuals | AI Questions
// The overflow menu (3-dots button) provides: Add Admin, Add Build Line, Delete.
//
// 2026-05-16 update: added AI Questions tab. Pulls user-role chat_messages
// from clients linked to this company (via profiles.company_id OR
// build_lines.company_id → vehicles → users), renders a paginated table, and
// offers a "Synthesize" button that calls the synthesize-ai-questions Edge
// Function to cluster themes via Claude.

const CompaniesPage = {
  // ── List state ──
  all: [],

  // Company detail → Clients card (sortable, 25 per page)
  clientsView: new ListView({
    ref: 'CompaniesPage.clientsView',
    columns: CLIENT_COLUMNS,
    sortKey: 'name',
    noun: 'client',
    rowHtml: (u) => clientRowHtml(u, `/companies/${Router.getSlug(CompaniesPage.companyId)}/clients/${Router.getSlug(u.id)}`),
    // Re-render just the clients list, not the whole overview tab.
    onChange: () => CompaniesPage._renderClientsList(),
  }),
  _clientsQuery: '',

  filterClients(q) {
    this._clientsQuery = q || '';
    this.clientsView.setRows(this._filteredClients());
    this._renderClientsList();
  },

  _filteredClients() {
    const q = this._clientsQuery.trim().toLowerCase();
    if (!q) return this.clients;
    return this.clients.filter((u) =>
      u.displayName.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.vehicleLabel || '').toLowerCase().includes(q)
    );
  },

  _clientsListMarkup() {
    if (this.clients.length === 0) return '<div class="t-muted t-detail">No clients yet.</div>';
    if (this.clientsView.rows.length === 0) return '<div class="t-muted t-detail">No clients match your search.</div>';
    return this.clientsView.html();
  },

  _renderClientsList() {
    const el = document.getElementById('companyClientsList');
    if (el) el.innerHTML = this._clientsListMarkup();
  },

  // ── Detail state ──
  companyId: null,
  company: null,
  clients: [],
  admins: [],
  activeTab: 'overview',

  // ── AI Questions tab state ──
  _aiQuestions: [],
  _aiQuestionsPage: 1,
  _aiQuestionsPerPage: 25,
  _aiQuestionsLoaded: false,
  _aiSynthesis: null, // { summary, themes, total_questions, window }

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

    // Reset AI Questions state when switching companies
    this._aiQuestions = [];
    this._aiQuestionsPage = 1;
    this._aiQuestionsLoaded = false;
    this._aiSynthesis = null;

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
      // Find clients via TWO paths and merge:
      //   1. profiles.company_id = this company   (the canonical path)
      //   2. vehicles.build_line_id → build_lines where company_id = this company
      //      (defense-in-depth: catches users whose profile.company_id wasn't
      //      set during the brittle pre-RPC onboarding flow)
      //
      // We fetch build_lines for this company first to get their IDs, then
      // pull vehicles whose build_line_id is in that set. Dedupe by user_id.
      const [companyArr, profilesByCompany, subs, adminsArr, buildLinesForCompany] = await Promise.all([
        supa(`companies?id=eq.${companyId}&select=*`),
        supa(`profiles?company_id=eq.${companyId}&select=*`),
        supa('subscriptions?select=user_id,tier,status'),
        this.fetchStaff(companyId),
        supa(`build_lines?company_id=eq.${companyId}&select=id`),
      ]);

      if (!companyArr[0]) {
        if (contentEl) contentEl.innerHTML = '<div class="data-empty">Company not found.</div>';
        return;
      }

      this.company = companyArr[0];

      // Builder branding (dashboard background). Super admins only — the
      // company_branding table is admin-only under RLS, and ArcNode approves
      // branding rather than builders. A failed read never blocks the page.
      this.branding = null;
      if (Auth.isSuper()) {
        try {
          const brandingArr = await supa(`company_branding?company_id=eq.${companyId}&select=*`);
          this.branding = brandingArr[0] || null;
        } catch (e) {
          console.warn('company_branding load failed:', e.message);
        }
      }

      // Second-path: pull vehicles whose build_line belongs to this company,
      // then fetch the owning profile for each. We need this because some
      // users may have vehicle.build_line_id set but profile.company_id NULL
      // (legacy onboarding race condition).
      let profilesByBuildLine = [];
      const blIds = (buildLinesForCompany || []).map((bl) => bl.id);
      if (blIds.length > 0) {
        // PostgREST `in` filter takes comma-separated values in parens.
        const inList = blIds.join(',');
        const vehicles = await supa(`vehicles?build_line_id=in.(${inList})&select=user_id`);
        const userIds = [...new Set(vehicles.map((v) => v.user_id).filter(Boolean))];
        if (userIds.length > 0) {
          profilesByBuildLine = await supa(
            `profiles?id=in.(${userIds.join(',')})&select=*`
          );
        }
      }

      // Merge + dedupe by id. Path 1 wins on duplicate (canonical source).
      const byId = new Map();
      for (const p of profilesByCompany) byId.set(p.id, p);
      for (const p of profilesByBuildLine) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      const profiles = Array.from(byId.values());

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
      this._clientsQuery = '';
      this.clientsView.setRows(enrichedClients);

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

      // Fill "Last active" with the same signals as the client detail page.
      const clients = this.clients;
      const lastActive = await fetchLastActive(clients);
      clients.forEach((cl) => { cl.lastActive = lastActive.get(cl.id) || null; });
      if (clients === this.clients) {
        // Refresh only the list so a search in progress keeps focus.
        this.clientsView.setRows(this._filteredClients(), { keepPage: true });
        this._renderClientsList();
      }
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
      if (Auth.isSuper()) this._updateColorPreview();
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
    } else if (this.activeTab === 'ai-questions') {
      this._renderAIQuestionsTab(contentEl);
    }
  },

  _renderOverview() {
    const c = this.company;
    const explorerCount = this.clients.filter((cl) => cl.tier === 'explore' || cl.tier === 'explorer').length;
    const baseCount = this.clients.filter((cl) => cl.tier === 'base_camp' || cl.tier === 'base').length;

    const adminsMarkup = this.admins.length === 0
      ? '<div class="t-muted t-detail">No admins yet. Use the menu to add one.</div>'
      : this.admins.map((a) => `
          <div class="data-table-row data-table-row--static" style="padding:12px 16px">
            <div class="data-table-cell data-table-cell--bold" style="flex:1 1 200px;min-width:150px">${escHtml(a.name)}</div>
            <div class="data-table-cell t-muted" style="flex:1 1 220px;min-width:150px">${escHtml(a.email)}</div>
            <div class="data-table-cell" style="width:120px">${CompaniesPage.staffRoleControl(a)}</div>
            <div class="data-table-cell" style="width:80px;text-align:right">
              <button class="btn btn-ghost btn-sm" onclick="CompaniesPage.removeAdmin('${escHtml(a.id)}', '${escHtml(a.name)}', event)">Remove</button>
            </div>
          </div>
        `).join('');

    this.clientsView.setRows(this._filteredClients(), { keepPage: true });
    const clientsMarkup = this._clientsListMarkup();

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

    // Dashboard background (super admins only). The iPad downloads it once and
    // keeps it on the device, so it also shows offline. Preview is 4:3 like
    // the iPad screen, object-fit:cover like the app.
    const backgroundUrl = this.branding?.background_url;
    const backgroundMarkup = !Auth.isSuper() ? '' : backgroundUrl
      ? `
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:24px">
          <div style="width:240px;aspect-ratio:4/3;border-radius:12px;border:1px solid var(--border-default);background:var(--bg-muted);overflow:hidden;flex-shrink:0">
            <img src="${escHtml(backgroundUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">
          </div>
          <div style="flex:1;min-width:200px">
            <div class="t-body" style="font-weight:500">Dashboard background uploaded</div>
            <div class="t-muted t-detail">Replaces the time-of-day backgrounds on the ArcNode iPad dashboard for every client under this company. iPads pick it up on their next online launch.</div>
            <div style="margin-top:12px;display:flex;gap:8px">
              <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0">
                Replace
                <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="CompaniesPage.uploadBackground(this.files[0])">
              </label>
              <button class="btn btn-ghost btn-sm t-danger" onclick="CompaniesPage.removeBackground()">Remove</button>
            </div>
          </div>
        </div>
      `
      : `
        <label style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px;border:2px dashed var(--border-default);border-radius:8px;cursor:pointer;background:var(--bg-muted);margin-top:24px"
               onmouseover="this.style.borderColor='var(--brand-primary)'"
               onmouseout="this.style.borderColor='var(--border-default)'">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-secondary)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div class="t-body">Upload dashboard background</div>
          <div class="t-muted t-detail">JPG, PNG, or WebP, under 10 MB. Replaces the time-of-day backgrounds on the ArcNode iPad dashboard for every client under this company. Recommended: landscape photo, 2732×2048 px, JPG. The app adds a light/dark overlay so cards stay readable.</div>
          <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="CompaniesPage.uploadBackground(this.files[0])">
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
          ${backgroundMarkup}
          ${Auth.isSuper() ? this._brandColorMarkup() : ''}
        </div>

        <div class="card">
          <div class="card-title">Admins</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">People who can manage this company in ArcAdmin. Support staff only see Clients and Support.</div>
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
          ${this.clients.length > 0 ? `
            <div class="search-input" style="margin-bottom:16px">
              <input type="text" id="companyClientsSearch" placeholder="Search by name, email, or vehicle"
                value="${escHtml(this._clientsQuery)}" oninput="CompaniesPage.filterClients(this.value)">
              <div class="search-input-icon">
                <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
            </div>
          ` : ''}
          <div id="companyClientsList">${clientsMarkup}</div>
        </div>

      </div>
    `;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AI QUESTIONS TAB
  // ═══════════════════════════════════════════════════════════════════════
  // Public API:
  //   loadAIQuestionsForCompany(companyId, containerEl)  — entry point used
  //     by both the super-admin tab and the ModelsPage / company-admin tab.
  //
  // Internal state lives on the CompaniesPage object so the synthesis result
  // and pagination survive tab switches without a refetch.

  async loadAIQuestionsForCompany(companyId, containerEl) {
    this.companyId = companyId;
    if (!containerEl) return;
    this._renderAIQuestionsTab(containerEl);
  },

  _renderAIQuestionsTab(contentEl) {
    if (!contentEl) return;
    // First render: skeleton + kick off load
    contentEl.innerHTML = `
      <div class="w-full flex flex-col gap-6">
        <div class="card">
          <div class="flex items-center justify-between" style="margin-bottom:8px;gap:16px;flex-wrap:wrap">
            <div>
              <div class="card-title" style="margin-bottom:4px">AI Questions</div>
              <div class="t-muted t-detail">Questions your clients are asking ArcInsight, the in-app AI assistant.</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <select id="aiQuestionsWindow" onchange="CompaniesPage.reloadAIQuestions()" style="padding:6px 10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:13px">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
              </select>
              <button class="btn btn-primary btn-sm" id="aiSynthesizeBtn" onclick="CompaniesPage.synthesizeAIQuestions(event)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px">
                  <path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M5.6 18.4l2.1-2.1M12 18v3M16.3 16.3l2.1 2.1M18 12h3M16.3 7.7l2.1-2.1"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Synthesize
              </button>
            </div>
          </div>
          <div id="aiSynthesisBlock" style="margin-top:16px">
            ${this._aiSynthesis ? this._renderSynthesisBlock() : '<div class="t-muted t-detail">Click <strong>Synthesize</strong> to cluster these questions into themes and get suggested actions.</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Recent questions</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">All user-typed questions, newest first.</div>
          <div id="aiQuestionsList">
            <div class="t-muted t-detail">Loading...</div>
          </div>
        </div>
      </div>
    `;

    if (!this._aiQuestionsLoaded) {
      this._fetchAIQuestions();
    } else {
      this._renderAIQuestionsList();
    }
  },

  async _fetchAIQuestions() {
    const listEl = document.getElementById('aiQuestionsList');
    if (listEl) listEl.innerHTML = '<div class="t-muted t-detail">Loading...</div>';

    try {
      // Resolve the company's client user_ids (same union logic as the
      // company-admin dashboard: profiles.company_id OR build_lines → vehicles).
      const clientIds = await this._resolveCompanyClientIds(this.companyId);

      if (clientIds.length === 0) {
        this._aiQuestions = [];
        this._aiQuestionsLoaded = true;
        if (listEl) listEl.innerHTML = '<div class="t-muted t-detail">No clients linked to this company yet.</div>';
        return;
      }

      const windowDays = parseInt(document.getElementById('aiQuestionsWindow')?.value || '30', 10);
      const since = new Date(Date.now() - windowDays * 86400000).toISOString();

      // chat_messages has no user_id column — we go through chat_sessions.
      // 1) Find sessions belonging to these clients.
      const sessions = await supa(
        `chat_sessions?user_id=in.(${clientIds.join(',')})&select=id,user_id`
      );

      if (!sessions || sessions.length === 0) {
        this._aiQuestions = [];
        this._aiQuestionsLoaded = true;
        this._aiQuestionsPage = 1;
        if (listEl) listEl.innerHTML = '<div class="t-muted t-detail">No AI sessions in this window.</div>';
        return;
      }

      // session_id -> user_id lookup so we can attribute each question
      const sessionUserMap = {};
      for (const s of sessions) sessionUserMap[s.id] = s.user_id;
      const sessionIds = sessions.map((s) => s.id);

      // 2) Fetch user-role messages from those sessions, in chunks to avoid
      //    URL-length issues for companies with thousands of sessions.
      const chunkSize = 200;
      let messages = [];
      for (let i = 0; i < sessionIds.length; i += chunkSize) {
        const chunk = sessionIds.slice(i, i + chunkSize);
        const batch = await supa(
          `chat_messages?session_id=in.(${chunk.join(',')})&is_user=eq.true&created_at=gte.${since}&select=id,session_id,content,is_user,created_at&order=created_at.desc&limit=1000`
        );
        messages = messages.concat(batch || []);
        if (messages.length >= 1000) {
          messages = messages.slice(0, 1000);
          break;
        }
      }

      // 3) Enrich each message with the asking user's name/email
      const userIdsInResults = Array.from(new Set(
        messages.map((m) => sessionUserMap[m.session_id]).filter(Boolean)
      ));
      let profileMap = {};
      if (userIdsInResults.length > 0) {
        const profs = await supa(
          `profiles?id=in.(${userIdsInResults.join(',')})&select=id,first_name,last_name,email`
        );
        for (const p of profs) {
          const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || (p.email || '').split('@')[0] || '—';
          profileMap[p.id] = { name, email: p.email || '' };
        }
      }

      this._aiQuestions = messages.map((m) => {
        const uid = sessionUserMap[m.session_id];
        return {
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          user_id: uid,
          session_id: m.session_id,
          userName: profileMap[uid]?.name || '—',
          userEmail: profileMap[uid]?.email || '',
        };
      });
      this._aiQuestionsLoaded = true;
      this._aiQuestionsPage = 1;

      this._renderAIQuestionsList();
    } catch (e) {
      console.error('AI Questions load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="t-danger t-detail">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  // Returns the array of user_ids who are clients of the given company,
  // unioned across profiles.company_id and build_lines → vehicles ownership.
  async _resolveCompanyClientIds(companyId) {
    try {
      const [buildLines, directProfiles] = await Promise.all([
        supa(`build_lines?company_id=eq.${companyId}&select=id`),
        supa(`profiles?company_id=eq.${companyId}&select=id`),
      ]);

      const buildLineIds = buildLines.map((b) => b.id);
      let vehicleUserIds = [];
      if (buildLineIds.length > 0) {
        const vehs = await supa(
          `vehicles?build_line_id=in.(${buildLineIds.join(',')})&select=user_id`
        );
        vehicleUserIds = vehs.map((v) => v.user_id).filter(Boolean);
      }

      return Array.from(new Set([
        ...directProfiles.map((p) => p.id),
        ...vehicleUserIds,
      ]));
    } catch (e) {
      console.error('[CompaniesPage] _resolveCompanyClientIds failed:', e);
      return [];
    }
  },

  reloadAIQuestions() {
    this._aiQuestionsLoaded = false;
    this._aiSynthesis = null;
    const synthBlock = document.getElementById('aiSynthesisBlock');
    if (synthBlock) {
      synthBlock.innerHTML = '<div class="t-muted t-detail">Click <strong>Synthesize</strong> to cluster these questions into themes and get suggested actions.</div>';
    }
    this._fetchAIQuestions();
  },

  _renderAIQuestionsList() {
    const listEl = document.getElementById('aiQuestionsList');
    if (!listEl) return;

    const total = this._aiQuestions.length;
    if (total === 0) {
      listEl.innerHTML = '<div class="t-muted t-detail">No AI questions in this window.</div>';
      return;
    }

    const perPage = this._aiQuestionsPerPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, this._aiQuestionsPage), totalPages);
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageRows = this._aiQuestions.slice(startIdx, endIdx);

    const tableMarkup = `
      <div style="overflow-x:auto;border:1px solid var(--border-default);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--bg-muted);text-align:left">
              <th style="padding:10px 12px;font-weight:500;color:var(--text-dark);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;width:60%">Question</th>
              <th style="padding:10px 12px;font-weight:500;color:var(--text-dark);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;width:25%">Asked by</th>
              <th style="padding:10px 12px;font-weight:500;color:var(--text-dark);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;width:15%;white-space:nowrap">Date</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((q) => `
              <tr>
                <td style="padding:10px 12px;border-top:1px solid var(--border-subtle);color:var(--text-primary);line-height:1.4">${escHtml(q.content || '')}</td>
                <td style="padding:10px 12px;border-top:1px solid var(--border-subtle);color:var(--text-secondary);white-space:nowrap">
                  <div style="font-weight:500;color:var(--text-primary)">${escHtml(q.userName)}</div>
                  ${q.userEmail ? `<div style="font-size:11px;color:var(--text-muted)">${escHtml(q.userEmail)}</div>` : ''}
                </td>
                <td style="padding:10px 12px;border-top:1px solid var(--border-subtle);color:var(--text-secondary);white-space:nowrap;font-size:12px">
                  ${escHtml(formatDateTime(q.created_at))}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const pageButtons = totalPages > 1
      ? `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
          <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
          <div style="display:flex;align-items:center;gap:4px">
            <button class="btn btn-ghost btn-sm" onclick="CompaniesPage._goToAIPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
            <span class="t-muted" style="padding:0 8px">Page ${page} of ${totalPages}</span>
            <button class="btn btn-ghost btn-sm" onclick="CompaniesPage._goToAIPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next ›</button>
          </div>
        </div>
      `
      : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} question${total === 1 ? '' : 's'} in this window</div>`;

    listEl.innerHTML = tableMarkup + pageButtons;
  },

  _goToAIPage(page) {
    const totalPages = Math.ceil(this._aiQuestions.length / this._aiQuestionsPerPage);
    this._aiQuestionsPage = Math.max(1, Math.min(totalPages, page));
    this._renderAIQuestionsList();
  },

  async synthesizeAIQuestions(event) {
    const synthBlock = document.getElementById('aiSynthesisBlock');
    if (!synthBlock) return;

    const windowDays = parseInt(document.getElementById('aiQuestionsWindow')?.value || '30', 10);
    synthBlock.innerHTML = `
      <div class="t-muted t-detail" style="display:flex;align-items:center;gap:8px">
        <div class="spinner" style="width:14px;height:14px;border:2px solid var(--border-default);border-top-color:var(--brand-primary);border-radius:50%;animation:spin 0.8s linear infinite"></div>
        Synthesizing themes with Claude...
      </div>
    `;

    await withBtnLoading(event, async () => {
      try {
        const res = await fetch(`${SUPA_URL}/functions/v1/synthesize-ai-questions`, {
          method: 'POST',
          headers: {
            apikey: SUPA_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            company_id: this.companyId,
            since_days: windowDays,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        this._aiSynthesis = data;
        synthBlock.innerHTML = this._renderSynthesisBlock();
      } catch (e) {
        console.error('[AI Questions] synthesize failed:', e);
        synthBlock.innerHTML = `
          <div class="t-danger t-detail" style="padding:12px;background:var(--danger-bg,rgba(220,38,38,0.08));border-radius:8px">
            Synthesis failed — ${escHtml(e.message || '')}
          </div>
        `;
      }
    });
  },

  _renderSynthesisBlock() {
    const s = this._aiSynthesis;
    if (!s) return '';
    const themes = Array.isArray(s.themes) ? s.themes : [];
    const total = s.total_questions || 0;

    if (themes.length === 0) {
      return `<div class="t-muted t-detail">${escHtml(s.summary || 'No themes identified.')}</div>`;
    }

    const themeCards = themes.map((t, i) => {
      const examples = Array.isArray(t.example_questions) ? t.example_questions : [];
      return `
        <div style="padding:14px 16px;background:var(--bg-muted);border:1px solid var(--border-subtle);border-radius:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
            <div class="t-body" style="font-weight:600">${escHtml(t.title || `Theme ${i + 1}`)}</div>
            <span class="badge badge--tier-explorer" style="white-space:nowrap">${t.count || 0} ${(t.count || 0) === 1 ? 'question' : 'questions'}</span>
          </div>
          ${examples.length > 0 ? `
            <div style="margin:8px 0">
              ${examples.slice(0, 3).map((q) => `
                <div class="t-muted t-detail" style="padding:4px 0;font-style:italic">"${escHtml(q)}"</div>
              `).join('')}
            </div>
          ` : ''}
          ${t.suggested_action ? `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)">
              <span class="t-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600">Suggested action</span>
              <div class="t-body" style="font-size:13px;margin-top:4px">${escHtml(t.suggested_action)}</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="flex flex-col gap-3">
        ${s.summary ? `
          <div style="padding:14px 16px;background:var(--brand-primary-10,rgba(118,123,251,0.08));border-left:3px solid var(--brand-primary);border-radius:6px">
            <div class="t-body" style="line-height:1.5">${escHtml(s.summary)}</div>
            <div class="t-muted" style="font-size:11px;margin-top:6px">Based on ${total.toLocaleString()} question${total === 1 ? '' : 's'}</div>
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:8px">${themeCards}</div>
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
  // BRAND / DASHBOARD BACKGROUND (super admins only)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Saved on company_branding.background_url. Any write bumps the row's
  // updated_at, which is what tells iPads to re-download on next launch.

  async uploadBackground(file) {
    if (!file) return;
    if (!this.companyId || !Auth.isSuper()) return;
    // iPads give up on a download after 30s; keep files small enough to land
    // on van wifi.
    if (file.size > 10 * 1024 * 1024) {
      alert('Background must be under 10 MB. Save it as a JPG at 2732×2048 px.');
      return;
    }
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      // Timestamped path for the same CDN cache reason as the logo.
      const path = `company-backgrounds/${this.companyId}-${Date.now()}.${ext}`;

      const uploadRes = await fetch(`${SUPA_URL}/storage/v1/object/van-manuals/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'image/jpeg',
          'x-upsert': 'true',
        },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());

      const publicUrl = `${SUPA_URL}/storage/v1/object/public/van-manuals/${path}`;
      // Upsert only background_url so an existing colour is left as is.
      await supaPost('company_branding', { company_id: this.companyId, background_url: publicUrl }, { upsert: true });

      this.branding = { ...(this.branding || {}), company_id: this.companyId, background_url: publicUrl };
      this._renderTab();
    } catch (e) {
      alert(`Background upload failed: ${e.message}`);
    }
  },

  async removeBackground() {
    if (!this.companyId || !Auth.isSuper()) return;
    if (!confirm('Remove the dashboard background? Clients will see the standard ArcNode backgrounds again on their next online launch.')) return;
    try {
      await supaPatch(`company_branding?company_id=eq.${this.companyId}`, { background_url: null });
      if (this.branding) this.branding.background_url = null;
      this._renderTab();
    } catch (e) {
      alert(`Remove failed: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRAND / COLOUR (super admins only)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // company_branding.primary_hex replaces ArcNode purple in the iPad app.
  // primary_light_hex / primary_text_hex are optional; when blank the iPad
  // derives them exactly as _brandDerive() does here (30% toward white /
  // 20% toward black), so the preview matches the device.
  //
  // Contrast targets are the ones ArcNode purple itself meets (ArcDS):
  //   buttons / highlights (UI, bold labels)  >= 3:1   (WCAG 1.4.11)
  //   coloured text in light mode             >= 4.5:1 (WCAG 1.4.3)
  // They are shown as guidance; saving a failing colour asks to confirm.

  _brandDefaults: { primary: '#767DFB', light: '#9B9FFC', text: '#5B63E0' },

  _brandColorMarkup() {
    const b = this.branding || {};
    const primary = b.primary_hex || '';
    const field = (id, label, value, placeholder, hint) => `
      <div style="display:flex;flex-direction:column;gap:6px;min-width:180px;flex:1">
        <label class="t-detail" for="${id}Hex" style="font-weight:500">${label}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="color" id="${id}Picker" value="${escHtml(this._brandNormHex(value) || this._brandNormHex(placeholder) || '#767DFB')}"
                 style="width:40px;height:36px;padding:0;border:1px solid var(--border-default);border-radius:8px;background:none;cursor:pointer"
                 oninput="document.getElementById('${id}Hex').value=this.value.toUpperCase();CompaniesPage._updateColorPreview()">
          <input type="text" id="${id}Hex" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}" maxlength="7"
                 style="flex:1;font-family:monospace"
                 oninput="const h=CompaniesPage._brandNormHex(this.value);if(h)document.getElementById('${id}Picker').value=h;CompaniesPage._updateColorPreview()">
        </div>
        <div class="t-muted t-detail">${hint}</div>
      </div>`;

    return `
      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border-default)">
        <div class="t-body" style="font-weight:500">Brand colour</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">Replaces ArcNode purple (buttons, highlights, selected tabs) in the iPad app for every client under this company. iPads pick it up on their next online launch. ArcRemote stays ArcNode purple.</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${field('brandPrimary', 'Primary', primary, '#767DFB', 'Blank = ArcNode purple.')}
          ${field('brandLight', 'Light (optional)', b.primary_light_hex || '', 'auto', 'Gradients and accents. Blank = derived.')}
          ${field('brandText', 'Text (optional)', b.primary_text_hex || '', 'auto', 'Coloured text in light mode. Blank = derived.')}
        </div>

        <div id="brandColorPreview" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:20px"></div>
        <div id="brandColorChecks" style="margin-top:16px"></div>

        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="CompaniesPage.saveBrandColors()">Save colour</button>
          ${primary ? '<button class="btn btn-ghost btn-sm t-danger" onclick="CompaniesPage.resetBrandColors()">Reset to ArcNode purple</button>' : ''}
        </div>
      </div>
    `;
  },

  /** '#abc123' / 'abc123' → '#ABC123'; anything else → null. */
  _brandNormHex(v) {
    const m = String(v || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
    return m ? `#${m[1].toUpperCase()}` : null;
  },

  _brandRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  /** Same blend the iPad uses (BrandingManager.mix). */
  _brandMix(hex, toward, t) {
    const a = this._brandRgb(hex);
    const b = this._brandRgb(toward);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  },

  _brandContrast(hexA, hexB) {
    const lum = (hex) => {
      const [r, g, b] = this._brandRgb(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [l1, l2] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  },

  /** Colours as the iPad will resolve them from the current form values. */
  _brandResolved() {
    const val = (id) => document.getElementById(id)?.value || '';
    const primary = this._brandNormHex(val('brandPrimaryHex'));
    if (!primary) return { primary: null, ...this._brandDefaults };
    return {
      primary,
      light: this._brandNormHex(val('brandLightHex')) || this._brandMix(primary, '#FFFFFF', 0.3),
      text: this._brandNormHex(val('brandTextHex')) || this._brandMix(primary, '#000000', 0.2),
    };
  },

  /** The contrast rows, each { label, ratio, min }. */
  _brandChecks(c) {
    const primary = c.primary || this._brandDefaults.primary;
    return [
      { label: 'Light-mode button: white label on primary', ratio: this._brandContrast('#FFFFFF', primary), min: 3 },
      { label: 'Dark-mode button: dark label (#242526) on primary', ratio: this._brandContrast('#242526', primary), min: 3 },
      { label: 'Dark-mode highlight: primary on dark background (#242526)', ratio: this._brandContrast(primary, '#242526'), min: 3 },
      { label: 'Light-mode coloured text: text colour on white', ratio: this._brandContrast(c.text, '#FFFFFF'), min: 4.5 },
    ];
  },

  _updateColorPreview() {
    const previewEl = document.getElementById('brandColorPreview');
    const checksEl = document.getElementById('brandColorChecks');
    if (!previewEl || !checksEl) return;
    const c = this._brandResolved();
    const primary = c.primary || this._brandDefaults.primary;

    const card = (bg, label, labelColor, textColor, title) => `
      <div style="flex:1;min-width:220px;border-radius:12px;padding:16px;background:${bg};border:1px solid var(--border-default)">
        <div style="font-size:12px;color:${textColor};opacity:.7;margin-bottom:10px">${title}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="background:${primary};color:${labelColor};font-weight:600;padding:8px 16px;border-radius:10px">${label}</span>
          <span style="width:36px;height:20px;border-radius:10px;background:${primary};display:inline-block"></span>
          <span style="background:linear-gradient(90deg,${primary},${c.light});width:56px;height:20px;border-radius:6px;display:inline-block"></span>
        </div>
        <div style="margin-top:10px;font-weight:600;color:${bg === '#FFFFFF' ? c.text : '#FFFFFF'}">Selected tab · Coloured text</div>
      </div>`;
    previewEl.innerHTML =
      card('#FFFFFF', 'Continue', '#FFFFFF', '#1A1A1A', 'Light mode') +
      card('#242526', 'Continue', '#242526', '#F5F1EB', 'Dark mode');

    checksEl.innerHTML = this._brandChecks(c).map((r) => {
      const ok = r.ratio >= r.min;
      return `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--border-default)">
          <span class="t-detail">${r.label}</span>
          <span class="t-detail" style="white-space:nowrap;font-weight:600;color:${ok ? 'var(--success, #1E8E3E)' : 'var(--danger, #D93025)'}">
            ${r.ratio.toFixed(2)}:1 ${ok ? '✓' : `✗ needs ${r.min}:1`}
          </span>
        </div>`;
    }).join('');
  },

  async saveBrandColors() {
    if (!this.companyId || !Auth.isSuper()) return;
    // Blank or "auto" (the Light/Text placeholder) both mean "not set".
    const raw = (id) => {
      const v = (document.getElementById(id)?.value || '').trim();
      return v.toLowerCase() === 'auto' ? '' : v;
    };
    const primary = this._brandNormHex(raw('brandPrimaryHex'));
    const light = raw('brandLightHex') ? this._brandNormHex(raw('brandLightHex')) : null;
    const text = raw('brandTextHex') ? this._brandNormHex(raw('brandTextHex')) : null;

    // Blank primary = ArcNode purple. Light/Text only shade a builder colour,
    // so they are cleared with it (the iPad would otherwise mix them with purple).
    if (!raw('brandPrimaryHex')) {
      try {
        if (this.branding) {
          await supaPatch(`company_branding?company_id=eq.${this.companyId}`,
            { primary_hex: null, primary_light_hex: null, primary_text_hex: null });
          Object.assign(this.branding, { primary_hex: null, primary_light_hex: null, primary_text_hex: null });
        }
        this._renderTab();
        if (typeof showToast === 'function') showToast('Saved — ArcNode purple. iPads update on next online launch', 'success');
      } catch (e) {
        alert(`Save failed: ${e.message}`);
      }
      return;
    }
    if (!primary) { alert('Primary must be a 6-digit hex like #FF7A1A, or blank for ArcNode purple.'); return; }
    if (raw('brandLightHex') && !light) { alert('Light colour must be a 6-digit hex, or blank.'); return; }
    if (raw('brandTextHex') && !text) { alert('Text colour must be a 6-digit hex, or blank.'); return; }

    const failing = this._brandChecks(this._brandResolved()).filter((r) => r.ratio < r.min);
    if (failing.length && !confirm(
      `This colour fails ${failing.length} contrast check${failing.length > 1 ? 's' : ''}:\n\n` +
      failing.map((r) => `• ${r.label}: ${r.ratio.toFixed(2)}:1 (needs ${r.min}:1)`).join('\n') +
      '\n\nSave anyway?'
    )) return;

    try {
      const row = { company_id: this.companyId, primary_hex: primary, primary_light_hex: light, primary_text_hex: text };
      await supaPost('company_branding', row, { upsert: true });
      this.branding = { ...(this.branding || {}), ...row };
      this._renderTab();
      if (typeof showToast === 'function') showToast('Brand colour saved — iPads update on next online launch', 'success');
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  },

  async resetBrandColors() {
    if (!this.companyId || !Auth.isSuper()) return;
    if (!confirm('Reset to ArcNode purple? Clients will see ArcNode purple again on their next online launch.')) return;
    try {
      await supaPatch(`company_branding?company_id=eq.${this.companyId}`,
        { primary_hex: null, primary_light_hex: null, primary_text_hex: null });
      if (this.branding) Object.assign(this.branding, { primary_hex: null, primary_light_hex: null, primary_text_hex: null });
      this._renderTab();
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
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

        const inviteResult = await supaInvite(email, { first_name: firstName, last_name: lastName });

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

        try {
          await supaPost('profiles', {
            id: userId,
            email,
            first_name: firstName || '',
            last_name: lastName || '',
          }, { upsert: true });
        } catch (_) {}

        if (role === 'support') {
          // Support staff live in support_members, not company_admins.
          await supaRpc('set_company_staff_role', {
            p_user_id: userId, p_company_id: this.companyId, p_role: 'support',
          });
        } else {
          try {
            await supaPost('company_admins', {
              user_id: userId,
              company_id: this.companyId,
              role: role || 'admin',
            });
          } catch (linkErr) {
            if (!String(linkErr.message || linkErr).toLowerCase().includes('duplicate')) {
              throw linkErr;
            }
          }
        }

        closeModals();
        document.getElementById('newAdminName').value = '';
        document.getElementById('newAdminEmail').value = '';
        document.getElementById('newAdminRole').value = 'admin';

        showToast(`${role === 'support' ? 'Support staff' : 'Admin'} added — invite sent to ${email}`, 'success');

        await this._reloadStaff();
      } catch (e) {
        console.error('[Companies] confirmAddAdmin failed:', e);
        errBox.textContent = e.message || 'Failed to add admin.';
        errBox.classList.remove('hidden');
      }
    });
  },

  // Owners/admins (company_admins) and support staff (support_members) as one
  // list, shaped like a company_admins row plus `kind`.
  async fetchStaff(companyId) {
    const [admins, support] = await Promise.all([
      supa(`company_admins?company_id=eq.${companyId}&select=id,user_id,role,created_at`),
      supa(`support_members?company_id=eq.${companyId}&select=id,user_id,created_at`).catch(() => []),
    ]);
    return [
      ...admins.map((a) => ({ ...a, role: a.role || 'admin', kind: 'admin' })),
      ...support.map((m) => ({ ...m, role: 'support', kind: 'support' })),
    ];
  },

  // Role picker for a staff row (`a.id` = user id). Your own row is a badge:
  // the RPC refuses self-changes so nobody locks themselves out.
  staffRoleControl(a) {
    const role = a.role || 'admin';
    const me = parseJwtPayload(token)?.sub;
    if (a.id === me) {
      return `<span class="badge ${role === 'owner' ? 'badge--tier-explorer' : 'badge--tier-base-camp'}">${escHtml(role)}</span>`;
    }
    const opts = [['owner', 'Owner'], ['admin', 'Admin'], ['support', 'Support']]
      .map(([v, l]) => `<option value="${v}"${v === role ? ' selected' : ''}>${l}</option>`).join('');
    return `<select class="staff-role-select" aria-label="Role" data-prev="${escHtml(role)}"
      onchange="CompaniesPage.setStaffRole('${escHtml(a.id)}', this.value, this)">${opts}</select>`;
  },

  async setStaffRole(userId, role, selectEl) {
    if (selectEl) selectEl.disabled = true;
    try {
      await supaRpc('set_company_staff_role', {
        p_user_id: userId, p_company_id: this.companyId, p_role: role,
      });
      showToast(role === 'support' ? 'Switched to Support (Clients and Support only)' : `Switched to ${role}`, 'success');
      await this._reloadStaff();
    } catch (e) {
      if (selectEl) { selectEl.value = selectEl.dataset.prev || 'admin'; selectEl.disabled = false; }
      showToast(`Couldn't change role — ${String(e.message || e).slice(0, 200)}`, 'error');
    }
  },

  async removeAdmin(userId, name, event) {
    if (!confirm(`Remove ${name || 'this person'} from the company? They'll lose access to ArcAdmin for this company.`)) return;
    await withBtnLoading(event, async () => {
      try {
        await supaRpc('set_company_staff_role', {
          p_user_id: userId, p_company_id: this.companyId, p_role: null,
        });
        showToast(`${name || 'Admin'} removed`, 'success');
        await this._reloadStaff();
      } catch (e) {
        showToast(`Failed to remove — ${String(e.message || e).slice(0, 200)}`, 'error');
      }
    });
  },

  // The admins list shows on the company page (Arc staff) and the builder
  // dashboard (company admins).
  async _reloadStaff() {
    if (Auth.isCompanyAdmin() && window.DashboardPage && window.location.pathname.includes('dashboard')) {
      await DashboardPage.load();
    } else {
      await this.loadDetail({ companyId: this.companyId });
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

      if (adminEmail) {
        try {
          const [firstName, ...rest] = adminName.split(' ');
          await supaInvite(adminEmail, { first_name: firstName || '', last_name: rest.join(' ') });
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

window.CompaniesPage = CompaniesPage;
window.CompanyDetailPage = CompaniesPage;
