// ArcOS Admin — User Detail Page
// ================================

const UserDetailPage = {
  userId: null,
  userName: '',
  currentLogData: null,
  
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
      document.getElementById('userLogsContent').innerHTML = '<div class="logs-empty">Select a date range and click Load Logs</div>';
      document.getElementById('userAiCard').style.display = 'none';
      
    } catch (e) {
      console.error('Failed to load user:', e);
    }
  },
  
  async loadLogs() {
    const start = document.getElementById('userLogStart').value;
    const end = document.getElementById('userLogEnd').value;
    const btn = document.getElementById('userLoadLogsBtn');
    btn.textContent = 'Loading...';
    
    try {
      const logs = await supa(`system_logs?user_id=eq.${this.userId}&logged_at=gte.${localDateToUTCStart(start)}&logged_at=lte.${localDateToUTCEnd(end)}&order=logged_at.asc&limit=5000`);
      this.currentLogData = logs;
      
      if (logs.length === 0) {
        document.getElementById('userLogsContent').innerHTML = `<div class="logs-empty">No log entries from ${start} to ${end}</div>`;
        document.getElementById('userAiCard').style.display = 'none';
      } else {
        document.getElementById('userLogsContent').innerHTML = this.renderLogTable(logs, start, end);
        document.getElementById('userAiCard').style.display = 'block';
        document.getElementById('userAiContent').innerHTML = '<div style="color:#8E8D8A;font-size:13px">Click <strong>Analyze Logs</strong> for AI-powered insights.</div>';
        document.getElementById('userAiBtn').textContent = 'Analyze Logs';
      }
    } catch (e) {
      document.getElementById('userLogsContent').innerHTML = `<div class="logs-empty" style="color:#FF6565">Failed to load: ${e.message}</div>`;
    }
    btn.textContent = 'Load Logs';
  },
  
  renderLogTable(logs, startDate, endDate) {
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
      <div class="logs-footer">${logs.length} entries from ${startDate} to ${endDate}</div>
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