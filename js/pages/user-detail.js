// ArcOS Admin — User Detail Page
// ================================
const UserDetailPage = {
  userId: null,
  userName: '',
  currentLogData: null,
  
  // Pagination state
  _logs: [],
  _page: 1,
  _perPage: 100,
  _dateRange: { start: '', end: '' },
  
  async load(params) {
    // Resolve slug or ID
    this.userId = Router.resolveId(params.userId);
    setActivePage('pageUserDetail');
    
    // Breadcrumb
    const bc = document.getElementById('userDetailBreadcrumb');
    if (Auth.isSuper()) {
      bc.innerHTML = `<a data-route href="/users">Users</a><span class="sep">›</span><span class="current" id="bcUserName">Loading...</span>`;
    } else {
      bc.innerHTML = `<a data-route href="/companies/${userCompanyId}">Clients</a><span class="sep">›</span><span class="current" id="bcUserName">Loading...</span>`;
    }
    
    try {
      // Profile
      const profiles = await supa(`profiles?id=eq.${this.userId}&select=*`);
      const p = profiles[0];
      if (!p) { Router.navigate('/users'); return; }
      
      this.userName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email;
      document.getElementById('bcUserName').textContent = this.userName;
      document.getElementById('userDetailName').textContent = this.userName;
      document.getElementById('userDetailEmail').textContent = p.email;
      
      // Subscription
      const subs = await supa(`subscriptions?user_id=eq.${this.userId}&select=*`);
      const sub = subs[0];
      document.getElementById('userDetailTier').innerHTML = tierBadge(sub?.tier);
      
      // Account info
      document.getElementById('userAccountInfo').innerHTML = `
        ${infoRow("User ID", `<span class="mono">${this.userId.slice(0, 8)}...</span>`)}
        ${infoRow("Joined", formatDate(p.created_at))}
        ${infoRow("Last Login", timeAgo(p.last_login_at))}
        ${infoRow("Company", p.company_id ? 'Yes' : 'No')}
      `;
      
      // Subscription info
      document.getElementById('userSubInfo').innerHTML = sub ? `
        ${infoRow("Tier", (sub.tier || '').toUpperCase())}
        ${infoRow("Status", `<span class="status-dot ${sub.status === 'active' ? 'status-active' : 'status-inactive'}"></span>${sub.status}`)}
        ${infoRow("Platform", sub.platform || "—")}
      ` : '<div style="color:#444;font-size:13px">No subscription</div>';
      
      // Vehicle
      const vehicles = await supa(`vehicles?user_id=eq.${this.userId}`);
      const v = vehicles[0];
      document.getElementById('userVehicleInfo').innerHTML = v ? `
        ${infoRow("Nickname", v.nickname || "—")}
        ${infoRow("Vehicle", `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "—")}
        ${infoRow("Cerbo IP", `<span class="mono">${v.cerbo_ip || "—"}</span>`)}
      ` : '<div style="color:#444;font-size:13px">No vehicle registered</div>';
      
      // Set date defaults
      const today = localDate();
      const weekAgo = localDate(new Date(Date.now() - 7 * 86400000));
      document.getElementById('userLogStart').value = weekAgo;
      document.getElementById('userLogEnd').value = today;
      document.getElementById('userLogStart').max = today;
      document.getElementById('userLogEnd').max = today;
      
      // Reset logs & analysis
      this._logs = [];
      this._page = 1;
      document.getElementById('userLogsContent').innerHTML = '<div class="logs-empty">Select a date range and click Load Logs</div>';
      document.getElementById('userAiCard').style.display = 'none';
      
    } catch (e) {
      console.error('Failed to load user:', e);
    }
  },
  
  // ── Fetch ALL logs from Supabase (loops past 1000-row limit) ──
  async fetchAllLogs(userId, startISO, endISO) {
    const batchSize = 1000;
    let allLogs = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await supa(
        `system_logs?user_id=eq.${userId}&logged_at=gte.${startISO}&logged_at=lte.${endISO}&order=logged_at.asc&limit=${batchSize}&offset=${offset}`
      );
      allLogs = allLogs.concat(batch);
      if (batch.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    return allLogs;
  },
  
  async loadLogs() {
    const start = document.getElementById('userLogStart').value;
    const end = document.getElementById('userLogEnd').value;
    const btn = document.getElementById('userLoadLogsBtn');
    btn.textContent = 'Loading...';
    btn.disabled = true;
    
    try {
      const logs = await this.fetchAllLogs(
        this.userId,
        localDateToUTCStart(start),
        localDateToUTCEnd(end)
      );
      
      this.currentLogData = logs;
      this._logs = logs;
      this._page = 1;
      this._dateRange = { start, end };
      
      if (logs.length === 0) {
        document.getElementById('userLogsContent').innerHTML = `<div class="logs-empty">No log entries from ${start} to ${end}</div>`;
        document.getElementById('userAiCard').style.display = 'none';
      } else {
        this.renderPage();
        document.getElementById('userAiCard').style.display = 'block';
        document.getElementById('userAiContent').innerHTML = '<div style="color:#8E8D8A;font-size:13px">Click <strong>Analyze Logs</strong> for AI-powered insights.</div>';
        document.getElementById('userAiBtn').textContent = 'Analyze Logs';
      }
    } catch (e) {
      document.getElementById('userLogsContent').innerHTML = `<div class="logs-empty" style="color:#FF6565">Failed to load: ${e.message}</div>`;
    }
    btn.textContent = 'Load Logs';
    btn.disabled = false;
  },
  
  // ── Navigate to a specific page ──
  goToPage(page) {
    const totalPages = Math.ceil(this._logs.length / this._perPage);
    this._page = Math.max(1, Math.min(totalPages, page));
    this.renderPage();
  },
  
  setPerPage(n) {
    this._perPage = n;
    this._page = 1;
    this.renderPage();
  },
  
  // ── Render the current page of logs + pagination controls ──
  renderPage() {
    const { _logs: logs, _page: page, _perPage: perPage, _dateRange: dateRange } = this;
    const totalPages = Math.ceil(logs.length / perPage);
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, logs.length);
    const pageLogs = logs.slice(startIdx, endIdx);

    const tableHTML = this.renderLogTable(pageLogs);

    const paginationHTML = totalPages > 1 ? `
      <div class="logs-pagination">
        <div class="logs-pagination-left">
          <span class="logs-pagination-info">
            Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${logs.length.toLocaleString()} entries
          </span>
          <span class="logs-pagination-sep">·</span>
          <label class="logs-pagination-per-page">
            <select onchange="UserDetailPage.setPerPage(parseInt(this.value))">
              <option value="50" ${perPage === 50 ? 'selected' : ''}>50 / page</option>
              <option value="100" ${perPage === 100 ? 'selected' : ''}>100 / page</option>
              <option value="250" ${perPage === 250 ? 'selected' : ''}>250 / page</option>
              <option value="500" ${perPage === 500 ? 'selected' : ''}>500 / page</option>
            </select>
          </label>
        </div>
        <div class="logs-pagination-controls">
          <button class="pg-btn" onclick="UserDetailPage.goToPage(1)" ${page === 1 ? 'disabled' : ''} title="First">«</button>
          <button class="pg-btn" onclick="UserDetailPage.goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''} title="Previous">‹</button>
          ${this.buildPageButtons(page, totalPages)}
          <button class="pg-btn" onclick="UserDetailPage.goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''} title="Next">›</button>
          <button class="pg-btn" onclick="UserDetailPage.goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last">»</button>
          <span class="logs-pagination-sep" style="margin:0 4px">·</span>
          <span class="pg-jump-label">Go to</span>
          <input class="pg-jump-input" type="number" min="1" max="${totalPages}" value="${page}"
            onkeydown="if(event.key==='Enter'){UserDetailPage.goToPage(parseInt(this.value)||1)}"
          >
          <span class="pg-jump-label">of ${totalPages}</span>
        </div>
      </div>` : '';

    const footerHTML = `<div class="logs-footer">${logs.length.toLocaleString()} total entries from ${dateRange.start} to ${dateRange.end}</div>`;

    document.getElementById('userLogsContent').innerHTML = tableHTML + paginationHTML + footerHTML;
  },
  
  // ── Smart page number buttons with ellipsis ──
  buildPageButtons(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1)
        .map(p => `<button class="pg-btn ${p === current ? 'pg-active' : ''}" onclick="UserDetailPage.goToPage(${p})">${p}</button>`)
        .join('');
    }

    const pages = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);

    let html = '';
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) html += '<span class="pg-ellipsis">…</span>';
      html += `<button class="pg-btn ${p === current ? 'pg-active' : ''}" onclick="UserDetailPage.goToPage(${p})">${p}</button>`;
      prev = p;
    }
    return html;
  },
  
  renderLogTable(logs) {
    return `
      <div class="logs-table">
        <table>
          <thead><tr>
            <th>Date</th><th>Time</th><th>Battery</th><th>Voltage</th><th>Solar</th><th>DC Load</th>
            <th>AC Load</th><th>Fresh</th><th>Grey</th><th>Shore</th><th>Engine</th><th>Temp</th><th>Location</th>
          </tr></thead>
          <tbody>
            ${logs.map(l => `<tr>
              <td style="color:#666;font-size:11px">${formatDate(l.logged_at)}</td>
              <td style="color:#A8A7A7">${formatTime(l.logged_at)}</td>
              <td><span class="${l.battery_soc > 50 ? 'soc-high' : l.battery_soc > 20 ? 'soc-mid' : 'soc-low'}">${(l.battery_soc||0).toFixed(0)}%</span></td>
              <td style="color:#A8A7A7">${(l.battery_voltage||0).toFixed(1)}V</td>
              <td class="solar-val">${(l.solar_power||0).toFixed(0)}W</td>
              <td style="color:#A8A7A7">${(l.dc_load_power||0).toFixed(0)}W</td>
              <td style="color:#A8A7A7">${(l.ac_load_power||0).toFixed(0)}W</td>
              <td style="color:${l.fresh_water_level != null ? (l.fresh_water_level < 20 ? '#FF6565' : '#64B5F6') : '#333'}">${l.fresh_water_level != null ? l.fresh_water_level.toFixed(0) + '%' : '—'}</td>
              <td style="color:${l.grey_water_level != null ? (l.grey_water_level > 80 ? '#FF6565' : '#A8A7A7') : '#333'}">${l.grey_water_level != null ? l.grey_water_level.toFixed(0) + '%' : '—'}</td>
              <td>${l.shore_connected ? '<span class="shore-on">●</span>' : '<span style="color:#333">○</span>'}</td>
              <td>${l.engine_running ? '<span class="engine-on">●</span>' : '<span style="color:#333">○</span>'}</td>
              <td style="color:#A8A7A7">${l.outside_temp != null ? l.outside_temp.toFixed(0) + '°' : '—'}</td>
              <td style="color:#666;font-size:11px">${l.latitude ? l.latitude.toFixed(3) + ',' + l.longitude.toFixed(3) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
  
  async deleteUser() {
    if (!confirm(`Delete user "${this.userName}"? This cannot be undone.`)) return;
    if (!confirm('Are you SURE? All data will be permanently deleted.')) return;
    
    try {
      await supaDelete(`system_logs?user_id=eq.${this.userId}`);
      await supaDelete(`vehicles?user_id=eq.${this.userId}`);
      await supaDelete(`subscriptions?user_id=eq.${this.userId}`);
      await supaDelete(`company_admins?user_id=eq.${this.userId}`);
      await supaDelete(`profiles?id=eq.${this.userId}`);
      Router.navigate('/users');
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }
};
window.UserDetailPage = UserDetailPage;