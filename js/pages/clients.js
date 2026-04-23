// ArcAdmin — Clients Page
// ========================
// Renamed from users.js. Uses the new .data-table card-row styling.
// Same data shape as the old UsersPage; no schema changes.

const ClientsPage = {
  allClients: [],

  async load() {
    const listEl = document.getElementById('clientsList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading clients...</div>';

    try {
      const [users, subs, companyAdmins, vehicles] = await Promise.all([
        supa('profiles?select=*&order=created_at.desc'),
        supa('subscriptions?select=user_id,tier,status'),
        supa('company_admins?select=user_id,company_id,role'),
        supa('vehicles?select=user_id,make,model,year,build_line_id'),
      ]);

      const subMap = {};
      subs.forEach((s) => { subMap[s.user_id] = s; });
      const vehicleMap = {};
      vehicles.forEach((v) => { if (!vehicleMap[v.user_id]) vehicleMap[v.user_id] = v; });
      const adminUserIds = new Set(companyAdmins.map((a) => a.user_id));
      const vehicleUserIds = new Set(vehicles.map((v) => v.user_id));

      // Company-scope filter for company admins: must match either
      //   (a) profiles.company_id === userCompanyId, OR
      //   (b) user owns a vehicle whose build_line belongs to this company
      let companyClientIds = null;
      if (Auth.isCompanyAdmin() && userCompanyId) {
        const buildLines = await supa(
          `build_lines?company_id=eq.${userCompanyId}&is_active=eq.true&select=id`
        );
        const buildLineIds = new Set(buildLines.map((b) => b.id));
        companyClientIds = new Set();
        users.forEach((u) => {
          if (u.company_id === userCompanyId) companyClientIds.add(u.id);
        });
        vehicles.forEach((v) => {
          if (v.build_line_id && buildLineIds.has(v.build_line_id) && v.user_id) {
            companyClientIds.add(v.user_id);
          }
        });
      }

      this.allClients = users
        .map((u) => {
          const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || (u.email || '').split('@')[0];
          Router.registerSlug(u.id, name);
          const sub = subMap[u.id];
          const v = vehicleMap[u.id];
          return {
            id: u.id,
            displayName: name,
            email: u.email,
            tier: sub?.tier || 'base_camp',
            lastLogin: u.last_login_at,
            createdAt: u.created_at,
            isAdmin: !!u.is_admin,
            vehicleLabel: v ? [v.year, v.make, v.model].filter(Boolean).join(' ').trim() : '',
          };
        })
        // Admin-only rows (company_admins with no vehicle, not super admin) belong on the Companies page
        .filter((u) => vehicleUserIds.has(u.id) || u.isAdmin || !adminUserIds.has(u.id))
        // Company admins only see their own clients
        .filter((u) => !companyClientIds || companyClientIds.has(u.id));

      this.render(this.allClients);
    } catch (e) {
      console.error('Clients load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="data-empty">Failed to load clients — ${escHtml(e.message || 'unknown error')}</div>`;
    }
  },

  render(rows) {
    const list = document.getElementById('clientsList');
    if (!list) return;

    if (!rows || rows.length === 0) {
      list.innerHTML = '<div class="data-empty">No clients yet</div>';
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
        ${rows.map((u) => `
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
  },

  filter() {
    const q = (document.getElementById('clientsSearch')?.value || '').toLowerCase();
    if (!q) { this.render(this.allClients); return; }
    const filtered = this.allClients.filter((u) =>
      u.displayName.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      u.vehicleLabel.toLowerCase().includes(q)
    );
    this.render(filtered);
  },
};

window.ClientsPage = ClientsPage;