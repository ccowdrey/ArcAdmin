// ArcAdmin — Dashboard Page
// ==========================
// Combined view: greeting, 4 stat tiles (Companies, Clients, Explorers, Revenue),
// tabbed list between All users and Companies, client-side search filter.
// Revenue is a placeholder until Phase 2 brings in Stripe attribution.

const DashboardPage = {
  allUsers: [],
  allCompanies: [],
  activeTab: 'all-users',
  stats: null,

  async load() {
    this._renderGreeting();

    // Company admins get a completely different dashboard — their own company,
    // their invite codes, their admin list, their clients.
    if (Auth.isCompanyAdmin()) {
      await this._loadCompanyAdminDashboard();
      return;
    }

    this._renderTilesLoading();
    this._renderListLoading();

    try {
      const [users, subs, companyAdmins, companies, vehicles] = await Promise.all([
        supa('profiles?select=*&order=created_at.desc'),
        supa('subscriptions?select=user_id,tier,status'),
        supa('company_admins?select=user_id,company_id,role'),
        supa('companies?select=id,name,created_at,billing_email'),
        supa('vehicles?select=user_id,make,model,year,build_line_id'),
      ]);

      // Build lookups
      const subMap = {};
      subs.forEach((s) => { subMap[s.user_id] = s; });
      const vehicleMap = {};
      vehicles.forEach((v) => { if (!vehicleMap[v.user_id]) vehicleMap[v.user_id] = v; });
      const adminUserIds = new Set(companyAdmins.map((a) => a.user_id));
      const vehicleUserIds = new Set(vehicles.map((v) => v.user_id));
      const companyById = {};
      companies.forEach((c) => { companyById[c.id] = c; });

      // Enrich users and register slugs
      const enrichedUsers = users.map((u) => {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || (u.email || '').split('@')[0];
        Router.registerSlug(u.id, name);
        const sub = subMap[u.id];
        const v = vehicleMap[u.id];
        return {
          id: u.id,
          firstName: u.first_name || '',
          lastName: u.last_name || '',
          displayName: name,
          email: u.email,
          tier: sub?.tier || 'base_camp',
          tierStatus: sub?.status || 'inactive',
          isAdmin: !!u.is_admin,
          lastLogin: u.last_login_at,
          createdAt: u.created_at,
          vehicleLabel: v ? [v.year, v.make, v.model].filter(Boolean).join(' ').trim() : '',
        };
      });

      // Register slugs for companies too (used for deep links)
      companies.forEach((c) => Router.registerSlug(c.id, c.name));

      // Clients list = users who have a vehicle (actual customers, not admin-only rows)
      this.allUsers = enrichedUsers.filter((u) => vehicleUserIds.has(u.id) || u.isAdmin || !adminUserIds.has(u.id));
      this.allCompanies = companies.map((c) => {
        // Count clients attached to this company via their build_line
        const companyClientCount = vehicles.filter((v) => {
          // we need build_lines to map company, but that'd be another fetch; approximate via company_admins for now
          return false;
        }).length;
        return {
          id: c.id,
          name: c.name,
          email: c.billing_email || '',
          createdAt: c.created_at,
          clientCount: companyClientCount,
        };
      });

      // Stats
      const paidCount = subs.filter((s) => s.tier !== 'base_camp' && s.status === 'active').length;
      this.stats = {
        companies: companies.length,
        clients: vehicleUserIds.size,
        explorers: paidCount,
        revenue: null, // Phase 2
      };

      this._renderTiles();
      this._renderList();
    } catch (e) {
      console.error('Dashboard load failed:', e);
      document.getElementById('dashboardList').innerHTML =
        `<div class="data-empty">Failed to load dashboard — ${escHtml(e.message || 'unknown error')}</div>`;
    }
  },

  // ── Greeting ──
  _renderGreeting() {
    const name = (Auth._userName || 'there').split(' ')[0];
    const el = document.getElementById('dashboardGreeting');
    if (el) el.textContent = `${timeOfDayGreeting()}, ${name}`;
  },

  // ── Tiles ──
  _renderTilesLoading() {
    const grid = document.getElementById('dashboardStats');
    if (!grid) return;
    grid.innerHTML = [0, 1, 2, 3].map(() => `
      <div class="stat-tile">
        <div class="stat-tile-top">
          <span class="stat-tile-value t-dim">—</span>
        </div>
      </div>
    `).join('');
  },

  _renderTiles() {
    const s = this.stats || {};
    const grid = document.getElementById('dashboardStats');
    if (!grid) return;

    const tile = (value, label, delta) => `
      <div class="stat-tile">
        <div class="stat-tile-top">
          <span class="stat-tile-value">${value}</span>
          <span class="stat-tile-label t-muted">${escHtml(label)}</span>
        </div>
        ${delta ? `<span class="stat-delta stat-delta--neutral">${escHtml(delta)}</span>` : ''}
      </div>
    `;

    grid.innerHTML = [
      tile(s.companies ?? 0, 'Companies', null),
      tile(s.clients ?? 0, 'Clients', null),
      tile(s.explorers ?? 0, 'Explorers', null),
      tile(s.revenue == null ? '—' : `$${Number(s.revenue).toLocaleString()}`, 'Revenue', 'Coming soon'),
    ].join('');
  },

  // ── List ──
  _renderListLoading() {
    const list = document.getElementById('dashboardList');
    if (list) list.innerHTML = '<div class="data-empty">Loading...</div>';
  },

  _renderList() {
    const search = (document.getElementById('dashboardSearch')?.value || '').toLowerCase();
    const list = document.getElementById('dashboardList');
    if (!list) return;

    if (this.activeTab === 'all-users') {
      const filtered = search
        ? this.allUsers.filter((u) =>
            u.displayName.toLowerCase().includes(search) ||
            (u.email || '').toLowerCase().includes(search) ||
            u.vehicleLabel.toLowerCase().includes(search)
          )
        : this.allUsers;

      if (filtered.length === 0) {
        list.innerHTML = `<div class="data-empty">${search ? 'No users match your search' : 'No users yet'}</div>`;
        return;
      }

      list.innerHTML = `
        <div class="data-table">
          <div class="data-table-headers">
            <div class="data-table-header col-name">Name</div>
            <div class="data-table-header col-email">Email</div>
            <div class="data-table-header col-vehicle">Vehicle</div>
            <div class="data-table-header col-tier">Tier</div>
            <div class="data-table-header col-last-active">Last active</div>
          </div>
          ${filtered.map((u) => `
            <button class="data-table-row" onclick="Router.navigate('/clients/${escHtml(Router.getSlug(u.id))}')">
              <div class="data-table-cell data-table-cell--bold col-name">${escHtml(u.displayName)}</div>
              <div class="data-table-cell col-email t-muted">${escHtml(u.email || '')}</div>
              <div class="data-table-cell col-vehicle t-muted">${escHtml(u.vehicleLabel || '—')}</div>
              <div class="data-table-cell col-tier">${tierBadge(u.tier)}</div>
              <div class="data-table-cell col-last-active t-muted">${escHtml(u.lastLogin ? timeAgo(u.lastLogin) : '—')}</div>
            </button>
          `).join('')}
        </div>
      `;
    } else {
      const filtered = search
        ? this.allCompanies.filter((c) =>
            c.name.toLowerCase().includes(search) ||
            (c.email || '').toLowerCase().includes(search)
          )
        : this.allCompanies;

      if (filtered.length === 0) {
        list.innerHTML = `<div class="data-empty">${search ? 'No companies match your search' : 'No companies yet'}</div>`;
        return;
      }

      list.innerHTML = `
        <div class="data-table">
          <div class="data-table-headers">
            <div class="data-table-header col-name">Name</div>
            <div class="data-table-header col-email">Billing email</div>
            <div class="data-table-header col-vehicle">Clients</div>
            <div class="data-table-header col-last-active">Created</div>
          </div>
          ${filtered.map((c) => `
            <button class="data-table-row" onclick="Router.navigate('/companies/${escHtml(Router.getSlug(c.id))}')">
              <div class="data-table-cell data-table-cell--bold col-name">${escHtml(c.name)}</div>
              <div class="data-table-cell col-email t-muted">${escHtml(c.email || '—')}</div>
              <div class="data-table-cell col-vehicle t-muted">${c.clientCount ?? 0}</div>
              <div class="data-table-cell col-last-active t-muted">${escHtml(c.createdAt ? formatDate(c.createdAt) : '—')}</div>
            </button>
          `).join('')}
        </div>
      `;
    }
  },

  // ── Tab switching ──
  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('#dashboardTabs .tab').forEach((el) => {
      el.classList.toggle('tab--active', el.getAttribute('data-tab') === tab);
    });
    // Update search placeholder to match
    const input = document.getElementById('dashboardSearch');
    if (input) input.placeholder = tab === 'all-users' ? 'Search users' : 'Search companies';
    this._renderList();
  },

  // ── Search ──
  filter() {
    this._renderList();
  },

  // ════════════════════════════════════════════════════════════════════
  // COMPANY ADMIN DASHBOARD
  // Different layout: company-scoped stats, admins card, invite codes card,
  // and their own client list.
  // ════════════════════════════════════════════════════════════════════

  async _loadCompanyAdminDashboard() {
    const pageEl = document.getElementById('pageDashboard');
    if (!pageEl) return;
    if (!userCompanyId) {
      pageEl.innerHTML = '<div class="data-empty">No company associated with this account.</div>';
      return;
    }

    pageEl.innerHTML = `
      <div class="page-greeting" id="dashGreeting"></div>
      <div class="t-muted" style="margin-bottom:24px" id="dashCompanyLine">${escHtml(userCompanyName || 'Your company')}</div>

      <div class="stat-grid" id="dashStatsCA">
        <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">—</span><span class="stat-tile-label t-muted">Clients</span></div></div>
        <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">—</span><span class="stat-tile-label t-muted">Explorers</span></div></div>
        <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">—</span><span class="stat-tile-label t-muted">Build Lines</span></div></div>
        <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">—</span><span class="stat-tile-label t-muted">Active Codes</span></div></div>
      </div>

      <div class="card" style="margin-top:24px">
        <div class="flex items-center justify-between" style="margin-bottom:8px">
          <div>
            <div class="card-title" style="margin-bottom:4px">Admins</div>
            <div class="t-muted t-detail">People who can manage this company in ArcAdmin.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openModal('addAdminModal')">+ Add Admin</button>
        </div>
        <div id="dashAdminsList" style="margin-top:16px">
          <div class="t-muted t-detail">Loading admins...</div>
        </div>
      </div>

      <div class="card" style="margin-top:24px">
        <div class="flex items-center justify-between" style="margin-bottom:8px">
          <div>
            <div class="card-title" style="margin-bottom:4px">Invite codes</div>
            <div class="t-muted t-detail">Clients enter these codes during onboarding to join your company.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openModal('addCodeModal')">+ New invite code</button>
        </div>
        <div id="dashCodesList" style="margin-top:16px">
          <div class="t-muted t-detail">Loading codes...</div>
        </div>
      </div>
    `;

    this._renderGreeting();

    try {
      // Ensure CompaniesPage's overflow-less methods (addAdmin, createCode, etc.) know our company
      if (window.CompaniesPage) {
        CompaniesPage.companyId = userCompanyId;
        CompaniesPage.company = { id: userCompanyId, name: userCompanyName };
      }

      const [buildLines, companyAdmins, codes] = await Promise.all([
        supa(`build_lines?company_id=eq.${userCompanyId}&is_active=eq.true&select=id`),
        supa(`company_admins?company_id=eq.${userCompanyId}&select=id,user_id,role,created_at`),
        supa(`company_codes?company_id=eq.${userCompanyId}&select=*&order=created_at.desc`),
      ]);

      const buildLineIds = buildLines.map((b) => b.id);

      // Clients can be associated TWO ways:
      //   1. profiles.company_id — direct company link (legacy / some onboarding paths)
      //   2. vehicles.build_line_id → build_lines.company_id — build-line-based association
      // Fetch both sets in parallel and union them.
      const [directProfiles, buildLineVehicles] = await Promise.all([
        supa(`profiles?company_id=eq.${userCompanyId}&select=id`),
        buildLineIds.length > 0
          ? supa(`vehicles?build_line_id=in.(${buildLineIds.join(',')})&select=user_id`)
          : Promise.resolve([]),
      ]);

      const clientIdSet = new Set([
        ...directProfiles.map((p) => p.id),
        ...buildLineVehicles.map((v) => v.user_id).filter(Boolean),
      ]);
      const clientIds = [...clientIdSet];

      // Enrich for tier/explorer count. (We don't render a list in the dashboard
      // anymore, but we need tier info for the Explorers stat.)
      let clients = [];
      if (clientIds.length > 0) {
        const subs = await supa(
          `subscriptions?user_id=in.(${clientIds.join(',')})&select=user_id,tier,status`
        );
        clients = clientIds.map((id) => {
          const sub = subs.find((s) => s.user_id === id);
          return { id, tier: sub?.tier || 'base_camp' };
        });
      }

      // Admins — enrich with profile info
      let adminRows = [];
      if (companyAdmins.length > 0) {
        const adminIds = companyAdmins.map((a) => a.user_id);
        const adminProfiles = await supa(`profiles?id=in.(${adminIds.join(',')})&select=id,first_name,last_name,email`);
        adminRows = companyAdmins.map((a) => {
          const p = adminProfiles.find((pp) => pp.id === a.user_id) || {};
          return {
            id: a.user_id,
            adminRowId: a.id,
            role: a.role || 'admin',
            createdAt: a.created_at,
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || '—',
            email: p.email || '',
          };
        });
      }

      // Stats
      const explorerCount = clients.filter((c) => c.tier === 'explore' || c.tier === 'explorer').length;
      const activeCodes = codes.filter((c) => {
        const expired = c.expires_at && new Date(c.expires_at) < new Date();
        const exhausted = c.max_uses != null && (c.current_uses ?? 0) >= c.max_uses;
        return c.is_active && !expired && !exhausted;
      }).length;

      const statsEl = document.getElementById('dashStatsCA');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">${clients.length}</span><span class="stat-tile-label t-muted">Clients</span></div></div>
          <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">${explorerCount}</span><span class="stat-tile-label t-muted">Explorers</span></div></div>
          <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">${buildLines.length}</span><span class="stat-tile-label t-muted">Build Lines</span></div></div>
          <div class="stat-tile"><div class="stat-tile-top"><span class="stat-tile-value">${activeCodes}</span><span class="stat-tile-label t-muted">Active Codes</span></div></div>
        `;
      }

      // Admins list
      const adminsEl = document.getElementById('dashAdminsList');
      if (adminsEl) {
        if (adminRows.length === 0) {
          adminsEl.innerHTML = '<div class="t-muted t-detail">No admins yet.</div>';
        } else {
          adminsEl.innerHTML = adminRows.map((a) => `
            <div class="data-table-row data-table-row--static" style="padding:12px 14px">
              <div class="data-table-cell data-table-cell--bold" style="flex:1 1 200px;min-width:150px">${escHtml(a.name)}</div>
              <div class="data-table-cell t-muted" style="flex:1 1 220px;min-width:150px">${escHtml(a.email)}</div>
              <div class="data-table-cell" style="width:100px">
                <span class="badge ${a.role === 'owner' ? 'badge--tier-explorer' : 'badge--tier-base-camp'}">${escHtml(a.role)}</span>
              </div>
              <div class="data-table-cell" style="width:100px;text-align:right">
                <button class="btn btn-ghost btn-sm t-danger" onclick="DashboardPage.removeAdmin('${escHtml(a.adminRowId)}', '${escHtml(a.name)}', event)">Remove</button>
              </div>
            </div>
          `).join('');
        }
      }

      // Codes list
      const codesEl = document.getElementById('dashCodesList');
      if (codesEl) {
        if (codes.length === 0) {
          codesEl.innerHTML = '<div class="t-muted t-detail">No invite codes yet.</div>';
        } else {
          codesEl.innerHTML = codes.map((c) => {
            const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
            const isExhausted = c.max_uses != null && (c.current_uses ?? 0) >= c.max_uses;
            let statusBadge;
            if (!c.is_active)       statusBadge = '<span class="badge badge--tier-base-camp">Disabled</span>';
            else if (isExpired)     statusBadge = '<span class="badge badge--danger">Expired</span>';
            else if (isExhausted)   statusBadge = '<span class="badge badge--danger">Exhausted</span>';
            else                    statusBadge = '<span class="badge badge--success">Active</span>';
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
                  <button class="btn btn-ghost btn-sm" onclick="CompaniesPage.toggleCode('${escHtml(c.id)}', ${!c.is_active}).then(() => DashboardPage.load());">${c.is_active ? 'Disable' : 'Enable'}</button>
                  <button class="btn btn-ghost btn-sm t-danger" onclick="CompaniesPage.deleteCode('${escHtml(c.id)}').then(() => DashboardPage.load());">Delete</button>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error('[Dashboard/CA] load failed:', e);
      const codesEl = document.getElementById('dashCodesList');
      if (codesEl) codesEl.innerHTML = `<div class="t-danger t-detail">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  // Remove a company admin from the current company
  async removeAdmin(adminRowId, name, event) {
    if (!confirm(`Remove ${name || 'this admin'} from the company? They'll lose access to ArcAdmin for this company.`)) return;
    await withBtnLoading(event, async () => {
      try {
        const res = await supaDelete(`company_admins?id=eq.${adminRowId}`);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const msg = body ? ` — ${body.slice(0, 200)}` : '';
          alert(`Failed to remove admin (HTTP ${res.status})${msg}\n\nThis usually means a Row-Level Security policy is blocking the delete. Check Supabase → Authentication → Policies on the company_admins table.`);
          return;
        }
        await this.load();
      } catch (e) {
        console.error('[Dashboard] removeAdmin failed:', e);
        alert(`Failed to remove admin: ${e.message || e}`);
      }
    });
  },
};

window.DashboardPage = DashboardPage;