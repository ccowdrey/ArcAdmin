// ArcAdmin — Build Lines Page
// ============================
// Manages build lines per company. Build lines are the builder's product line
// (e.g. Rossmonster's "Baja", "Havn"). Documents attached at this level are
// shared across all vehicles of that build line. The Systems picker declares
// the default device list, which a DB trigger copies into vehicle_systems on
// new vehicle insert.
//
// 2026-04-23 rewrite for new design. Key API changes:
//   - loadForCompany(companyId, name, containerEl) — renders INTO the given
//     element instead of a fixed DOM id. Used by CompaniesPage for its tab.
//   - loadDetail({companyId, buildLineId}) — entry for the build-line detail
//     page (routed as /companies/:companyId/builds/:buildLineId).
//   - openAddModal(companyId) — used by the company overflow menu.
//
// The Systems picker uses the new purple tokens; toggling is optimistic + writes
// to build_line_systems, which the DB trigger cascades into vehicle_systems.

const BuildLinesPage = {
  // ── List state ──
  companyId: null,
  companyName: '',
  buildLines: [],
  listContainer: null,

  // ── Detail state ──
  lineId: null,
  lineData: null,
  _catalog: [],
  _selectedIds: new Set(),

  // ═══════════════════════════════════════════════════════════════════════
  // LIST — rendered inside a company's Build Lines tab
  // ═══════════════════════════════════════════════════════════════════════

  async loadForCompany(companyId, companyName, containerEl) {
    console.log('[BuildLines] loadForCompany start', { companyId, companyName, hasContainer: !!containerEl });
    this.companyId = companyId;
    this.companyName = companyName || '';
    this.listContainer = containerEl || null;

    if (!this.listContainer) {
      console.warn('[BuildLines] No container provided — aborting render');
      return;
    }

    try {
      const lines = await supa(
        `build_lines?company_id=eq.${companyId}&is_active=eq.true&select=*&order=sort_order.asc,name.asc`
      );
      console.log(`[BuildLines] fetched ${lines.length} build lines for company ${companyId}`);
      this.buildLines = lines;
      this._renderList();
    } catch (e) {
      console.error('[BuildLines] Load failed:', e);
      if (this.listContainer) {
        this.listContainer.innerHTML = `<div class="data-empty">Failed to load build lines — ${escHtml(e.message || '')}</div>`;
      }
    }
  },

  _renderList() {
    const container = this.listContainer;
    if (!container) { console.warn('[BuildLines] _renderList: no container'); return; }

    try {
      const headerMarkup = `
      <div class="flex items-center justify-between" style="margin-bottom:20px">
        <div>
          <div class="t-section-title">Build Lines</div>
          <div class="t-muted t-detail">The product lineup builders offer. Clients pick one during onboarding.</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="BuildLinesPage.openAddModal('${escHtml(this.companyId)}')">+ Add Build Line</button>
      </div>
    `;

    if (this.buildLines.length === 0) {
      container.innerHTML = `
        ${headerMarkup}
        <div class="data-empty">No build lines yet. Click + Add Build Line to create your first model.</div>
      `;
      return;
    }

    const companySlug = Router.getSlug(this.companyId);
    const rows = this.buildLines.map((bl) => {
      Router.registerSlug(bl.id, bl.name);
      const blSlug = Router.getSlug(bl.id) || slugify(bl.name);
      const schematicPill = bl.schematic_url
        ? '<span class="badge badge--success">✓ Schematic</span>'
        : '<span class="badge badge--tier-base-camp">No schematic</span>';

      return `
        <div class="data-table-row" onclick="Router.navigate('/companies/${escHtml(companySlug)}/builds/${escHtml(blSlug)}')">
          <div class="data-table-cell data-table-cell--bold" style="flex:1 1 240px;min-width:180px">
            ${escHtml(bl.name)}
            ${bl.description ? `<div class="t-muted t-detail" style="font-weight:400;margin-top:2px">${escHtml(bl.description)}</div>` : ''}
          </div>
          <div class="data-table-cell t-muted" style="width:160px">${escHtml([bl.default_year, bl.default_make].filter(Boolean).join(' ') || '—')}</div>
          <div class="data-table-cell t-muted" style="width:140px">${escHtml(bl.default_model || '—')}</div>
          <div class="data-table-cell" style="width:140px">${schematicPill}</div>
          <div class="data-table-cell t-muted" style="flex:1;text-align:right">${escHtml(timeAgo(bl.created_at))}</div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      ${headerMarkup}
      <div class="data-table">
        <div class="data-table-headers">
          <div class="data-table-header" style="flex:1 1 240px;min-width:180px">Name</div>
          <div class="data-table-header" style="width:160px">Year / Make</div>
          <div class="data-table-header" style="width:140px">Model</div>
          <div class="data-table-header" style="width:140px">Schematic</div>
          <div class="data-table-header" style="flex:1;text-align:right">Created</div>
        </div>
        ${rows}
      </div>
    `;
    } catch (e) {
      console.error('[BuildLines] _renderList threw:', e);
      container.innerHTML = `<div class="data-empty">Error rendering build lines — ${escHtml(e.message || '')}. Check console.</div>`;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ADD / EDIT MODAL
  // ═══════════════════════════════════════════════════════════════════════

  openAddModal(companyId) {
    if (companyId) this.companyId = companyId;
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

  openEditModal(lineId) {
    const bl = this.buildLines.find((l) => l.id === lineId);
    if (!bl) return;
    document.getElementById('buildLineModalTitle').textContent = 'Edit Build Line';
    document.getElementById('buildLineId').value = bl.id;
    document.getElementById('buildLineName').value = bl.name || '';
    document.getElementById('buildLineDesc').value = bl.description || '';
    document.getElementById('buildLineMake').value = bl.default_make || '';
    document.getElementById('buildLineModel').value = bl.default_model || '';
    document.getElementById('buildLineYear').value = bl.default_year || '';
    document.getElementById('buildLineSortOrder').value = bl.sort_order ?? 0;
    document.getElementById('buildLineError').classList.add('hidden');
    document.getElementById('buildLineSaveBtn').textContent = 'Save Changes';
    openModal('buildLineModal');
  },

  async saveLine() {
    const id = document.getElementById('buildLineId').value;
    const name = document.getElementById('buildLineName').value.trim();
    const description = document.getElementById('buildLineDesc').value.trim();
    const defaultMake = document.getElementById('buildLineMake').value.trim();
    const defaultModel = document.getElementById('buildLineModel').value.trim();
    const defaultYear = document.getElementById('buildLineYear').value.trim();
    const sortOrder = parseInt(document.getElementById('buildLineSortOrder').value, 10) || 0;
    const errEl = document.getElementById('buildLineError');
    errEl.classList.add('hidden');

    if (!name) {
      errEl.textContent = 'Build line name is required.';
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
      is_active: true,
    };

    try {
      if (id) {
        await supaPatch(`build_lines?id=eq.${id}`, data);
      } else {
        await supaPost('build_lines', data);
      }
      closeModals();
      await this.loadForCompany(this.companyId, this.companyName, this.listContainer);
    } catch (e) {
      errEl.textContent = e.message || 'Failed to save build line.';
      errEl.classList.remove('hidden');
    }
  },

  async deleteLine(lineId, name) {
    if (!confirm(`Delete build line "${name}"? Existing vehicles stay intact, but new vehicles won't be able to select this build.`)) return;
    try {
      await supaPatch(`build_lines?id=eq.${lineId}`, { is_active: false });
      await this.loadForCompany(this.companyId, this.companyName, this.listContainer);
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DETAIL PAGE
  // ═══════════════════════════════════════════════════════════════════════

  async loadDetail({ companyId, buildLineId }) {
    this.companyId = companyId;
    this.lineId = buildLineId;
    this._catalog = []; // reset cache between views
    this._selectedIds = new Set();

    const nameEl = document.getElementById('buildLineDetailName');
    const companyEl = document.getElementById('buildLineDetailCompany');
    const bcEl = document.getElementById('buildLineBreadcrumb');
    const infoEl = document.getElementById('buildLineDetailInfo');
    const systemsEl = document.getElementById('buildLineSystemsContainer');
    const docsEl = document.getElementById('buildLineDocsContainer');

    if (nameEl) nameEl.textContent = 'Loading...';
    if (infoEl) infoEl.innerHTML = '<div class="t-muted">Loading...</div>';
    if (systemsEl) systemsEl.innerHTML = '<div class="t-muted">Loading...</div>';
    if (docsEl) docsEl.innerHTML = '<div class="t-muted">Loading...</div>';

    try {
      const lines = await supa(`build_lines?id=eq.${buildLineId}&select=*`);
      if (!lines.length) {
        if (nameEl) nameEl.textContent = 'Build line not found';
        return;
      }
      this.lineData = lines[0];

      // Company context for breadcrumb / subtitle
      let companyName = '';
      try {
        const companies = await supa(`companies?id=eq.${companyId}&select=name`);
        companyName = companies[0]?.name || '';
      } catch (_) {}

      Router.registerSlug(companyId, companyName);
      Router.registerSlug(buildLineId, this.lineData.name);

      if (nameEl) nameEl.textContent = this.lineData.name;
      if (companyEl) companyEl.textContent = companyName || '';
      if (bcEl) bcEl.textContent = companyName || 'Back';

      // Info card
      if (infoEl) {
        infoEl.innerHTML = `
          <div class="flex flex-col gap-2">
            ${this._infoRow('Default make', escHtml(this.lineData.default_make || '—'))}
            ${this._infoRow('Default model', escHtml(this.lineData.default_model || '—'))}
            ${this._infoRow('Default year', escHtml(this.lineData.default_year || '—'))}
            ${this._infoRow('Description', escHtml(this.lineData.description || '—'))}
            ${this._infoRow('Created', escHtml(formatDateTime(this.lineData.created_at)))}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="BuildLinesPage.openEditModal('${escHtml(buildLineId)}')">Edit details</button>
            <button class="btn btn-ghost btn-sm t-danger" onclick="BuildLinesPage.deleteLine('${escHtml(buildLineId)}','${escHtml(this.lineData.name)}')">Delete build line</button>
          </div>
        `;
      }

      // Schematic section
      this._renderSchematic();

      // Systems picker
      await this.loadSystems();

      // Docs (delegate to Documents module if available)
      if (window.Documents && typeof Documents.loadForBuildLine === 'function') {
        Documents.loadForBuildLine(buildLineId, companyId, docsEl);
      } else if (docsEl) {
        docsEl.innerHTML = '<div class="t-muted">Documents module not loaded.</div>';
      }

      // For editing from detail → modal, we need buildLines cached
      if (this.buildLines.length === 0) {
        try {
          const all = await supa(`build_lines?company_id=eq.${companyId}&is_active=eq.true&select=*`);
          this.buildLines = all;
        } catch (_) {}
      }
    } catch (e) {
      console.error('Load build line detail failed:', e);
      if (nameEl) nameEl.textContent = 'Failed to load';
      if (infoEl) infoEl.innerHTML = `<div class="t-danger">${escHtml(e.message || '')}</div>`;
    }
  },

  _infoRow(label, value) {
    return `
      <div style="display:flex;align-items:center;gap:16px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
        <div class="t-muted t-detail" style="width:150px;flex-shrink:0">${escHtml(label)}</div>
        <div class="t-body" style="flex:1">${value || '—'}</div>
      </div>
    `;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SCHEMATIC
  // ═══════════════════════════════════════════════════════════════════════

  _renderSchematic() {
    const container = document.getElementById('buildLineSchematicSection');
    if (!container) return;

    if (this.lineData.schematic_url) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <img src="${escHtml(this.lineData.schematic_url)}"
               style="max-width:260px;max-height:160px;border-radius:8px;border:1px solid var(--border-default);background:var(--bg-muted)"
               onerror="this.style.display='none'">
          <div style="flex:1;min-width:200px">
            <div class="t-body">Uploaded</div>
            <div class="t-muted t-detail">This image overlays the Lights tab in ArcNode for every vehicle of this build.</div>
          </div>
          <div style="display:flex;gap:8px">
            <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin:0">
              Replace
              <input type="file" accept="image/*" style="display:none" onchange="BuildLinesPage.uploadSchematic(this.files[0])">
            </label>
            <button class="btn btn-ghost btn-sm t-danger" onclick="BuildLinesPage.removeSchematic()">Remove</button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <label style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px;border:2px dashed var(--border-default);border-radius:8px;cursor:pointer;background:var(--bg-muted)"
               onmouseover="this.style.borderColor='var(--brand-primary)'"
               onmouseout="this.style.borderColor='var(--border-default)'">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-secondary)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div class="t-body">Upload aerial schematic</div>
          <div class="t-muted t-detail">PNG, JPG, or SVG. Shown behind the Lights control layer in every vehicle of this build.</div>
          <input type="file" accept="image/*" style="display:none" onchange="BuildLinesPage.uploadSchematic(this.files[0])">
        </label>
      `;
    }
  },

  async uploadSchematic(file) {
    if (!file) return;
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `schematics/${this.lineId}.${ext}`;

      const uploadRes = await fetch(`${SUPA_URL}/storage/v1/object/van-manuals/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'image/png',
          'x-upsert': 'true',
        },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());

      const publicUrl = `${SUPA_URL}/storage/v1/object/public/van-manuals/${path}`;
      await supaPatch(`build_lines?id=eq.${this.lineId}`, { schematic_url: publicUrl });

      this.lineData.schematic_url = publicUrl;
      this._renderSchematic();
    } catch (e) {
      alert(`Schematic upload failed: ${e.message}`);
    }
  },

  async removeSchematic() {
    if (!confirm('Remove the schematic for this build line?')) return;
    try {
      await supaPatch(`build_lines?id=eq.${this.lineId}`, { schematic_url: null });
      this.lineData.schematic_url = null;
      this._renderSchematic();
    } catch (e) {
      alert(`Remove failed: ${e.message}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SYSTEMS PICKER (Phase 1c) — restyled to new tokens
  // ═══════════════════════════════════════════════════════════════════════

  async loadSystems() {
    const container = document.getElementById('buildLineSystemsContainer');
    if (!container) return;

    try {
      const catalogPromise = this._catalog.length
        ? Promise.resolve(this._catalog)
        : supa(`device_catalog?is_active=eq.true&select=*&order=category.asc,device_name.asc`);
      const selectedPromise = supa(`build_line_systems?build_line_id=eq.${this.lineId}&select=device_catalog_id`);

      const [catalog, selected] = await Promise.all([catalogPromise, selectedPromise]);
      this._catalog = catalog;
      this._selectedIds = new Set(selected.map((r) => r.device_catalog_id));
      this._renderSystems();
    } catch (e) {
      console.error('Load systems failed:', e);
      container.innerHTML = `<div class="t-danger t-detail" style="padding:16px">Failed to load systems: ${escHtml(e.message || '')}</div>`;
    }
  },

  _renderSystems() {
    const container = document.getElementById('buildLineSystemsContainer');
    if (!container) return;

    const byCat = {};
    for (const d of this._catalog) {
      if (!byCat[d.category]) byCat[d.category] = [];
      byCat[d.category].push(d);
    }

    const categoryOrder = ['climate', 'power', 'plumbing', 'lighting', 'entertainment', 'exterior', 'sensors'];
    const categoryLabels = {
      climate: 'Climate', power: 'Power', plumbing: 'Plumbing', lighting: 'Lighting',
      entertainment: 'Entertainment', exterior: 'Awning & Exterior', sensors: 'Sensors',
    };

    const selectedCount = this._selectedIds.size;
    let html = `<div class="t-muted t-detail" style="margin-bottom:20px">${selectedCount} ${selectedCount === 1 ? 'device' : 'devices'} selected</div>`;
    html += '<div style="display:flex;flex-direction:column;gap:24px">';

    for (const cat of categoryOrder) {
      if (!byCat[cat]?.length) continue;
      html += `
        <div>
          <div class="section-label" style="margin-bottom:10px">${categoryLabels[cat]}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">
            ${byCat[cat].map((d) => this._renderSystemCheckbox(d)).join('')}
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;
  },

  _renderSystemCheckbox(device) {
    const checked = this._selectedIds.has(device.id);
    const cardBg = checked ? 'var(--brand-primary-10)' : 'var(--bg-muted)';
    const cardBorder = checked ? 'var(--brand-primary)' : 'var(--border-default)';
    const boxBg = checked ? 'var(--brand-primary)' : 'transparent';
    const boxBorder = checked ? 'var(--brand-primary)' : 'var(--text-muted)';
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${cardBg};border:1px solid ${cardBorder};border-radius:8px;cursor:pointer;transition:all 0.12s"
             onclick="BuildLinesPage.toggleSystem('${escHtml(device.id)}', event)">
        <div style="width:18px;height:18px;border-radius:4px;border:1.5px solid ${boxBorder};background:${boxBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.12s">
          ${checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1B1B1B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
        <div style="flex:1;min-width:0">
          <div class="t-body" style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(device.device_name)}</div>
          ${device.manufacturer ? `<div class="t-muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(device.manufacturer)}</div>` : ''}
        </div>
      </label>
    `;
  },

  async toggleSystem(deviceCatalogId, event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }

    const wasSelected = this._selectedIds.has(deviceCatalogId);

    if (wasSelected) this._selectedIds.delete(deviceCatalogId);
    else this._selectedIds.add(deviceCatalogId);
    this._renderSystems();

    try {
      if (wasSelected) {
        await supaDelete(`build_line_systems?build_line_id=eq.${this.lineId}&device_catalog_id=eq.${deviceCatalogId}`);
      } else {
        await supaPost('build_line_systems', {
          build_line_id: this.lineId,
          device_catalog_id: deviceCatalogId,
          is_default: true,
        });
      }
    } catch (e) {
      console.error('Toggle system failed:', e);
      if (wasSelected) this._selectedIds.add(deviceCatalogId);
      else this._selectedIds.delete(deviceCatalogId);
      this._renderSystems();
      alert(`Failed to update systems: ${e.message}`);
    }
  },
};

window.BuildLinesPage = BuildLinesPage;
window.BuildLineDetailPage = BuildLinesPage;