// ══════════════════════════════════════════════════════════
// ArcOS Admin — Log Pagination Patch
// ══════════════════════════════════════════════════════════
// Drop this into a <script> tag AFTER the main script block,
// OR replace the existing loadLogs / loadClientLogs functions.
// ══════════════════════════════════════════════════════════

// ── Pagination state ──
const LogPagination = {
  allLogs: [],
  currentPage: 1,
  perPage: 100,
  targetEl: 'logsContent',
  dateRange: { start: '', end: '' },
};

const ClientLogPagination = {
  allLogs: [],
  currentPage: 1,
  perPage: 100,
  targetEl: 'ccLogsContent',
  dateRange: { start: '', end: '' },
};

// ── Fetch ALL logs from Supabase (paginated API calls, 1000 per batch) ──
async function supaFetchAllLogs(userId, startISO, endISO) {
  const batchSize = 1000;
  let allLogs = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `system_logs?user_id=eq.${userId}&logged_at=gte.${startISO}&logged_at=lte.${endISO}&order=logged_at.asc&limit=${batchSize}&offset=${offset}`;
    const batch = await supa(url);
    allLogs = allLogs.concat(batch);
    
    if (batch.length < batchSize) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }
  
  return allLogs;
}

// ── Rewritten loadLogs with full fetch + client-side pagination ──
async function loadLogs() {
  if (!selectedUserId) return;
  const startDate = document.getElementById("logStartDate").value;
  const endDate = document.getElementById("logEndDate").value;
  const btn = document.getElementById("loadLogsBtn");
  btn.textContent = "Loading...";
  btn.disabled = true;

  try {
    const startLocal = new Date(startDate + "T00:00:00");
    const endLocal = new Date(endDate + "T23:59:59");
    const start = startLocal.toISOString();
    const end = endLocal.toISOString();

    const logs = await supaFetchAllLogs(selectedUserId, start, end);

    // Store for AI analysis
    window.currentLogData = logs;
    window.currentLogDateRange = { start: startDate, end: endDate };

    // Store in pagination state
    LogPagination.allLogs = logs;
    LogPagination.currentPage = 1;
    LogPagination.dateRange = { start: startDate, end: endDate };

    if (logs.length === 0) {
      document.getElementById("logsContent").innerHTML = `<div class="logs-empty">No log entries from ${startDate} to ${endDate}</div>`;
    } else {
      renderLogsPage(LogPagination, 'logsContent');
    }
  } catch (e) {
    document.getElementById("logsContent").innerHTML = `<div class="logs-empty" style="color:#FF6565">Failed to load: ${e.message}</div>`;
  }
  btn.textContent = "Load Logs";
  btn.disabled = false;

  // Show AI analysis card
  if (window.currentLogData && window.currentLogData.length > 0) {
    document.getElementById("aiAnalysisCard").style.display = "block";
    document.getElementById("aiAnalysisContent").innerHTML = '<div style="color:#8E8D8A;font-size:13px">Click <strong>Analyze Logs</strong> to get AI-powered insights on this data.</div>';
    document.getElementById("aiAnalysisBtn").textContent = "Analyze Logs";
  } else {
    document.getElementById("aiAnalysisCard").style.display = "none";
  }
}

// ── Rewritten loadClientLogs with pagination ──
async function loadClientLogs() {
  if (!selectedClientId) return;
  const startDate = document.getElementById("ccLogStartDate").value;
  const endDate = document.getElementById("ccLogEndDate").value;
  const btn = document.getElementById("ccLoadLogsBtn");
  btn.textContent = "Loading...";
  btn.disabled = true;

  try {
    const startLocal = new Date(startDate + "T00:00:00");
    const endLocal = new Date(endDate + "T23:59:59");
    const start = startLocal.toISOString();
    const end = endLocal.toISOString();

    const logs = await supaFetchAllLogs(selectedClientId, start, end);

    ClientLogPagination.allLogs = logs;
    ClientLogPagination.currentPage = 1;
    ClientLogPagination.dateRange = { start: startDate, end: endDate };

    if (logs.length === 0) {
      document.getElementById("ccLogsContent").innerHTML = `<div class="logs-empty">No log entries from ${startDate} to ${endDate}</div>`;
    } else {
      renderLogsPage(ClientLogPagination, 'ccLogsContent');
    }
  } catch (e) {
    document.getElementById("ccLogsContent").innerHTML = `<div class="logs-empty" style="color:#FF6565">Failed to load: ${e.message}</div>`;
  }
  btn.textContent = "Load Logs";
  btn.disabled = false;
}

// ── Render a page of logs with pagination controls ──
function renderLogsPage(state, targetElId) {
  const { allLogs, currentPage, perPage, dateRange } = state;
  const totalPages = Math.ceil(allLogs.length / perPage);
  const startIdx = (currentPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, allLogs.length);
  const pageLogs = allLogs.slice(startIdx, endIdx);

  // Determine which pagination object name to use for onclick handlers
  const stateVar = targetElId === 'ccLogsContent' ? 'ClientLogPagination' : 'LogPagination';

  const tableHTML = `
    <div class="logs-table">
      <table>
        <thead><tr>
          <th>Date</th><th>Time</th><th>Battery</th><th>Voltage</th><th>Solar</th><th>DC Load</th>
          <th>AC Load</th><th>Fresh</th><th>Grey</th><th>Shore</th><th>Engine</th><th>Temp</th><th>Location</th>
        </tr></thead>
        <tbody>
          ${pageLogs.map(l => `<tr>
            <td style="color:#666;font-size:11px">${formatDate(l.logged_at)}</td>
            <td style="color:#A8A7A7">${formatTime(l.logged_at)}</td>
            <td><span class="${l.battery_soc > 50 ? 'soc-high' : l.battery_soc > 20 ? 'soc-mid' : 'soc-low'}">${(l.battery_soc||0).toFixed(0)}%</span></td>
            <td style="color:#A8A7A7">${(l.battery_voltage||0).toFixed(1)}V</td>
            <td class="solar-val">${(l.solar_power||0).toFixed(0)}W</td>
            <td style="color:#A8A7A7">${(l.dc_load_power||0).toFixed(0)}W</td>
            <td style="color:#A8A7A7">${(l.ac_load_power||0).toFixed(0)}W</td>
            <td style="color:${l.fresh_water_level != null && l.fresh_water_level < 20 ? '#FF6565' : '#4A9FE5'}">${l.fresh_water_level != null ? l.fresh_water_level.toFixed(0) + '%' : '—'}</td>
            <td style="color:${l.grey_water_level != null && l.grey_water_level > 80 ? '#FF6565' : '#A8A7A7'}">${l.grey_water_level != null ? l.grey_water_level.toFixed(0) + '%' : '—'}</td>
            <td>${l.shore_connected ? `<span class="shore-on">● ${(l.shore_power||0).toFixed(0)}W</span>` : '<span class="text-dim">Off</span>'}</td>
            <td>${l.engine_running ? '<span class="engine-on">Running</span>' : '<span class="text-dim">Off</span>'}</td>
            <td style="color:#A8A7A7">${l.outside_temp ? l.outside_temp.toFixed(0) + '°F' : '—'}</td>
            <td style="color:#666;font-size:11px">${l.latitude && l.longitude ? `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}` : '—'}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  // Build pagination controls
  const paginationHTML = totalPages > 1 ? `
    <div class="logs-pagination">
      <div class="logs-pagination-left">
        <span class="logs-pagination-info">
          Showing ${startIdx + 1}–${endIdx} of ${allLogs.length.toLocaleString()} entries
        </span>
        <span class="logs-pagination-sep">·</span>
        <label class="logs-pagination-per-page">
          <select onchange="${stateVar}.perPage = parseInt(this.value); ${stateVar}.currentPage = 1; renderLogsPage(${stateVar}, '${targetElId}')">
            <option value="50" ${perPage === 50 ? 'selected' : ''}>50 / page</option>
            <option value="100" ${perPage === 100 ? 'selected' : ''}>100 / page</option>
            <option value="250" ${perPage === 250 ? 'selected' : ''}>250 / page</option>
            <option value="500" ${perPage === 500 ? 'selected' : ''}>500 / page</option>
          </select>
        </label>
      </div>
      <div class="logs-pagination-controls">
        <button class="pg-btn" onclick="${stateVar}.currentPage = 1; renderLogsPage(${stateVar}, '${targetElId}')" ${currentPage === 1 ? 'disabled' : ''}>«</button>
        <button class="pg-btn" onclick="${stateVar}.currentPage = ${currentPage - 1}; renderLogsPage(${stateVar}, '${targetElId}')" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
        ${buildPageButtons(currentPage, totalPages, stateVar, targetElId)}
        <button class="pg-btn" onclick="${stateVar}.currentPage = ${currentPage + 1}; renderLogsPage(${stateVar}, '${targetElId}')" ${currentPage === totalPages ? 'disabled' : ''}>›</button>
        <button class="pg-btn" onclick="${stateVar}.currentPage = ${totalPages}; renderLogsPage(${stateVar}, '${targetElId}')" ${currentPage === totalPages ? 'disabled' : ''}>»</button>
        <span class="logs-pagination-sep" style="margin: 0 4px">·</span>
        <span class="pg-jump-label">Go to</span>
        <input class="pg-jump-input" type="number" min="1" max="${totalPages}" value="${currentPage}"
          onkeydown="if(event.key==='Enter'){const p=Math.max(1,Math.min(${totalPages},parseInt(this.value)||1));${stateVar}.currentPage=p;renderLogsPage(${stateVar},'${targetElId}')}"
        >
        <span class="pg-jump-label">of ${totalPages}</span>
      </div>
    </div>` : '';

  const footerHTML = `<div class="logs-footer">${allLogs.length.toLocaleString()} total log entries from ${dateRange.start} to ${dateRange.end}</div>`;

  document.getElementById(targetElId).innerHTML = tableHTML + paginationHTML + footerHTML;
}

// ── Build smart page number buttons (show ellipsis for large page counts) ──
function buildPageButtons(current, total, stateVar, targetElId) {
  if (total <= 7) {
    // Show all pages
    return Array.from({ length: total }, (_, i) => i + 1)
      .map(p => `<button class="pg-btn ${p === current ? 'pg-active' : ''}" onclick="${stateVar}.currentPage=${p};renderLogsPage(${stateVar},'${targetElId}')">${p}</button>`)
      .join('');
  }

  // Show: 1 ... (current-1) current (current+1) ... last
  const pages = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);

  let html = '';
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) {
      html += '<span class="pg-ellipsis">…</span>';
    }
    html += `<button class="pg-btn ${p === current ? 'pg-active' : ''}" onclick="${stateVar}.currentPage=${p};renderLogsPage(${stateVar},'${targetElId}')">${p}</button>`;
    prev = p;
  }
  return html;
}
