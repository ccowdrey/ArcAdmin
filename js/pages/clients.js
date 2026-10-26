// ArcAdmin — Clients Page
// ========================
// Renamed from users.js. Uses the new .data-table card-row styling.
// Same data shape as the old UsersPage; no schema changes.

const ClientsPage = {
  allClients: [],
  _loadSeq: 0,

  listView: new ListView({
    ref: 'ClientsPage.listView',
    columns: CLIENT_COLUMNS,
    sortKey: 'name',
    noun: 'client',
    rowHtml: (u) => clientRowHtml(u, `/clients/${Router.getSlug(u.id)}`),
    onChange: () => ClientsPage.render(),
  }),

  async load() {
    const listEl = document.getElementById('clientsList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading clients...</div>';
    const seq = ++this._loadSeq;

    try {
      const [users, subs, companyAdmins, vehicles, supportStaff] = await Promise.all([
        supa('profiles?select=*&order=created_at.desc'),
        supa('subscriptions?select=user_id,tier,status'),
        supa('company_admins?select=user_id,company_id,role'),
        supa('vehicles?select=user_id,make,model,year,build_line_id'),
        supa('support_members?select=user_id').catch(() => []),
      ]);

      const subMap = {};
      subs.forEach((s) => { subMap[s.user_id] = s; });
      const vehicleMap = {};
      vehicles.forEach((v) => { if (!vehicleMap[v.user_id]) vehicleMap[v.user_id] = v; });
      const adminUserIds = new Set([...companyAdmins, ...supportStaff].map((a) => a.user_id));
      const vehicleUserIds = new Set(vehicles.map((v) => v.user_id));

      // Company-scope filter for company admins and support staff: must match either
      //   (a) profiles.company_id === userCompanyId, OR
      //   (b) user owns a vehicle whose build_line belongs to this company
      let companyClientIds = null;
      if ((Auth.isCompanyAdmin() || Auth.isSupportMember()) && userCompanyId) {
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
        // Staff-only rows (company_admins / support_members with no vehicle, not super admin) belong on the Companies page
        .filter((u) => vehicleUserIds.has(u.id) || u.isAdmin || !adminUserIds.has(u.id))
        // Company admins only see their own clients
        .filter((u) => !companyClientIds || companyClientIds.has(u.id));

      this.filter();

      // "Last active" matches the client detail page: newest of login,
      // telemetry, and device-control activity. Filled in after first paint.
      const lastActive = await fetchLastActive(this.allClients);
      if (seq !== this._loadSeq) return; // a newer load() superseded this one
      this.allClients.forEach((c) => { c.lastActive = lastActive.get(c.id) || null; });
      this.listView.setRows(this.listView.rows, { keepPage: true });
      this.render();
    } catch (e) {
      console.error('Clients load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="data-empty">Failed to load clients — ${escHtml(e.message || 'unknown error')}</div>`;
    }
  },

  filter() {
    const q = (document.getElementById('clientsSearch')?.value || '').toLowerCase();
    this.listView.setRows(!q ? this.allClients : this.allClients.filter((u) =>
      u.displayName.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      u.vehicleLabel.toLowerCase().includes(q)
    ));
    this.render();
  },

  render() {
    const list = document.getElementById('clientsList');
    if (!list) return;
    if (this.listView.rows.length === 0) {
      const searching = !!document.getElementById('clientsSearch')?.value;
      list.innerHTML = `<div class="data-empty">${searching ? 'No clients match your search' : 'No clients yet'}</div>`;
      return;
    }
    list.innerHTML = this.listView.html();
  },
};

window.ClientsPage = ClientsPage;