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
      this.allClients = await fetchScopedClients();
      if (seq !== this._loadSeq) return;

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