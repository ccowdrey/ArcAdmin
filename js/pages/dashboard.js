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
};

window.DashboardPage = DashboardPage;
