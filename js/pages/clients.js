// ArcAdmin — Clients Page
// ========================
// Renamed from users.js. Uses the new .data-table card-row styling.
// Same data shape as the old UsersPage; no schema changes.

const CLIENTS_PER_PAGE = 25;

const ClientsPage = {
  allClients: [],
  _filtered: [],
  _page: 1,
  _sortKey: 'name',
  _sortDir: 'asc',
  _lastActiveLoading: false,
  _loadSeq: 0,

  async load() {
    const listEl = document.getElementById('clientsList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading clients...</div>';
    const seq = ++this._loadSeq;

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
            lastActive: null,
            createdAt: u.created_at,
            isAdmin: !!u.is_admin,
            vehicleLabel: v ? [v.year, v.make, v.model].filter(Boolean).join(' ').trim() : '',
          };
        })
        // Admin-only rows (company_admins with no vehicle, not super admin) belong on the Companies page
        .filter((u) => vehicleUserIds.has(u.id) || u.isAdmin || !adminUserIds.has(u.id))
        // Company admins only see their own clients
        .filter((u) => !companyClientIds || companyClientIds.has(u.id));

      this._page = 1;
      this._lastActiveLoading = true;
      this.filter();

      // "Last active" matches the client detail page: newest of login,
      // telemetry, and device-control activity. Filled in after first paint.
      const lastActive = await fetchLastActive(this.allClients);
      if (seq !== this._loadSeq) return; // a newer load() superseded this one
      this.allClients.forEach((c) => { c.lastActive = lastActive.get(c.id) || null; });
      this._lastActiveLoading = false;
      this._applySortAndRender();
    } catch (e) {
      console.error('Clients load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="data-empty">Failed to load clients — ${escHtml(e.message || 'unknown error')}</div>`;
    }
  },

  // ── Search / sort / paginate ──

  filter() {
    const q = (document.getElementById('clientsSearch')?.value || '').toLowerCase();
    this._filtered = !q ? [...this.allClients] : this.allClients.filter((u) =>
      u.displayName.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      u.vehicleLabel.toLowerCase().includes(q)
    );
    this._page = 1;
    this._applySortAndRender();
  },

  sortBy(key) {
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortKey = key;
      // Most-recent-first is the useful default for activity.
      this._sortDir = key === 'lastActive' ? 'desc' : 'asc';
    }
    this._page = 1;
    this._applySortAndRender();
  },

  goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(this._filtered.length / CLIENTS_PER_PAGE));
    this._page = Math.max(1, Math.min(totalPages, page));
    this.render();
  },

  _sortValue(u, key) {
    switch (key) {
      case 'name':       return u.displayName.toLowerCase();
      case 'email':      return (u.email || '').toLowerCase();
      case 'vehicle':    return u.vehicleLabel.toLowerCase();
      case 'tier':       return (u.tier || '').toLowerCase();
      case 'lastActive': return u.lastActive ? new Date(u.lastActive).getTime() : null;
      default:           return '';
    }
  },

  _applySortAndRender() {
    const key = this._sortKey;
    const dir = this._sortDir === 'asc' ? 1 : -1;
    this._filtered.sort((a, b) => {
      const va = this._sortValue(a, key);
      const vb = this._sortValue(b, key);
      // Blanks (no vehicle, never active) sink to the bottom either way.
      const blankA = va === null || va === '';
      const blankB = vb === null || vb === '';
      if (blankA !== blankB) return blankA ? 1 : -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.displayName.localeCompare(b.displayName);
    });
    this.render();
  },

  render() {
    const list = document.getElementById('clientsList');
    if (!list) return;

    const rows = this._filtered;
    if (!rows || rows.length === 0) {
      const searching = !!document.getElementById('clientsSearch')?.value;
      list.innerHTML = `<div class="data-empty">${searching ? 'No clients match your search' : 'No clients yet'}</div>`;
      return;
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE));
    const page = Math.min(Math.max(1, this._page), totalPages);
    const startIdx = (page - 1) * CLIENTS_PER_PAGE;
    const endIdx = Math.min(startIdx + CLIENTS_PER_PAGE, total);
    const pageRows = rows.slice(startIdx, endIdx);

    const header = (key, label, cls) => {
      const active = this._sortKey === key;
      const arrow = active ? (this._sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<div class="data-table-header ${cls}" role="button" tabindex="0" style="cursor:pointer;user-select:none"
        aria-sort="${active ? (this._sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"
        onclick="ClientsPage.sortBy('${key}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ClientsPage.sortBy('${key}')}">${label}${arrow}</div>`;
    };

    const lastActiveCell = (u) => {
      if (u.lastActive) return timeAgo(u.lastActive);
      return this._lastActiveLoading ? '…' : '—';
    };

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="ClientsPage.goToPage(1)" ${page === 1 ? 'disabled' : ''} title="First">«</button>
          <button class="btn btn-ghost btn-sm" onclick="ClientsPage.goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>
          ${this._buildPageButtons(page, totalPages)}
          <button class="btn btn-ghost btn-sm" onclick="ClientsPage.goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>
          <button class="btn btn-ghost btn-sm" onclick="ClientsPage.goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last">»</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} client${total === 1 ? '' : 's'}</div>`;

    list.innerHTML = `
      <div class="data-table">
        <div class="data-table-headers">
          ${header('name', 'Name', 'col-name')}
          ${header('email', 'Email', 'col-email')}
          ${header('vehicle', 'Vehicle', 'col-vehicle')}
          ${header('tier', 'Tier', 'col-tier')}
          ${header('lastActive', 'Last active', 'col-last-active')}
        </div>
        ${pageRows.map((u) => `
          <button class="data-table-row" onclick="Router.navigate('/clients/${escHtml(Router.getSlug(u.id))}')">
            <div class="data-table-cell data-table-cell--bold col-name">${escHtml(u.displayName)}</div>
            <div class="data-table-cell col-email t-muted">${escHtml(u.email || '')}</div>
            <div class="data-table-cell col-vehicle t-muted">${escHtml(u.vehicleLabel || '—')}</div>
            <div class="data-table-cell col-tier">${tierBadge(u.tier)}</div>
            <div class="data-table-cell col-last-active t-muted">${escHtml(lastActiveCell(u))}</div>
          </button>
        `).join('')}
      </div>
      ${pagination}
    `;
  },

  // Same numbered-button pattern as the Victron telemetry log pager.
  _buildPageButtons(current, total) {
    const btn = (p) => `<button class="btn ${p === current ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="ClientsPage.goToPage(${p})" style="min-width:32px;padding:4px 8px">${p}</button>`;
    const ellipsis = `<span class="t-muted" style="padding:0 4px">…</span>`;

    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1).map(btn).join('');
    }

    const pages = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

    let html = '';
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) html += ellipsis;
      html += btn(p);
      prev = p;
    }
    return html;
  },
};

window.ClientsPage = ClientsPage;