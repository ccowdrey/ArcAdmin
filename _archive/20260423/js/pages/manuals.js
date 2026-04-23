// ArcNode Admin — Company Manual Library
// ==========================================
// Manages the company-scoped device manual library. Each manual is tagged with
// a device from the shared device_catalog. When a client asks ArcInsight a
// question, the RAG pipeline pulls from these manuals (filtered by the client's
// declared systems) after checking vehicle-specific and build-line docs.
//
// Storage layout: van-manuals/<company_id>/company_manuals/<manual_id>/<sanitized_filename>

const ManualsLibrary = {
  companyId: null,
  companyName: '',
  manuals: [],
  catalog: [],           // device_catalog rows, loaded once per page view
  _uploading: false,
  _pendingFile: null,
  _pendingCompanyId: null,

  VERCEL_PROCESS_URL: 'https://arcnode-processor.vercel.app/api/process-pdf',

  // ── Load ──
  async loadForCompany(companyId, companyName) {
    this.companyId = companyId;
    this.companyName = companyName || '';

    const container = document.getElementById('manualsLibraryContainer');
    if (!container) return;

    container.innerHTML = '<div style="color:#8E8D8A;font-size:13px;padding:16px;text-align:center">Loading manual library...</div>';

    try {
      // Load catalog first — needed to render device names + for the upload modal dropdown.
      if (this.catalog.length === 0) {
        this.catalog = await supa(`device_catalog?is_active=eq.true&select=*&order=category.asc,device_name.asc`);
      }

      const manuals = await supa(
        `company_manuals?company_id=eq.${companyId}&select=*&order=uploaded_at.desc`
      );
      this.manuals = manuals;
      this.render();
    } catch (e) {
      console.error('Load manual library failed:', e);
      container.innerHTML = '<div style="color:#FF6565;font-size:13px;padding:16px">Failed to load manual library</div>';
    }
  },

  // ── Render ──
  render() {
    const container = document.getElementById('manualsLibraryContainer');
    if (!container) return;

    // Build a slug→device lookup (by id since manuals reference device_catalog_id)
    const deviceById = Object.fromEntries(this.catalog.map(d => [d.id, d]));

    // Count update
    const stat = document.getElementById('companyStatManuals');
    if (stat) stat.textContent = this.manuals.length;

    // Empty state
    if (this.manuals.length === 0) {
      container.innerHTML = `
        <div style="color:#666;font-size:13px;padding:16px;text-align:center">
          No manuals in library yet. Upload your first manual to power ArcInsight for this company's clients.
        </div>
        <div id="manualsUploadZone_${this.companyId}"></div>
      `;
      this.renderUploadZone();
      return;
    }

    // Group manuals by category for readability
    const byCategory = {};
    for (const m of this.manuals) {
      const device = deviceById[m.device_catalog_id];
      const cat = device?.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ manual: m, device });
    }

    const categoryOrder = ['climate','power','plumbing','lighting','entertainment','exterior','sensors','unknown'];
    const categoryLabels = {
      climate:'Climate', power:'Power', plumbing:'Plumbing', lighting:'Lighting',
      entertainment:'Entertainment', exterior:'Awning & Exterior', sensors:'Sensors',
      unknown: 'Other'
    };

    let html = '<div style="display:flex;flex-direction:column;gap:20px">';
    for (const cat of categoryOrder) {
      if (!byCategory[cat]) continue;
      html += `
        <div>
          <div style="color:#8E8D8A;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">${categoryLabels[cat]}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${byCategory[cat].map(({ manual, device }) => this.renderManualRow(manual, device)).join('')}
          </div>
        </div>
      `;
    }
    html += '</div>';
    html += `<div id="manualsUploadZone_${this.companyId}" style="margin-top:16px"></div>`;

    container.innerHTML = html;
    this.renderUploadZone();
  },

  renderManualRow(manual, device) {
    const statusColor = {
      pending:    '#8E8D8A',
      processing: '#767DFB',
      completed:  '#2ABC53',
      failed:     '#FF6565',
    }[manual.processing_status] || '#8E8D8A';
    const statusLabel = {
      pending:    'Queued',
      processing: 'Processing...',
      completed:  'Ready',
      failed:     'Failed',
    }[manual.processing_status] || manual.processing_status;

    const deviceName = device ? `${device.device_name}${device.manufacturer ? ` · ${device.manufacturer}` : ''}` : 'Unknown device';
    const size = manual.file_size ? this.formatSize(manual.file_size) : '';

    return `
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px">
        <div style="width:32px;height:32px;background:#767DFB15;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#767DFB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="color:#F5F1EB;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(manual.file_name)}</div>
          <div style="color:#8E8D8A;font-size:11px;margin-top:2px">${escHtml(deviceName)}${size ? ` · ${size}` : ''} · ${timeAgo(manual.uploaded_at)}</div>
          ${manual.error_message ? `<div style="color:#FF6565;font-size:11px;margin-top:4px">${escHtml(manual.error_message)}</div>` : ''}
        </div>
        <div style="font-size:11px;color:${statusColor};white-space:nowrap">${statusLabel}</div>
        <div style="display:flex;gap:4px">
          <a href="${escHtml(manual.file_url)}" target="_blank" class="btn-secondary" style="font-size:11px;padding:4px 10px;text-decoration:none">View</a>
          <button class="btn-delete" style="font-size:11px;padding:4px 10px" onclick="ManualsLibrary.remove('${manual.id}')">Delete</button>
        </div>
      </div>
    `;
  },

  renderUploadZone() {
    const zoneContainer = document.getElementById(`manualsUploadZone_${this.companyId}`);
    if (!zoneContainer) return;
    const zoneId = `manuals_${this.companyId}`;
    zoneContainer.innerHTML = `
      <div class="doc-upload-zone" id="docUploadZone_${zoneId}"
           ondragover="ManualsLibrary.handleDragOver(event)"
           ondragleave="ManualsLibrary.handleDragLeave(event)"
           ondrop="ManualsLibrary.handleDrop(event, '${this.companyId}')"
           onclick="document.getElementById('docFileInput_${zoneId}').click()">
        <input type="file" id="docFileInput_${zoneId}" accept=".pdf" style="display:none"
               onchange="ManualsLibrary.handleFileSelect(event, '${this.companyId}')">
        <div class="doc-upload-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#767DFB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/>
          </svg>
        </div>
        <div style="color:#F5F1EB;font-size:13px;font-weight:500">Add a manual to the library</div>
        <div style="color:#666;font-size:12px;margin-top:4px">Drop PDF here or click to browse · Max 50MB · PDF only</div>
      </div>
      <div id="docUploadProgress_${zoneId}" style="display:none"></div>
    `;
  },

  // ── Drag & Drop ──
  handleDragOver(e) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('doc-upload-zone-active'); },
  handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('doc-upload-zone-active'); },
  handleDrop(e, companyId) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('doc-upload-zone-active');
    if (e.dataTransfer.files.length > 0) this.startUpload(e.dataTransfer.files[0], companyId);
  },
  handleFileSelect(e, companyId) {
    if (e.target.files.length > 0) this.startUpload(e.target.files[0], companyId);
    e.target.value = '';
  },

  // ── Upload flow ──
  startUpload(file, companyId) {
    if (this._uploading) return;
    if (file.type !== 'application/pdf') { alert('Only PDF files are supported'); return; }
    if (file.size > 52428800) { alert('File is too large. Maximum size is 50MB.'); return; }

    this._pendingFile = file;
    this._pendingCompanyId = companyId;

    // Build device dropdown from catalog, grouped by category
    const categoryLabels = {
      climate:'Climate', power:'Power', plumbing:'Plumbing', lighting:'Lighting',
      entertainment:'Entertainment', exterior:'Awning & Exterior', sensors:'Sensors',
    };
    const byCat = {};
    for (const d of this.catalog) {
      if (!byCat[d.category]) byCat[d.category] = [];
      byCat[d.category].push(d);
    }
    const optionsHtml = Object.keys(categoryLabels)
      .filter(cat => byCat[cat]?.length)
      .map(cat => `
        <optgroup label="${categoryLabels[cat]}">
          ${byCat[cat].map(d => `<option value="${d.id}">${escHtml(d.device_name)}${d.manufacturer ? ` — ${escHtml(d.manufacturer)}` : ''}</option>`).join('')}
        </optgroup>
      `).join('');

    document.getElementById('manualUploadFileName').textContent = file.name;
    document.getElementById('manualUploadFileSize').textContent = this.formatSize(file.size);
    document.getElementById('manualUploadDevice').innerHTML = `<option value="">Select a device...</option>${optionsHtml}`;
    document.getElementById('manualUploadDesc').value = '';
    document.getElementById('manualUploadError').classList.add('hidden');
    openModal('manualUploadModal');
  },

  async confirmUpload() {
    if (this._uploading) return;

    const deviceCatalogId = document.getElementById('manualUploadDevice').value;
    const description = document.getElementById('manualUploadDesc').value.trim();
    const errEl = document.getElementById('manualUploadError');
    errEl.classList.add('hidden');

    if (!deviceCatalogId) {
      errEl.textContent = 'Select a device before uploading';
      errEl.classList.remove('hidden');
      return;
    }

    this._uploading = true;
    const file = this._pendingFile;
    const companyId = this._pendingCompanyId;
    closeModals();

    const zoneId = `manuals_${companyId}`;
    const progressEl = document.getElementById(`docUploadProgress_${zoneId}`);
    const uploadZone = document.getElementById(`docUploadZone_${zoneId}`);
    if (uploadZone) uploadZone.style.display = 'none';
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.innerHTML = `
        <div class="doc-upload-progress">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div class="ai-loading"><div class="spinner"></div></div>
            <span style="color:#F5F1EB;font-size:13px">Uploading ${escHtml(file.name)}...</span>
          </div>
          <div class="doc-progress-bar"><div class="doc-progress-fill" id="docProgressFill_${zoneId}"></div></div>
          <div style="color:#666;font-size:12px;margin-top:6px" id="docProgressText_${zoneId}">0%</div>
        </div>
      `;
    }

    try {
      // Step 1: Create company_manuals row first so we have a manual_id for the storage path.
      const uploaderEmail = document.getElementById('navEmail')?.textContent || 'unknown';
      const insertRes = await fetch(`${SUPA_URL}/rest/v1/company_manuals`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          company_id: companyId,
          device_catalog_id: deviceCatalogId,
          file_name: file.name,
          file_url: '',  // filled in after storage upload
          file_size: file.size,
          description: description || null,
          processing_status: 'pending',
          uploaded_by: uploaderEmail,
        }),
      });
      if (!insertRes.ok) throw new Error(`Manual record creation failed: ${await insertRes.text()}`);
      const inserted = await insertRes.json();
      const manualId = inserted[0]?.id;
      if (!manualId) throw new Error('No manual_id returned from insert');

      // Step 2: Upload file to storage. Sanitize filename for Supabase Storage ASCII key.
      const safeName = this.sanitizeFilename(file.name);
      const storagePath = `${companyId}/company_manuals/${manualId}/${Date.now()}_${safeName}`;
      const { url, error: uploadError } = await Storage.upload('van-manuals', storagePath, file, (pct) => {
        const fill = document.getElementById(`docProgressFill_${zoneId}`);
        const text = document.getElementById(`docProgressText_${zoneId}`);
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = pct + '%';
      });
      if (uploadError) {
        // Clean up the orphaned row so the UI doesn't show a broken entry.
        await supaDelete(`company_manuals?id=eq.${manualId}`);
        throw new Error(uploadError);
      }

      // Step 3: Update the row with the file_url now that it's known.
      // NOTE: URL uses the non-public path (/object/van-manuals/...) to match
      // the existing documents.js pattern. The van-manuals bucket is NOT public;
      // downloads authenticate via service role key. Using /public/... would 400.
      const fileUrl = `${SUPA_URL}/storage/v1/object/van-manuals/${storagePath}`;
      await supaPatch(`company_manuals?id=eq.${manualId}`, { file_url: fileUrl });

      // Step 4: Kick off Vercel → Edge Function processing pipeline.
      this.processViaVercel(manualId, companyId);

      // Step 5: Reload the library so the new row shows up.
      await this.loadForCompany(companyId, this.companyName);

    } catch (e) {
      console.error('Manual upload failed:', e);
      if (progressEl) {
        progressEl.innerHTML = `
          <div style="background:#FF656515;border:1px solid #FF656530;border-radius:8px;padding:12px;margin-bottom:12px">
            <div style="color:#FF6565;font-size:13px;font-weight:500">Upload failed</div>
            <div style="color:#FF6565;font-size:12px;margin-top:4px">${escHtml(e.message)}</div>
          </div>
        `;
      }
      if (uploadZone) uploadZone.style.display = '';
    } finally {
      this._uploading = false;
      this._pendingFile = null;
      this._pendingCompanyId = null;
    }
  },

  // ── Processing pipeline: Vercel extracts, Edge Function embeds + stores ──
  async processViaVercel(manualId, companyId) {
    try {
      console.log('🚀 Starting Vercel processing for company manual...');

      const extractRes = await fetch(this.VERCEL_PROCESS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: manualId,
          supabase_url: SUPA_URL,
          supabase_key: SUPA_KEY,
          scope: 'company_manual',
        }),
      });

      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Vercel error (${extractRes.status})`);
      }

      const { extracted_text, document_type, company_manual_id } = await extractRes.json();
      console.log(`📝 Extracted ${extracted_text.length} chars`);

      const embedRes = await fetch(`${SUPA_URL}/functions/v1/process-document`, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: manualId,
          company_manual_id: company_manual_id || manualId,
          document_type: document_type || 'manual',
          extracted_text: extracted_text,
        }),
      });

      if (!embedRes.ok) {
        const err = await embedRes.text();
        throw new Error(`Embed failed: ${err.slice(0, 200)}`);
      }

      const result = await embedRes.json();
      console.log(`✅ Company manual processed: ${result.chunk_count} chunks`);

      // Reload library to show 'completed' status
      if (this.companyId === companyId) await this.loadForCompany(companyId, this.companyName);

    } catch (e) {
      console.error('Processing failed:', e);
      try {
        await supaPatch(`company_manuals?id=eq.${manualId}`, {
          processing_status: 'failed',
          error_message: (e.message || 'Processing failed').slice(0, 500),
        });
      } catch (_) {}
      if (this.companyId === companyId) await this.loadForCompany(companyId, this.companyName);
    }
  },

  // ── Delete ──
  async remove(manualId) {
    if (!confirm('Delete this manual? This will also remove all AI-processed chunks from the library.')) return;

    try {
      // Get file_url before deletion so we can also clean up storage.
      const rows = await supa(`company_manuals?id=eq.${manualId}&select=file_url`);
      const manual = rows[0];

      // Delete DB row (cascades to document_chunks via FK).
      await supaDelete(`company_manuals?id=eq.${manualId}`);

      // Clean up storage — best effort, don't fail the whole flow.
      if (manual?.file_url) {
        const path = manual.file_url.split('/van-manuals/')[1];
        if (path) await Storage.remove('van-manuals', path);
      }

      await this.loadForCompany(this.companyId, this.companyName);
    } catch (e) {
      console.error('Delete manual failed:', e);
      alert('Failed to delete manual: ' + e.message);
    }
  },

  // ── Helpers ──
  sanitizeFilename(name) {
    // Strip accents, replace non-ASCII / whitespace / path chars with underscore.
    // Preserves file extension and keeps the key ASCII-clean for Supabase Storage.
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_+/g, '_');
  },

  formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  },
};

window.ManualsLibrary = ManualsLibrary;