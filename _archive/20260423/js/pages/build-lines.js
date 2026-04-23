// ArcNode Admin — Build Lines Management
// =========================================
// Manages build lines (product lineup) per company.
// Each builder has build lines (e.g. Rogue: Ethos, Odyssey, Palisades)
// Documents uploaded at the build-line level are shared across all vehicles of that type.

const BuildLinesPage = {
  companyId: null,
  companyName: '',
  buildLines: [],

  // ── Load build lines for a company ──
  async loadForCompany(companyId, companyName) {
    this.companyId = companyId;
    this.companyName = companyName || '';

    try {
      const lines = await supa(`build_lines?company_id=eq.${companyId}&is_active=eq.true&select=*&order=sort_order.asc,name.asc`);
      this.buildLines = lines;
      this.render();
    } catch (e) {
      console.error('Load build lines failed:', e);
      document.getElementById('buildLinesBody').innerHTML =
        `<tr><td colspan="7" style="text-align:center;color:#FF6565;padding:16px">Failed to load build lines</td></tr>`;
    }
  },

  render() {
    const tbody = document.getElementById('buildLinesBody');
    if (!tbody) return;

    if (this.buildLines.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#666;padding:16px">No build lines yet — add your first model</td></tr>`;
      // Update stat
      const stat = document.getElementById('companyStatBuildLines');
      if (stat) stat.textContent = '0';
      return;
    }

    const stat = document.getElementById('companyStatBuildLines');
    if (stat) stat.textContent = this.buildLines.length;

    const companySlug = Router.getSlug(this.companyId);
    tbody.innerHTML = this.buildLines.map(bl => {
      const blSlug = Router.getSlug(bl.id) || slugify(bl.name);
      // Register slug for this build line
      Router.registerSlug(bl.id, bl.name);
      return `<tr onclick="Router.navigate('/companies/${companySlug}/builds/${blSlug}')" style="cursor:pointer">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;background:#767DFB15;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#767DFB" stroke-width="1.5"><path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M5 17h-2v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6-6h15m-6 0v-5"/></svg>
            </div>
            <div>
              <div style="color:#F5F1EB;font-weight:600;font-size:14px">${escHtml(bl.name)}</div>
              ${bl.description ? `<div style="color:#666;font-size:12px;margin-top:2px">${escHtml(bl.description)}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="color:#8E8D8A;font-size:13px">${escHtml(bl.default_make || '—')}</td>
        <td style="color:#8E8D8A;font-size:13px">${escHtml(bl.default_model || '—')}</td>
        <td style="color:#8E8D8A;font-size:13px">${escHtml(bl.default_year || '—')}</td>
        <td>${bl.schematic_url ? '<span style="color:#2ABC53;font-size:12px">✓ Uploaded</span>' : '<span style="color:#666;font-size:12px">—</span>'}</td>
        <td style="color:#666;font-size:12px">${timeAgo(bl.created_at)}</td>
        <td>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="BuildLinesPage.showEditModal('${bl.id}')">Edit</button>
            <button class="btn-delete" style="font-size:11px;padding:4px 10px" onclick="BuildLinesPage.deleteLine('${bl.id}','${escHtml(bl.name)}')">Delete</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  },

  // ── Add Build Line Modal ──
  showAddModal() {
    document.getElementById('buildLineModalTitle').textContent = 'Add Build Line';
    document.getElementById('buildLineId').value = '';
    document.getElementById('buildLineName').value = '';
    document.getElementById('buildLineDesc').value = '';
    document.getElementById('buildLineMake').value = '';
    document.getElementById('buildLineModel').value = '';
    document.getElementById('buildLineYear').value = '';
    document.getElementById('buildLineSortOrder').value = '0';
    document.getElementById('buildLineError').classList.add('hidden');
    document.getElementById('buildLineSaveBtn').textContent = 'Add Build Line';
    openModal('buildLineModal');
  },

  // ── Edit Build Line Modal ──
  showEditModal(lineId) {
    const bl = this.buildLines.find(b => b.id === lineId);
    if (!bl) return;

    document.getElementById('buildLineModalTitle').textContent = 'Edit Build Line';
    document.getElementById('buildLineId').value = bl.id;
    document.getElementById('buildLineName').value = bl.name || '';
    document.getElementById('buildLineDesc').value = bl.description || '';
    document.getElementById('buildLineMake').value = bl.default_make || '';
    document.getElementById('buildLineModel').value = bl.default_model || '';
    document.getElementById('buildLineYear').value = bl.default_year || '';
    document.getElementById('buildLineSortOrder').value = bl.sort_order || 0;
    document.getElementById('buildLineError').classList.add('hidden');
    document.getElementById('buildLineSaveBtn').textContent = 'Save Changes';
    openModal('buildLineModal');
  },

  // ── Save (create or update) ──
  async saveLine() {
    const id = document.getElementById('buildLineId').value;
    const name = document.getElementById('buildLineName').value.trim();
    const description = document.getElementById('buildLineDesc').value.trim();
    const defaultMake = document.getElementById('buildLineMake').value.trim();
    const defaultModel = document.getElementById('buildLineModel').value.trim();
    const defaultYear = document.getElementById('buildLineYear').value.trim();
    const sortOrder = parseInt(document.getElementById('buildLineSortOrder').value) || 0;
    const errEl = document.getElementById('buildLineError');
    errEl.classList.add('hidden');

    if (!name) {
      errEl.textContent = 'Build line name is required';
      errEl.classList.remove('hidden');
      return;
    }

    const data = {
      company_id: this.companyId,
      name,
      description: description || null,
      default_make: defaultMake || null,
      default_model: defaultModel || null,
      default_year: defaultYear || null,
      sort_order: sortOrder,
      is_active: true
    };

    try {
      if (id) {
        // Update
        await supaPatch(`build_lines?id=eq.${id}`, data);
      } else {
        // Create
        await supaPost('build_lines', data);
      }
      closeModals();
      await this.loadForCompany(this.companyId, this.companyName);
    } catch (e) {
      errEl.textContent = e.message || 'Failed to save build line';
      errEl.classList.remove('hidden');
    }
  },

  // ── Delete ──
  async deleteLine(lineId, name) {
    if (!confirm(`Delete build line "${name}"? Documents linked to this build line will remain but will no longer be associated with it.`)) return;
    try {
      // Soft delete — set is_active = false
      await supaPatch(`build_lines?id=eq.${lineId}`, { is_active: false });
      await this.loadForCompany(this.companyId, this.companyName);
    } catch (e) {
      alert('Failed to delete: ' + e.message);
    }
  }
};

// ── Build Line Detail Page ──
// Shows build line info + documents upload zone (shared across all vehicles of this type)
const BuildLineDetailPage = {
  lineId: null,
  companyId: null,
  lineData: null,

  async load(params) {
    this.companyId = Router.resolveId(params.companyId);
    this.lineId = Router.resolveId(params.buildLineId);

    setActivePage('pageBuildLineDetail');
    if (Auth.isSuper()) setActiveTab('tabCompanies');

    try {
      // Load build line
      const lines = await supa(`build_lines?id=eq.${this.lineId}&select=*`);
      if (!lines.length) { Router.navigate(`/companies/${params.companyId}`); return; }
      this.lineData = lines[0];

      // Ensure company data is available for breadcrumb
      let companyName = '';
      try {
        const companies = await supa(`companies?id=eq.${this.companyId}&select=name`);
        companyName = companies[0]?.name || '';
      } catch (_) {}

      // Breadcrumb
      const companySlug = Router.getSlug(this.companyId) || params.companyId;
      Router.registerSlug(this.companyId, companyName);
      Router.registerSlug(this.lineId, this.lineData.name);
      const bc = document.getElementById('buildLineDetailBreadcrumb');
      bc.innerHTML = `<a data-route href="/companies">Companies</a><span class="sep">›</span><a data-route href="/companies/${companySlug}">${escHtml(companyName)}</a><span class="sep">›</span><span class="current">${escHtml(this.lineData.name)}</span>`;

      // Header
      document.getElementById('buildLineDetailName').textContent = this.lineData.name;
      document.getElementById('buildLineDetailDesc').textContent = this.lineData.description || 'No description';

      // Info
      document.getElementById('buildLineDetailInfo').innerHTML = `
        ${infoRow('Default Make', this.lineData.default_make || '—')}
        ${infoRow('Default Model', this.lineData.default_model || '—')}
        ${infoRow('Default Year', this.lineData.default_year || '—')}
        ${infoRow('Sort Order', this.lineData.sort_order)}
        ${infoRow('Created', formatDateTime(this.lineData.created_at))}
        ${this.lineData.schematic_url ? infoRow('Schematic', `<a href="${this.lineData.schematic_url}" target="_blank" style="color:#767DFB">View ↗</a>`) : infoRow('Schematic', '—')}
      `;

      // Vehicle count using this build line
      try {
        const vehicles = await supa(`vehicles?build_line_id=eq.${this.lineId}&select=id`);
        document.getElementById('buildLineVehicleCount').textContent = vehicles.length;
      } catch (_) {
        document.getElementById('buildLineVehicleCount').textContent = '—';
      }

      // Document count
      try {
        const docs = await supa(`vehicle_documents?build_line_id=eq.${this.lineId}&select=id`);
        document.getElementById('buildLineDocCount').textContent = docs.length;
      } catch (_) {
        document.getElementById('buildLineDocCount').textContent = '—';
      }

      // Load documents for this build line
      const docsContainer = document.getElementById('buildLineDocsContainer');
      await Documents.loadForBuildLine(this.lineId, this.companyId, docsContainer);

      // Load systems picker
      await this.loadSystems();

      // Schematic upload
      this.renderSchematicUpload();

    } catch (e) {
      console.error('Load build line detail failed:', e);
    }
  },

  renderSchematicUpload() {
    const container = document.getElementById('buildLineSchematicSection');
    if (!container) return;

    if (this.lineData.schematic_url) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px">
          <img src="${escHtml(this.lineData.schematic_url)}" style="max-width:200px;max-height:120px;border-radius:8px;border:1px solid #333;background:#0A0A0A" onerror="this.style.display='none'">
          <div>
            <div style="color:#2ABC53;font-size:13px;font-weight:500;margin-bottom:8px">Schematic uploaded</div>
            <button class="btn-secondary" style="font-size:12px;padding:6px 12px" onclick="BuildLineDetailPage.removeSchematic()">Remove</button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="doc-upload-zone" style="padding:20px"
             ondragover="event.preventDefault();this.classList.add('doc-upload-zone-active')"
             ondragleave="this.classList.remove('doc-upload-zone-active')"
             ondrop="event.preventDefault();this.classList.remove('doc-upload-zone-active');BuildLineDetailPage.uploadSchematic(event.dataTransfer.files[0])"
             onclick="document.getElementById('schematicFileInput').click()">
          <input type="file" id="schematicFileInput" accept=".png,.jpg,.jpeg,.svg,.webp" style="display:none"
                 onchange="BuildLineDetailPage.uploadSchematic(this.files[0]);this.value=''">
          <div style="color:#F5F1EB;font-size:13px">Drop aerial schematic image here or click to browse</div>
          <div style="color:#666;font-size:12px;margin-top:4px">PNG, JPG, SVG · Used in Lights tab overlay</div>
        </div>
      `;
    }
  },

  async uploadSchematic(file) {
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Please upload a PNG, JPG, SVG, or WebP image');
      return;
    }

    try {
      const ext = file.name.split('.').pop();
      const path = `schematics/${this.companyId}/${this.lineId}.${ext}`;
      const { url, error } = await Storage.upload('schematics', path, file);
      if (error) throw new Error(error);

      // Update build line with schematic URL
      await supaPatch(`build_lines?id=eq.${this.lineId}`, { schematic_url: url });
      this.lineData.schematic_url = url;
      this.renderSchematicUpload();
    } catch (e) {
      alert('Failed to upload schematic: ' + e.message);
    }
  },

  async removeSchematic() {
    if (!confirm('Remove aerial schematic?')) return;
    try {
      if (this.lineData.schematic_url) {
        const path = this.lineData.schematic_url.split('/schematics/')[1];
        if (path) await Storage.remove('schematics', path);
      }
      await supaPatch(`build_lines?id=eq.${this.lineId}`, { schematic_url: null });
      this.lineData.schematic_url = null;
      this.renderSchematicUpload();
    } catch (e) {
      alert('Failed to remove: ' + e.message);
    }
  },

  // ── Systems picker ──────────────────────────────────────────────────────
  // Shows a checkbox grid of the device_catalog grouped by category.
  // Each toggle INSERTs or DELETEs a row in build_line_systems (no save button).
  // The DB trigger copies these defaults into vehicle_systems on vehicle insert.

  _catalog: [],          // cached device_catalog rows (loaded once per page view)
  _selectedIds: new Set(), // set of device_catalog_id currently attached

  async loadSystems() {
    const container = document.getElementById('buildLineSystemsContainer');
    if (!container) return;

    try {
      // Load catalog (once) and current selections in parallel
      const catalogPromise = this._catalog.length
        ? Promise.resolve(this._catalog)
        : supa(`device_catalog?is_active=eq.true&select=*&order=category.asc,device_name.asc`);
      const selectedPromise = supa(`build_line_systems?build_line_id=eq.${this.lineId}&select=device_catalog_id`);

      const [catalog, selected] = await Promise.all([catalogPromise, selectedPromise]);
      this._catalog = catalog;
      this._selectedIds = new Set(selected.map(r => r.device_catalog_id));

      this.renderSystems();
    } catch (e) {
      console.error('Load systems failed:', e);
      container.innerHTML = '<div style="color:#FF6565;font-size:13px;padding:16px">Failed to load systems</div>';
    }
  },

  renderSystems() {
    const container = document.getElementById('buildLineSystemsContainer');
    if (!container) return;

    // Group catalog by category
    const byCat = {};
    for (const d of this._catalog) {
      if (!byCat[d.category]) byCat[d.category] = [];
      byCat[d.category].push(d);
    }

    const categoryOrder = ['climate','power','plumbing','lighting','entertainment','exterior','sensors'];
    const categoryLabels = {
      climate:'Climate', power:'Power', plumbing:'Plumbing', lighting:'Lighting',
      entertainment:'Entertainment', exterior:'Awning & Exterior', sensors:'Sensors',
    };

    const selectedCount = this._selectedIds.size;

    let html = `<div style="color:#8E8D8A;font-size:12px;margin-bottom:16px">${selectedCount} ${selectedCount === 1 ? 'device' : 'devices'} selected</div>`;
    html += '<div style="display:flex;flex-direction:column;gap:20px">';

    for (const cat of categoryOrder) {
      if (!byCat[cat]?.length) continue;
      html += `
        <div>
          <div style="color:#8E8D8A;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">${categoryLabels[cat]}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">
            ${byCat[cat].map(d => this.renderSystemCheckbox(d)).join('')}
          </div>
        </div>
      `;
    }
    html += '</div>';

    container.innerHTML = html;
  },

  renderSystemCheckbox(device) {
    const checked = this._selectedIds.has(device.id);
    const bgColor = checked ? '#767DFB15' : '#1A1A1A';
    const borderColor = checked ? '#767DFB40' : '#2A2A2A';
    const checkBg = checked ? '#767DFB' : 'transparent';
    const checkBorder = checked ? '#767DFB' : '#444';
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${bgColor};border:1px solid ${borderColor};border-radius:8px;cursor:pointer;transition:background 0.15s,border-color 0.15s"
             onclick="BuildLineDetailPage.toggleSystem('${device.id}', event)"
             onmouseover="this.style.borderColor='#767DFB60'"
             onmouseout="this.style.borderColor='${borderColor}'">
        <div style="width:18px;height:18px;border-radius:4px;border:1.5px solid ${checkBorder};background:${checkBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s">
          ${checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
        <div style="flex:1;min-width:0">
          <div style="color:#F5F1EB;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(device.device_name)}</div>
          ${device.manufacturer ? `<div style="color:#666;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(device.manufacturer)}</div>` : ''}
        </div>
      </label>
    `;
  },

  async toggleSystem(deviceCatalogId, event) {
    // The <label> onclick fires; don't let it double-fire via browser default
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const wasSelected = this._selectedIds.has(deviceCatalogId);

    // Optimistic update — flip the UI immediately
    if (wasSelected) this._selectedIds.delete(deviceCatalogId);
    else this._selectedIds.add(deviceCatalogId);
    this.renderSystems();

    try {
      if (wasSelected) {
        // Remove
        await supaDelete(`build_line_systems?build_line_id=eq.${this.lineId}&device_catalog_id=eq.${deviceCatalogId}`);
      } else {
        // Add
        await supaPost('build_line_systems', {
          build_line_id: this.lineId,
          device_catalog_id: deviceCatalogId,
          is_default: true,
        });
      }
    } catch (e) {
      // Revert optimistic update on failure
      console.error('Toggle system failed:', e);
      if (wasSelected) this._selectedIds.add(deviceCatalogId);
      else this._selectedIds.delete(deviceCatalogId);
      this.renderSystems();
      alert('Failed to update systems: ' + e.message);
    }
  }
};

window.BuildLinesPage = BuildLinesPage;
window.BuildLineDetailPage = BuildLineDetailPage;