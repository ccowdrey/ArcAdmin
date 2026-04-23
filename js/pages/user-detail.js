// ArcAdmin — User Detail Page
// ============================
// Identity + subscription + vehicle + account actions + Victron Cerbo
// system logs with pagination.
//
// 2026-04-23 update: Cerbo telemetry log viewer restored (was accidentally
// removed in the redesign rewrite). Date range picker, batched fetch,
// paginated table, all using new design tokens.

const UserDetailPage = {
  userId: null,
  userName: '',
  userEmail: '',
  vehicleId: null,

  // Telemetry log state
  _logs: [],
  _page: 1,
  _perPage: 100,
  _dateRange: { start: '', end: '' },

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

      // Build line + company (if present)
      let buildLineLabel = '—';
      let companyLabel = '—';
      if (v?.build_line_id) {
        try {
          const bls = await supa(`build_lines?id=eq.${v.build_line_id}&select=name,company_id`);
          if (bls[0]) {
            buildLineLabel = bls[0].name;
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

      this._render({ profile: p, sub, vehicle: v, buildLineLabel, companyLabel });

      // Set default log date range (last 7 days) and auto-load
      if (v) {
        this._initLogsSection();
      }
    } catch (e) {
      console.error('User detail load failed:', e);
      if (contentEl) contentEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  _render({ profile, sub, vehicle, buildLineLabel, companyLabel }) {
    const contentEl = document.getElementById('userDetailContent');
    if (!contentEl) return;

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
            ${this._infoLine('Nickname', escHtml(vehicle.nickname || vehicle.name || '—'))}
            ${this._infoLine('VIN', escHtml(vehicle.vin || '—'))}
            ${this._infoLine('Cerbo IP', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_ip || '—')}</span>`)}
            ${this._infoLine('Cerbo portal ID', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_portal_id || '—')}</span>`)}
          ` : `<div class="t-muted t-detail" style="padding:8px 0">No vehicle registered.</div>`}
        </div>

        <div class="info-card">
          <div class="info-card-title">SUBSCRIPTION</div>
          ${sub ? `
            ${this._infoLine('Tier', `<span style="text-transform:capitalize">${escHtml((sub.tier || '').replace(/_/g, ' ') || '—')}</span>`)}
            ${this._infoLine('Status', `<span style="text-transform:capitalize">${escHtml(sub.status || '—')}</span>`)}
            ${this._infoLine('Platform', escHtml(sub.platform || '—'))}
            ${sub.current_period_end ? this._infoLine('Renews', escHtml(formatDate(sub.current_period_end))) : ''}
          ` : `<div class="t-muted t-detail" style="padding:8px 0">No subscription on record.</div>`}
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('explorer')">${sub ? 'Set' : 'Grant'} Explorer</button>
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('base_camp')">${sub ? 'Set' : 'Grant'} Base Camp</button>
          </div>
        </div>
      </div>

      ${vehicle ? this._renderLogsCard() : ''}

      ${Auth.isSuper() ? `
        <div class="card">
          <div class="card-title t-danger">Danger zone</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">
            Permanently delete this user and all their data. This cannot be undone.
          </div>
          <button class="btn btn-danger btn-sm" onclick="UserDetailPage.deleteUser()">Delete user</button>
        </div>
      ` : ''}
    `;
  },

  // Single info line: bold label left, regular value right.
  // Matches Figma node 42:1202 (justify-between, both on one line).
  _infoLine(label, value) {
    return `
      <div class="info-line">
        <span class="info-line-label">${escHtml(label)}</span>
        <span class="info-line-value">${value || '—'}</span>
      </div>
    `;
  },

  // Legacy row format (kept for telemetry and other callers)
  _row(label, value) {
    return `
      <div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div class="t-muted t-detail" style="width:160px;flex-shrink:0">${escHtml(label)}</div>
        <div class="t-body" style="flex:1">${value || '—'}</div>
      </div>
    `;
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
      // Safety cap to avoid runaway fetches
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