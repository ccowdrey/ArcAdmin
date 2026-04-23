// ArcOS Admin — Firmware Management Page
// =========================================

const FirmwarePage = {
  firmwareList: [],
  deviceStatuses: [],
  updateLogs: [],
  companies: [],

  async load() {
    setActivePage('pageFirmware');
    setActiveTab('tabFirmware');

    try {
      const [firmware, devices, logs, companies] = await Promise.all([
        supa('firmware_versions?select=*,companies:target_company_id(name)&order=version_code.desc'),
        supa('device_firmware_status?select=*,vehicles:vehicle_id(id,make,model,nickname,user_id)&order=last_check_at.desc'),
        supa('firmware_update_log?select=*,firmware_versions:firmware_version_id(version),vehicles:vehicle_id(nickname,model)&order=created_at.desc&limit=50'),
        supa('companies?select=id,name&order=name')
      ]);

      this.firmwareList = firmware;
      this.deviceStatuses = devices;
      this.updateLogs = logs;
      this.companies = companies;

      // Stats
      const active = firmware.filter(f => f.is_active).length;
      const totalDevices = devices.length;
      const upToDate = devices.filter(d => {
        const latest = firmware.find(f => f.is_active && f.target_scope === 'all');
        return latest && d.current_version_code >= latest.version_code;
      }).length;
      const failed = devices.filter(d => d.last_update_status === 'failed').length;

      document.getElementById('statFirmwareVersions').textContent = firmware.length;
      document.getElementById('statActiveReleases').textContent = active;
      document.getElementById('statDevicesOnline').textContent = totalDevices;
      document.getElementById('statUpdatesFailed').textContent = failed;

      this.showTab('releases');
    } catch (e) {
      console.error('Firmware load failed:', e);
    }
  },

  showTab(tab) {
    document.getElementById('fwTabReleases').classList.toggle('active', tab === 'releases');
    document.getElementById('fwTabDevices').classList.toggle('active', tab === 'devices');
    document.getElementById('fwTabLog').classList.toggle('active', tab === 'log');

    document.getElementById('fwPanelReleases').style.display = tab === 'releases' ? '' : 'none';
    document.getElementById('fwPanelDevices').style.display = tab === 'devices' ? '' : 'none';
    document.getElementById('fwPanelLog').style.display = tab === 'log' ? '' : 'none';

    if (tab === 'releases') this.renderReleases();
    else if (tab === 'devices') this.renderDevices();
    else if (tab === 'log') this.renderLog();
  },

  // ── Releases Tab ──────────────────────────────────────
  renderReleases() {
    const tbody = document.getElementById('fwReleasesBody');
    if (this.firmwareList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#666;padding:32px">No firmware versions uploaded yet</td></tr>';
      return;
    }

    tbody.innerHTML = this.firmwareList.map(fw => {
      const scopeLabel = fw.target_scope === 'all' ? 'All Devices'
        : fw.target_scope === 'company' ? (fw.companies?.name || 'Company')
        : fw.target_scope === 'build_line' ? (fw.target_build_line || 'Build Line')
        : 'Vehicle';
      const scopeColor = fw.target_scope === 'all' ? '#767DFB' : fw.target_scope === 'company' ? '#2ABC53' : '#E7B400';
      const activeColor = fw.is_active ? '#2ABC53' : '#666';
      const size = fw.file_size_bytes ? (fw.file_size_bytes / 1024).toFixed(0) + ' KB' : '—';

      return `<tr>
        <td style="color:#F5F1EB;font-weight:500">${escHtml(fw.version)}</td>
        <td style="color:#8E8D8A">${fw.version_code}</td>
        <td><span class="tier" style="background:${scopeColor}20;color:${scopeColor}">${escHtml(scopeLabel)}</span></td>
        <td style="color:#8E8D8A">${size}</td>
        <td><span style="color:${activeColor};font-weight:500">${fw.is_active ? '● Active' : '○ Inactive'}</span></td>
        <td style="color:#666;font-size:12px">${timeAgo(fw.created_at)}</td>
        <td style="display:flex;gap:6px">
          <button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="FirmwarePage.toggleActive('${fw.id}', ${!fw.is_active})">${fw.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn-secondary" style="font-size:11px;padding:4px 10px;color:#FF6565" onclick="FirmwarePage.deleteFirmware('${fw.id}', '${fw.storage_path}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  },

  // ── Devices Tab ───────────────────────────────────────
  renderDevices() {
    const tbody = document.getElementById('fwDevicesBody');
    if (this.deviceStatuses.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;padding:32px">No devices have checked in yet</td></tr>';
      return;
    }

    tbody.innerHTML = this.deviceStatuses.map(d => {
      const vehicle = d.vehicles;
      const name = vehicle?.nickname || `${vehicle?.make || ''} ${vehicle?.model || ''}`.trim() || 'Unknown';
      const statusColor = d.last_update_status === 'success' ? '#2ABC53'
        : d.last_update_status === 'failed' ? '#FF6565'
        : d.last_update_status === 'rolled_back' ? '#E7B400'
        : '#8E8D8A';

      return `<tr>
        <td style="color:#F5F1EB">${escHtml(name)}</td>
        <td style="color:#8E8D8A;font-family:monospace">${escHtml(d.current_version || '—')}</td>
        <td style="color:#8E8D8A;font-family:monospace;font-size:12px">${escHtml(d.device_mac || '—')}</td>
        <td style="color:#8E8D8A">${d.wifi_rssi ? d.wifi_rssi + ' dBm' : '—'}</td>
        <td><span style="color:${statusColor}">${d.last_update_status || 'none'}</span></td>
        <td style="color:#666;font-size:12px">${timeAgo(d.last_check_at)}</td>
      </tr>`;
    }).join('');
  },

  // ── Log Tab ───────────────────────────────────────────
  renderLog() {
    const tbody = document.getElementById('fwLogBody');
    if (this.updateLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;padding:32px">No update attempts yet</td></tr>';
      return;
    }

    tbody.innerHTML = this.updateLogs.map(log => {
      const vehicle = log.vehicles;
      const name = vehicle?.nickname || vehicle?.model || 'Unknown';
      const version = log.firmware_versions?.version || log.to_version || '—';
      const statusColor = log.status === 'success' ? '#2ABC53'
        : log.status === 'failed' ? '#FF6565'
        : log.status === 'started' ? '#767DFB'
        : '#8E8D8A';

      return `<tr>
        <td style="color:#F5F1EB">${escHtml(name)}</td>
        <td style="color:#8E8D8A">${escHtml(log.from_version || '—')} → ${escHtml(version)}</td>
        <td><span style="color:${statusColor};font-weight:500">${log.status}</span></td>
        <td style="color:#FF6565;font-size:12px">${escHtml(log.error_message || '')}</td>
        <td style="color:#666;font-size:12px">${formatDateTime(log.created_at)}</td>
      </tr>`;
    }).join('');
  },

  // ── Upload Modal ──────────────────────────────────────
  showUploadModal() {
    // Populate company dropdown
    const sel = document.getElementById('fwTargetCompany');
    sel.innerHTML = '<option value="">— Select Company —</option>' +
      this.companies.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

    document.getElementById('fwUploadModal').style.display = 'flex';
    this.updateTargetFields();
  },

  closeUploadModal() {
    document.getElementById('fwUploadModal').style.display = 'none';
  },

  updateTargetFields() {
    const scope = document.getElementById('fwTargetScope').value;
    document.getElementById('fwTargetCompanyRow').style.display = (scope === 'company' || scope === 'build_line') ? '' : 'none';
    document.getElementById('fwTargetBuildLineRow').style.display = scope === 'build_line' ? '' : 'none';
    document.getElementById('fwTargetVehicleRow').style.display = scope === 'vehicle' ? '' : 'none';
  },

  async uploadFirmware() {
    const fileInput = document.getElementById('fwFile');
    const file = fileInput.files[0];
    if (!file) { alert('Please select a firmware file'); return; }

    const version = document.getElementById('fwVersion').value.trim();
    const versionCode = parseInt(document.getElementById('fwVersionCode').value);
    const notes = document.getElementById('fwNotes').value.trim();
    const scope = document.getElementById('fwTargetScope').value;
    const companyId = document.getElementById('fwTargetCompany').value || null;
    const buildLine = document.getElementById('fwTargetBuildLine').value.trim() || null;
    const vehicleId = document.getElementById('fwTargetVehicle').value.trim() || null;
    const mandatory = document.getElementById('fwMandatory').checked;

    if (!version || !versionCode) { alert('Version and version code are required'); return; }

    const btn = document.getElementById('fwUploadBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    try {
      // Upload binary to Supabase Storage
      const storagePath = `releases/${version}/${file.name}`;
      const { url, error: uploadErr } = await Storage.upload('firmware', storagePath, file, (pct) => {
        btn.textContent = `Uploading... ${pct}%`;
      });

      if (uploadErr) throw new Error(uploadErr);

      // Compute SHA-256
      btn.textContent = 'Computing hash...';
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Create firmware_versions record
      btn.textContent = 'Saving...';
      await supaPost('firmware_versions', {
        version,
        version_code: versionCode,
        release_notes: notes || null,
        storage_path: storagePath,
        file_size_bytes: file.size,
        sha256_hash: sha256,
        target_scope: scope,
        target_company_id: companyId,
        target_build_line: buildLine,
        target_vehicle_id: vehicleId,
        is_mandatory: mandatory,
        is_active: false
      });

      this.closeUploadModal();
      this.load(); // Refresh
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }

    btn.disabled = false;
    btn.textContent = 'Upload & Save';
  },

  // ── Actions ───────────────────────────────────────────
  async toggleActive(id, active) {
    try {
      await supaPatch(`firmware_versions?id=eq.${id}`, { is_active: active, updated_at: new Date().toISOString() });
      this.load();
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  },

  async deleteFirmware(id, storagePath) {
    if (!confirm('Delete this firmware version? This cannot be undone.')) return;
    try {
      if (storagePath) await Storage.remove('firmware', storagePath);
      await supaDelete(`firmware_versions?id=eq.${id}`);
      this.load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }
};

window.FirmwarePage = FirmwarePage;
