// ArcAdmin — Firmware Page
// =========================
// 2026-04-23 lean rewrite for new design. Releases + device status tables.
// Upload flow is kept minimal — a full restyled upload modal with build-line
// targeting is deferred to a later pass.

const FirmwarePage = {
  firmwareList: [],
  deviceStatuses: [],
  activeTab: 'releases',

  async load() {
    const listEl = document.getElementById('firmwareList');
    if (listEl) listEl.innerHTML = '<div class="data-empty">Loading firmware...</div>';

    try {
      const [firmware, devices] = await Promise.all([
        supa('firmware_versions?select=*,companies:target_company_id(name)&order=version_code.desc'),
        supa('device_firmware_status?select=*,vehicles:vehicle_id(id,make,model,nickname,user_id)&order=last_check_at.desc').catch(() => []),
      ]);
      this.firmwareList = firmware || [];
      this.deviceStatuses = devices || [];
      this.render();
    } catch (e) {
      console.error('Firmware load failed:', e);
      if (listEl) listEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  render() {
    const listEl = document.getElementById('firmwareList');
    if (!listEl) return;

    const active = this.firmwareList.filter((f) => f.is_active).length;
    const totalDevices = this.deviceStatuses.length;
    const failed = this.deviceStatuses.filter((d) => d.last_update_status === 'failed').length;

    const stats = `
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${this.firmwareList.length}</span>
            <span class="stat-tile-label t-muted">Releases</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${active}</span>
            <span class="stat-tile-label t-muted">Active</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${totalDevices}</span>
            <span class="stat-tile-label t-muted">Devices</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-value">${failed}</span>
            <span class="stat-tile-label t-muted">Failed updates</span>
          </div>
          ${failed > 0 ? '<span class="stat-delta stat-delta--negative">Needs attention</span>' : ''}
        </div>
      </div>
    `;

    const tabs = `
      <div class="tabs">
        <button class="tab ${this.activeTab === 'releases' ? 'tab--active' : ''}" onclick="FirmwarePage.switchTab('releases')">Releases</button>
        <button class="tab ${this.activeTab === 'devices' ? 'tab--active' : ''}" onclick="FirmwarePage.switchTab('devices')">Devices</button>
      </div>
    `;

    listEl.innerHTML = `${stats}${tabs}<div id="firmwareTabContent" class="w-full"></div>`;
    this._renderTabContent();
  },

  _renderTabContent() {
    const el = document.getElementById('firmwareTabContent');
    if (!el) return;

    if (this.activeTab === 'releases') {
      if (this.firmwareList.length === 0) {
        el.innerHTML = '<div class="data-empty">No firmware versions uploaded yet.</div>';
        return;
      }
      el.innerHTML = `
        <div class="data-table">
          <div class="data-table-headers">
            <div class="data-table-header" style="width:150px">Version</div>
            <div class="data-table-header" style="width:80px">Code</div>
            <div class="data-table-header" style="width:200px">Scope</div>
            <div class="data-table-header" style="width:100px">Size</div>
            <div class="data-table-header" style="width:100px">Status</div>
            <div class="data-table-header" style="flex:1">Uploaded</div>
          </div>
          ${this.firmwareList.map((fw) => {
            const scopeLabel = fw.target_scope === 'all' ? 'All devices'
              : fw.target_scope === 'company' ? (fw.companies?.name || 'Company')
              : fw.target_scope === 'build_line' ? (fw.target_build_line || 'Build Line')
              : 'Vehicle';
            const size = fw.file_size_bytes ? (fw.file_size_bytes / 1024).toFixed(0) + ' KB' : '—';
            return `
              <div class="data-table-row data-table-row--static">
                <div class="data-table-cell data-table-cell--bold" style="width:150px">${escHtml(fw.version)}</div>
                <div class="data-table-cell t-muted" style="width:80px">${fw.version_code}</div>
                <div class="data-table-cell" style="width:200px">
                  <span class="badge ${fw.target_scope === 'all' ? 'badge--tier-explorer' : 'badge--tier-base-camp'}">${escHtml(scopeLabel)}</span>
                </div>
                <div class="data-table-cell t-muted" style="width:100px">${size}</div>
                <div class="data-table-cell" style="width:100px">
                  <span class="badge ${fw.is_active ? 'badge--success' : 'badge--tier-base-camp'}">${fw.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="data-table-cell t-muted" style="flex:1">${escHtml(fw.created_at ? formatDate(fw.created_at) : '—')}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      if (this.deviceStatuses.length === 0) {
        el.innerHTML = '<div class="data-empty">No devices have checked in yet.</div>';
        return;
      }
      el.innerHTML = `
        <div class="data-table">
          <div class="data-table-headers">
            <div class="data-table-header" style="width:240px">Vehicle</div>
            <div class="data-table-header" style="width:120px">Current</div>
            <div class="data-table-header" style="width:120px">Status</div>
            <div class="data-table-header" style="flex:1">Last check</div>
          </div>
          ${this.deviceStatuses.map((d) => {
            const vehicleLabel = d.vehicles?.nickname || [d.vehicles?.make, d.vehicles?.model].filter(Boolean).join(' ') || '—';
            const statusBadge = d.last_update_status === 'failed' ? 'badge--danger'
              : d.last_update_status === 'success' ? 'badge--success'
              : 'badge--tier-base-camp';
            return `
              <div class="data-table-row data-table-row--static">
                <div class="data-table-cell data-table-cell--bold" style="width:240px">${escHtml(vehicleLabel)}</div>
                <div class="data-table-cell t-muted" style="width:120px">${escHtml(d.current_version || '—')}</div>
                <div class="data-table-cell" style="width:120px">
                  <span class="badge ${statusBadge}">${escHtml(d.last_update_status || 'pending')}</span>
                </div>
                <div class="data-table-cell t-muted" style="flex:1">${escHtml(d.last_check_at ? timeAgo(d.last_check_at) : 'Never')}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    this.render();
  },

  openUpload() {
    alert('Firmware upload UI is being redesigned. For now, upload firmware through the Supabase dashboard or the legacy admin URL.');
  },
};

window.FirmwarePage = FirmwarePage;
