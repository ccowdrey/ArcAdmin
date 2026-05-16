// ArcAdmin — User Detail Page
// ============================
// Identity + subscription + vehicle + account actions + Victron Cerbo
// system logs with pagination.
//
// 2026-04-23 update: Cerbo telemetry log viewer restored.
//
// 2026-05-12 update: per-vehicle battery capacity override row in the
// Vehicle Info card. Effective = vehicle.battery_capacity_ah ??
// build_line.battery_capacity_ah ?? null. Inline edit; empty clears the
// override. The iPad's BatteryCapacityLearner mirrors this hierarchy.
//
// 2026-05-16 update: device control logs section. Surfaces every user-
// initiated switch / scene activation emitted by the iPad app from the
// device_control_logs table. Date range, optional filters by category and
// source, paginated. Empty state explains that the table is populated by
// the iPad app — useful for troubleshooting "did the fan ever come on?".

const UserDetailPage = {
  userId: null,
  userName: '',
  userEmail: '',
  vehicleId: null,

  // Stashed context for inline battery edit
  _vehicle: null,
  _buildLineBatteryAh: null,

  // Cerbo telemetry log state
  _logs: [],
  _page: 1,
  _perPage: 100,
  _dateRange: { start: '', end: '' },

  // Device control log state
  _devLogs: [],
  _devLogsPage: 1,
  _devLogsPerPage: 50,
  _devLogsDateRange: { start: '', end: '' },
  _devLogsFilters: { category: '', action: '', source: '' },

  async load(params) {
    this.userId = Router.resolveId(params.userId);
    const contentEl = document.getElementById('userDetailContent');
    if (contentEl) contentEl.innerHTML = '<div class="data-empty">Loading user...</div>';

    try {
      const [profiles, subs, vehicles] = await Promise.all([
        supa(`profiles?id=eq.${this.userId}&select=*`),
        supa(`subscriptions?user_id=eq.${this.userId}&select=*`),
        supa(`vehicles?user_id=eq.${this.userId}&select=*`),
      ]);

      const p = profiles[0];
      if (!p) {
        if (contentEl) contentEl.innerHTML = '<div class="data-empty">User not found.</div>';
        return;
      }

      const sub = subs[0];
      const v = vehicles[0];
      this.vehicleId = v?.id || null;
      this.userName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email;
      this.userEmail = p.email;

      // Build line + company (if present). We pull battery_capacity_ah on
      // the build line so the vehicle row can show the effective value
      // hierarchy (vehicle override > build line default > unset).
      let buildLineLabel = '—';
      let buildLineBatteryAh = null;
      let companyLabel = '—';
      if (v?.build_line_id) {
        try {
          const bls = await supa(`build_lines?id=eq.${v.build_line_id}&select=name,company_id,battery_capacity_ah`);
          if (bls[0]) {
            buildLineLabel = bls[0].name;
            buildLineBatteryAh = bls[0].battery_capacity_ah ?? null;
            if (bls[0].company_id) {
              const cos = await supa(`companies?id=eq.${bls[0].company_id}&select=name`);
              if (cos[0]) companyLabel = cos[0].name;
            }
          }
        } catch (_) {}
      } else if (p.company_id) {
        try {
          const cos = await supa(`companies?id=eq.${p.company_id}&select=name`);
          if (cos[0]) companyLabel = cos[0].name;
        } catch (_) {}
      }

      this._render({ profile: p, sub, vehicle: v, buildLineLabel, buildLineBatteryAh, companyLabel });

      if (v) {
        this._initLogsSection();
      }
    } catch (e) {
      console.error('User detail load failed:', e);
      if (contentEl) contentEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  _render({ profile, sub, vehicle, buildLineLabel, buildLineBatteryAh, companyLabel }) {
    const contentEl = document.getElementById('userDetailContent');
    if (!contentEl) return;

    // Stash the vehicle + build-line context so the inline battery edit
    // handler can reference them without re-fetching.
    this._vehicle = vehicle || null;
    this._buildLineBatteryAh = (buildLineBatteryAh != null) ? buildLineBatteryAh : null;

    const tier = sub?.tier || 'base_camp';

    contentEl.innerHTML = `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">${escHtml(this.userName)}</div>
          <div class="page-subtitle t-muted">${escHtml(this.userEmail || '')}</div>
        </div>
        <div>${tierBadge(tier)}</div>
      </div>

      <div class="info-grid">
        <div class="info-card">
          <div class="info-card-title">ACCOUNT INFO</div>
          ${this._infoLine('User ID', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all">${escHtml(this.userId)}</span>`)}
          ${this._infoLine('Joined', escHtml(formatDate(profile.created_at)))}
          ${this._infoLine('Last active', escHtml(profile.last_login_at ? timeAgo(profile.last_login_at) : 'Never'))}
          ${this._infoLine('Company', escHtml(companyLabel))}
        </div>

        <div class="info-card">
          <div class="info-card-title">VEHICLE INFO</div>
          ${vehicle ? `
            ${this._infoLine('Make', escHtml(vehicle.make || '—'))}
            ${this._infoLine('Model', escHtml(vehicle.model || '—'))}
            ${this._infoLine('Year', escHtml(String(vehicle.year || '—')))}
            ${this._infoLine('Build line', escHtml(buildLineLabel))}
            ${this._renderBatteryRow(vehicle, buildLineBatteryAh)}
            ${this._infoLine('Nickname', escHtml(vehicle.nickname || vehicle.name || '—'))}
            ${this._infoLine('VIN', escHtml(vehicle.vin || '—'))}
            ${this._infoLine('Cerbo IP', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_ip || '—')}</span>`)}
            ${this._infoLine('Cerbo portal ID', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_portal_id || '—')}</span>`)}
          ` : `<div class="t-muted t-detail" style="padding:8px 0">No vehicle registered.</div>`}
        </div>

        <div class="info-card">
          <div class="info-card-title">SUBSCRIPTION</div>
          ${this._infoLine('Tier', tierBadge(tier))}
          ${this._infoLine('Status', escHtml(sub?.status || '—'))}
          ${this._infoLine('Platform', escHtml(sub?.platform || '—'))}
          ${this._infoLine('Started', escHtml(sub?.started_at ? formatDate(sub.started_at) : '—'))}
          ${this._infoLine('Renews', escHtml(sub?.current_period_end ? formatDate(sub.current_period_end) : '—'))}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Account actions</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">Change subscription tier or remove the account entirely.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('explore')">Set Explorer</button>
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('base_camp')">Set Base Camp</button>
          <button class="btn btn-ghost btn-sm t-danger" onclick="UserDetailPage.deleteUser()">Delete user</button>
        </div>
      </div>

      ${vehicle ? this._renderDeviceControlLogsCard() : ''}
      ${vehicle ? this._renderLogsCard() : ''}
    `;
  },

  _infoLine(label, value) {
    return `
      <div class="info-line">
        <span class="info-line-label">${escHtml(label)}</span>
        <span class="info-line-value">${value || '—'}</span>
      </div>
    `;
  },

  _row(label, value) {
    return `
      <div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div class="t-muted t-detail" style="width:160px;flex-shrink:0">${escHtml(label)}</div>
        <div class="t-body" style="flex:1">${value || '—'}</div>
      </div>
    `;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BATTERY CAPACITY ROW + INLINE EDIT (per-vehicle override)
  // ═══════════════════════════════════════════════════════════════════════
  // Effective value = vehicle.battery_capacity_ah ?? build_line.battery_capacity_ah
  // The iPad's BatteryCapacityLearner mirrors this hierarchy: vehicle
  // override wins, otherwise build line default, otherwise observation.

  _renderBatteryRow(vehicle, buildLineAh) {
    const vehicleAh = (vehicle.battery_capacity_ah != null) ? vehicle.battery_capacity_ah : null;
    const effectiveAh = vehicleAh ?? buildLineAh ?? null;

    const valueText = effectiveAh != null
      ? `${effectiveAh} Ah`
      : '<span class="t-muted">Not set</span>';

    // Sub-label distinguishes the three states. Helps builders see "this
    // customer is on a non-stock spec."
    let subLabel = '';
    if (vehicleAh != null && buildLineAh != null && vehicleAh !== buildLineAh) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Override · build line default: ${buildLineAh} Ah</div>`;
    } else if (vehicleAh != null && buildLineAh == null) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Custom · no build line default</div>`;
    } else if (vehicleAh == null && buildLineAh != null) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Inherited from build line</div>`;
    }

    return `
      <div class="info-line" id="batteryInfoRow" style="align-items:flex-start">
        <span class="info-line-label">Battery</span>
        <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:0">
          <span style="display:flex;align-items:center;gap:8px">
            <span>${valueText}</span>
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:12px" onclick="UserDetailPage.editBattery()">Edit</button>
          </span>
          ${subLabel}
        </span>
      </div>
    `;
  },

  editBattery() {
    const row = document.getElementById('batteryInfoRow');
    if (!row) return;
    const currentAh = (this._vehicle && this._vehicle.battery_capacity_ah != null)
      ? this._vehicle.battery_capacity_ah
      : '';
    const blAh = this._buildLineBatteryAh;
    const placeholder = (blAh != null) ? `Build line default: ${blAh}` : 'e.g. 600';

    row.innerHTML = `
      <span class="info-line-label">Battery</span>
      <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span style="display:flex;align-items:center;gap:8px">
          <input id="batteryEditInput" type="number" min="0" step="1" value="${escHtml(String(currentAh))}"
                 placeholder="${escHtml(placeholder)}"
                 style="width:110px;padding:4px 8px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-default);color:var(--text-primary);font-size:13px;text-align:right">
          <span class="t-muted t-detail" style="font-size:13px">Ah</span>
          <button class="btn btn-primary btn-sm" style="padding:4px 12px;font-size:12px" onclick="UserDetailPage.saveBattery()">Save</button>
          <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:12px" onclick="UserDetailPage._reloadBatteryRow()">Cancel</button>
        </span>
        <span class="t-muted t-detail" style="font-size:11px">
          ${blAh != null
            ? `Leave blank to inherit build line default (${blAh} Ah)`
            : 'Build line has no default. Leave blank to let the iPad learn from observation.'}
        </span>
      </span>
    `;

    const input = document.getElementById('batteryEditInput');
    if (input) { input.focus(); input.select(); }
  },

  async saveBattery() {
    if (!this.vehicleId) {
      alert('No vehicle for this user — nothing to update.');
      return;
    }
    const input = document.getElementById('batteryEditInput');
    if (!input) return;

    const raw = (input.value || '').trim();
    let newValue;
    if (raw === '') {
      newValue = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        alert('Battery capacity must be a positive whole number (Ah), or empty to clear.');
        return;
      }
      newValue = n;
    }

    try {
      await supaPatch(`vehicles?id=eq.${this.vehicleId}`, {
        battery_capacity_ah: newValue,
        updated_at: new Date().toISOString(),
      });

      if (this._vehicle) this._vehicle.battery_capacity_ah = newValue;
      this._reloadBatteryRow();
    } catch (e) {
      alert(`Failed to update battery: ${e.message || e}`);
    }
  },

  _reloadBatteryRow() {
    const row = document.getElementById('batteryInfoRow');
    if (!row) return;
    const newMarkup = this._renderBatteryRow(this._vehicle, this._buildLineBatteryAh);
    row.outerHTML = newMarkup;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DEVICE CONTROL LOGS (manual switch / scene activation events)
  // ═══════════════════════════════════════════════════════════════════════

  _renderDeviceControlLogsCard() {
    const today = localDate();
    const weekAgo = localDate(new Date(Date.now() - 7 * 86400000));
    return `
      <div class="card">
        <div class="card-title">Device Activity</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          User-triggered switch flips, scene activations, and remediation actions.
          Use this to troubleshoot "did the fan ever come on last night?" or
          spot patterns in how a client is using their build.
        </div>
        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Start</label>
            <input type="date" id="userDevLogStart" value="${weekAgo}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>End</label>
            <input type="date" id="userDevLogEnd" value="${today}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Category</label>
            <select id="userDevLogCategory" style="padding:7px 10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:13px">
              <option value="">All</option>
              <option value="climate">Climate</option>
              <option value="lighting">Lighting</option>
              <option value="power">Power</option>
              <option value="plumbing">Plumbing</option>
              <option value="exterior">Exterior</option>
              <option value="entertainment">Entertainment</option>
              <option value="scene">Scenes</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Source</label>
            <select id="userDevLogSource" style="padding:7px 10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:13px">
              <option value="">All</option>
              <option value="manual">Manual tap</option>
              <option value="scene">Scene</option>
              <option value="schedule">Schedule</option>
              <option value="bedtime">Bedtime</option>
              <option value="alert">Alert</option>
              <option value="system">System</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm" id="userLoadDevLogsBtn" onclick="UserDetailPage.loadDeviceControlLogs()">Load Activity</button>
        </div>
        <div id="userDevLogsContent">
          <div class="t-muted t-detail">Pick a date range and click <strong>Load Activity</strong>.</div>
        </div>
      </div>
    `;
  },

  async loadDeviceControlLogs() {
    const startInput = document.getElementById('userDevLogStart');
    const endInput = document.getElementById('userDevLogEnd');
    const catInput = document.getElementById('userDevLogCategory');
    const srcInput = document.getElementById('userDevLogSource');
    const btn = document.getElementById('userLoadDevLogsBtn');
    const contentEl = document.getElementById('userDevLogsContent');
    if (!startInput || !endInput || !btn || !contentEl) return;

    const start = startInput.value;
    const end = endInput.value;
    if (!start || !end) {
      contentEl.innerHTML = '<div class="t-danger t-detail">Pick a start and end date.</div>';
      return;
    }

    this._devLogsFilters = {
      category: catInput?.value || '',
      action: '',
      source: srcInput?.value || '',
    };

    btn.textContent = 'Loading...';
    btn.disabled = true;
    contentEl.innerHTML = '<div class="t-muted t-detail">Fetching device activity...</div>';

    try {
      const startISO = localDateToUTCStart(start);
      const endISO = localDateToUTCEnd(end);

      const filters = [
        `user_id=eq.${this.userId}`,
        `occurred_at=gte.${startISO}`,
        `occurred_at=lte.${endISO}`,
      ];
      if (this._devLogsFilters.category) {
        filters.push(`device_category=eq.${encodeURIComponent(this._devLogsFilters.category)}`);
      }
      if (this._devLogsFilters.source) {
        filters.push(`source=eq.${encodeURIComponent(this._devLogsFilters.source)}`);
      }

      const url = `device_control_logs?${filters.join('&')}&order=occurred_at.desc&limit=5000&select=*`;
      const logs = await supa(url);

      this._devLogs = logs;
      this._devLogsPage = 1;
      this._devLogsDateRange = { start, end };

      if (logs.length === 0) {
        contentEl.innerHTML = `
          <div class="t-muted t-detail" style="padding:12px;background:var(--bg-muted);border-radius:8px">
            No device activity logged from ${escHtml(start)} to ${escHtml(end)}.
            <div style="margin-top:6px;font-size:11px">
              Activity logging is emitted by the ArcNode iPad app. If this client
              has the latest app and you still see nothing, they may not have
              toggled any devices manually in this window.
            </div>
          </div>
        `;
      } else {
        this._renderDevLogsPage();
      }
    } catch (e) {
      console.error('[Device Activity] fetch failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load — ${escHtml(e.message || '')}</div>`;
    }

    btn.textContent = 'Load Activity';
    btn.disabled = false;
  },

  _renderDevLogsPage() {
    const contentEl = document.getElementById('userDevLogsContent');
    if (!contentEl) return;

    const logs = this._devLogs;
    const total = logs.length;
    const perPage = this._devLogsPerPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, this._devLogsPage), totalPages);
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageRows = logs.slice(startIdx, endIdx);

    const counts = {};
    for (const l of logs) {
      const key = l.device_name || l.device_key || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
    const topDevices = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topMarkup = topDevices.length > 0 ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        ${topDevices.map(([name, count]) => `
          <div style="padding:6px 10px;background:var(--brand-primary-10,rgba(118,123,251,0.08));border:1px solid var(--brand-primary);border-radius:999px;font-size:12px;color:var(--text-primary)">
            <span style="font-weight:500">${escHtml(name)}</span>
            <span class="t-muted" style="margin-left:4px">×${count}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    const table = `
      <div style="overflow-x:auto;border:1px solid var(--border-default);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-muted);text-align:left">
              ${['Time','Device','Category','Action','Source','Value'].map((h) => `
                <th style="padding:8px 10px;font-weight:500;color:var(--text-dark);white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${h}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((l) => this._renderDevLogRow(l)).join('')}
          </tbody>
        </table>
      </div>
    `;

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToDevLogsPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="t-muted" style="padding:0 8px">Page ${page} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToDevLogsPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} event${total === 1 ? '' : 's'} from ${this._devLogsDateRange.start} to ${this._devLogsDateRange.end}</div>`;

    contentEl.innerHTML = topMarkup + table + pagination;
  },

  _renderDevLogRow(l) {
    const actionColors = {
      on: 'var(--success)',
      activate: 'var(--success)',
      off: 'var(--text-secondary)',
      deactivate: 'var(--text-secondary)',
      set: 'var(--brand-primary)',
    };
    const actionColor = actionColors[l.action] || 'var(--text-primary)';
    const sourceBadge = l.source && l.source !== 'manual'
      ? `<span class="badge badge--tier-base-camp" style="font-size:10px">${escHtml(l.source)}</span>`
      : `<span class="t-muted" style="font-size:11px">manual</span>`;

    let valueText = '—';
    if (l.value != null) {
      try {
        if (typeof l.value === 'string') valueText = l.value;
        else valueText = JSON.stringify(l.value);
      } catch (_) {
        valueText = String(l.value);
      }
      if (valueText.length > 60) valueText = valueText.slice(0, 57) + '…';
    }

    const cell = (content, color = 'var(--text-primary)', style = '') =>
      `<td style="padding:6px 10px;white-space:nowrap;color:${color};border-top:1px solid var(--border-subtle);${style}">${content}</td>`;

    return `
      <tr>
        ${cell(formatDateTime(l.occurred_at), 'var(--text-secondary)', 'font-size:11px')}
        ${cell(`<span style="font-weight:500">${escHtml(l.device_name || l.device_key || '—')}</span>`)}
        ${cell(escHtml(l.device_category || '—'), 'var(--text-secondary)')}
        ${cell(`<span style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.04em">${escHtml(l.action || '—')}</span>`, actionColor)}
        ${cell(sourceBadge)}
        ${cell(`<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px">${escHtml(valueText)}</span>`, 'var(--text-secondary)')}
      </tr>
    `;
  },

  _goToDevLogsPage(page) {
    const totalPages = Math.ceil(this._devLogs.length / this._devLogsPerPage);
    this._devLogsPage = Math.max(1, Math.min(totalPages, page));
    this._renderDevLogsPage();
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CERBO SYSTEM LOGS
  // ═══════════════════════════════════════════════════════════════════════

  _renderLogsCard() {
    const today = localDate();
    const weekAgo = localDate(new Date(Date.now() - 7 * 86400000));
    return `
      <div class="card">
        <div class="card-title">Victron Cerbo Telemetry</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          Data logged from the vehicle's Cerbo GX via the ArcNode history server.
          Select a date range to load telemetry.
        </div>
        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Start</label>
            <input type="date" id="userLogStart" value="${weekAgo}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>End</label>
            <input type="date" id="userLogEnd" value="${today}" max="${today}">
          </div>
          <button class="btn btn-primary btn-sm" id="userLoadLogsBtn" onclick="UserDetailPage.loadLogs()">Load Logs</button>
        </div>
        <div id="userLogsContent">
          <div class="t-muted t-detail">Select a date range and click Load Logs.</div>
        </div>
      </div>
    `;
  },

  _initLogsSection() {
    this._logs = [];
    this._page = 1;
    this._devLogs = [];
    this._devLogsPage = 1;
  },

  async loadLogs() {
    const startInput = document.getElementById('userLogStart');
    const endInput = document.getElementById('userLogEnd');
    const btn = document.getElementById('userLoadLogsBtn');
    const contentEl = document.getElementById('userLogsContent');
    if (!startInput || !endInput || !btn || !contentEl) return;

    const start = startInput.value;
    const end = endInput.value;
    if (!start || !end) {
      contentEl.innerHTML = '<div class="t-danger t-detail">Pick a start and end date.</div>';
      return;
    }

    btn.textContent = 'Loading...';
    btn.disabled = true;
    contentEl.innerHTML = '<div class="t-muted t-detail">Fetching logs...</div>';

    try {
      const logs = await this._fetchAllLogs(
        this.userId,
        localDateToUTCStart(start),
        localDateToUTCEnd(end)
      );

      this._logs = logs;
      this._page = 1;
      this._dateRange = { start, end };

      if (logs.length === 0) {
        contentEl.innerHTML = `<div class="t-muted t-detail">No log entries from ${escHtml(start)} to ${escHtml(end)}.</div>`;
      } else {
        this._renderLogsPage();
      }
    } catch (e) {
      console.error('[Logs] fetch failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load logs — ${escHtml(e.message || '')}</div>`;
    }

    btn.textContent = 'Load Logs';
    btn.disabled = false;
  },

  async _fetchAllLogs(userId, startISO, endISO) {
    const batchSize = 1000;
    let all = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await supa(
        `system_logs?user_id=eq.${userId}&logged_at=gte.${startISO}&logged_at=lte.${endISO}&order=logged_at.asc&limit=${batchSize}&offset=${offset}`
      );
      all = all.concat(batch);
      if (batch.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
      if (all.length > 50000) {
        console.warn('[Logs] hit 50k cap, stopping fetch');
        hasMore = false;
      }
    }

    return all;
  },

  _renderLogsPage() {
    const contentEl = document.getElementById('userLogsContent');
    if (!contentEl) return;

    const logs = this._logs;
    const page = this._page;
    const perPage = this._perPage;
    const total = logs.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageLogs = logs.slice(startIdx, endIdx);

    const perPageSelect = `
      <select onchange="UserDetailPage.setPerPage(parseInt(this.value))" style="padding:6px 10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:13px">
        <option value="50" ${perPage === 50 ? 'selected' : ''}>50 / page</option>
        <option value="100" ${perPage === 100 ? 'selected' : ''}>100 / page</option>
        <option value="250" ${perPage === 250 ? 'selected' : ''}>250 / page</option>
        <option value="500" ${perPage === 500 ? 'selected' : ''}>500 / page</option>
      </select>
    `;

    const pageButtons = this._buildPageButtons(page, totalPages);

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
          ${perPageSelect}
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(1)" ${page === 1 ? 'disabled' : ''} title="First">«</button>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>
          ${pageButtons}
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last">»</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} entries from ${this._dateRange.start} to ${this._dateRange.end}</div>`;

    contentEl.innerHTML = this._renderLogsTable(pageLogs) + pagination;
  },

  _buildPageButtons(current, total) {
    const btn = (p) => `<button class="btn ${p === current ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="UserDetailPage.goToPage(${p})" style="min-width:32px;padding:4px 8px">${p}</button>`;
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

  _renderLogsTable(logs) {
    return `
      <div style="overflow-x:auto;border:1px solid var(--border-default);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-muted);text-align:left">
              ${['Date','Time','Battery','Voltage','Solar','DC Load','AC Load','Fresh','Grey','Shore','Engine','Outside','Indoor','Outdoor','Humidity','Location']
                .map((h) => `<th style="padding:8px 10px;font-weight:500;color:var(--text-dark);white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${logs.map((l) => this._renderLogRow(l)).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  _renderLogRow(l) {
    const socColor = l.battery_soc == null ? 'var(--text-muted)'
      : l.battery_soc > 50 ? 'var(--success)'
      : l.battery_soc > 20 ? 'var(--warning, #E8A33B)'
      : 'var(--danger)';
    const fwColor = l.fresh_water_level == null ? 'var(--text-muted)'
      : l.fresh_water_level < 20 ? 'var(--danger)'
      : 'var(--text-primary)';
    const gwColor = l.grey_water_level == null ? 'var(--text-muted)'
      : l.grey_water_level > 80 ? 'var(--danger)'
      : 'var(--text-primary)';
    const dim = 'var(--text-secondary)';
    const primary = 'var(--text-primary)';

    const cell = (content, color = primary, style = '') =>
      `<td style="padding:6px 10px;white-space:nowrap;color:${color};border-top:1px solid var(--border-subtle);${style}">${content}</td>`;

    return `
      <tr>
        ${cell(formatDate(l.logged_at), dim, 'font-size:11px')}
        ${cell(formatTime(l.logged_at), dim, 'font-size:11px')}
        ${cell(`${(l.battery_soc || 0).toFixed(0)}%`, socColor, 'font-weight:500')}
        ${cell(`${(l.battery_voltage || 0).toFixed(1)}V`, primary)}
        ${cell(`${(l.solar_power || 0).toFixed(0)}W`, l.solar_power > 0 ? 'var(--success)' : dim)}
        ${cell(`${(l.dc_load_power || 0).toFixed(0)}W`, primary)}
        ${cell(`${(l.ac_load_power || 0).toFixed(0)}W`, primary)}
        ${cell(l.fresh_water_level != null ? `${l.fresh_water_level.toFixed(0)}%` : '—', fwColor)}
        ${cell(l.grey_water_level != null ? `${l.grey_water_level.toFixed(0)}%` : '—', gwColor)}
        ${cell(l.shore_connected ? '●' : '○', l.shore_connected ? 'var(--brand-primary)' : dim)}
        ${cell(l.engine_running ? '●' : '○', l.engine_running ? 'var(--success)' : dim)}
        ${cell(l.outside_temp != null ? `${l.outside_temp.toFixed(0)}°` : '—', primary)}
        ${cell(l.ruuvi_indoor_temp_f != null ? `${l.ruuvi_indoor_temp_f.toFixed(1)}°F` : '—', 'var(--brand-primary)')}
        ${cell(l.ruuvi_outdoor_temp_f != null ? `${l.ruuvi_outdoor_temp_f.toFixed(1)}°F` : '—', 'var(--success)')}
        ${cell(
          `${l.ruuvi_indoor_humidity != null ? l.ruuvi_indoor_humidity.toFixed(0) + '%' : '—'}${l.ruuvi_outdoor_humidity != null ? ' / ' + l.ruuvi_outdoor_humidity.toFixed(0) + '%' : ''}`,
          dim, 'font-size:11px'
        )}
        ${cell(l.latitude ? `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}` : '—', dim, 'font-size:11px')}
      </tr>
    `;
  },

  goToPage(page) {
    const totalPages = Math.ceil(this._logs.length / this._perPage);
    this._page = Math.max(1, Math.min(totalPages, page));
    this._renderLogsPage();
  },

  setPerPage(n) {
    this._perPage = n;
    this._page = 1;
    this._renderLogsPage();
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  async changeTier(newTier) {
    try {
      const existing = await supa(`subscriptions?user_id=eq.${this.userId}&select=*`);
      if (existing[0]) {
        await supaPatch(`subscriptions?user_id=eq.${this.userId}`, {
          tier: newTier,
          status: 'active',
        });
      } else {
        await supaPost('subscriptions', {
          user_id: this.userId,
          tier: newTier,
          status: 'active',
          platform: 'admin',
        });
      }
      await this.load({ userId: this.userId });
    } catch (e) {
      alert(`Failed to change tier: ${e.message}`);
    }
  },

  async deleteUser() {
    if (!confirm(`Permanently delete ${this.userName}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: this.userId }),
      });
      if (!res.ok) throw new Error(await res.text());
      Router.navigate('clients');
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  },
};

window.UserDetailPage = UserDetailPage;