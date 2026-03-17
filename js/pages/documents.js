// ArcNode Admin — Vehicle Documents Management
// ================================================

const Documents = {
  // Track uploads in progress
  _uploading: false,

  /**
   * Render the documents card for a vehicle within a company
   * @param {string} vehicleId - Vehicle UUID
   * @param {string} companyId - Company UUID
   * @param {string} containerEl - DOM element to render into
   */
  async loadForVehicle(vehicleId, companyId, containerEl) {
    if (!vehicleId || !companyId) {
      containerEl.innerHTML = '<div style="color:#444;font-size:13px;padding:16px;text-align:center">No vehicle assigned — documents require a vehicle</div>';
      return;
    }

    containerEl.innerHTML = '<div style="color:#8E8D8A;font-size:13px;padding:16px;text-align:center">Loading documents...</div>';

    try {
      const docs = await supa(`vehicle_documents?vehicle_id=eq.${vehicleId}&company_id=eq.${companyId}&select=*&order=uploaded_at.desc`);
      this.render(docs, vehicleId, companyId, containerEl);
    } catch (e) {
      console.error("Load documents failed:", e);
      containerEl.innerHTML = '<div style="color:#FF6565;font-size:13px;padding:16px">Failed to load documents</div>';
    }
  },

  render(docs, vehicleId, companyId, containerEl) {
    const statusColors = {
      pending: { bg: '#E7B40020', color: '#E7B400', label: 'Pending' },
      processing: { bg: '#4A9FD920', color: '#4A9FD9', label: 'Processing' },
      ready: { bg: '#2ABC5320', color: '#2ABC53', label: 'Ready' },
      failed: { bg: '#FF656520', color: '#FF6565', label: 'Failed' }
    };

    const typeLabels = {
      manual: 'Manual',
      wiring: 'Wiring Diagram',
      appliance: 'Appliance Spec',
      warranty: 'Warranty',
      other: 'Other'
    };

    const fileList = docs.length > 0 ? `
      <div class="table-wrap" style="border:none;margin-bottom:16px">
        <table>
          <thead><tr>
            <th>Document</th>
            <th>Type</th>
            <th>Size</th>
            <th>AI Status</th>
            <th>Chunks</th>
            <th>Uploaded</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${docs.map(d => {
              const st = statusColors[d.processing_status] || statusColors.pending;
              return `<tr style="cursor:default" onclick="event.stopPropagation()">
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;background:#FF656515;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                      <span style="font-size:11px;font-weight:700;color:#FF6565">PDF</span>
                    </div>
                    <div>
                      <div style="color:#F5F1EB;font-size:13px;font-weight:500">${escHtml(d.file_name)}</div>
                      ${d.description ? `<div style="color:#666;font-size:11px">${escHtml(d.description)}</div>` : ''}
                    </div>
                  </div>
                </td>
                <td><span style="color:#8E8D8A;font-size:12px">${typeLabels[d.document_type] || d.document_type}</span></td>
                <td style="color:#666;font-size:12px">${this.formatSize(d.file_size)}</td>
                <td>
                  <span style="background:${st.bg};color:${st.color};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600${d.processing_status === 'processing' ? ';animation:pulse 1.5s ease-in-out infinite' : ''}">
                    ${st.label}
                  </span>
                  ${d.error_message ? `<div style="color:#FF6565;font-size:10px;margin-top:2px">${escHtml(d.error_message)}</div>` : ''}
                </td>
                <td style="color:#666;font-size:12px">${d.chunk_count || '—'}</td>
                <td style="color:#666;font-size:12px">${timeAgo(d.uploaded_at)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="Documents.preview('${d.id}','${d.file_url}')">View</button>
                    <button class="btn-delete" style="font-size:11px;padding:4px 10px" onclick="Documents.remove('${d.id}','${vehicleId}','${companyId}')">Delete</button>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    ` : '';

    containerEl.innerHTML = `
      ${fileList}
      <div class="doc-upload-zone" id="docUploadZone_${vehicleId}"
           ondragover="Documents.handleDragOver(event)"
           ondragleave="Documents.handleDragLeave(event)"
           ondrop="Documents.handleDrop(event, '${vehicleId}', '${companyId}')"
           onclick="document.getElementById('docFileInput_${vehicleId}').click()">
        <input type="file" id="docFileInput_${vehicleId}" accept=".pdf" style="display:none"
               onchange="Documents.handleFileSelect(event, '${vehicleId}', '${companyId}')">
        <div class="doc-upload-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E7B400" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/>
          </svg>
        </div>
        <div style="color:#F5F1EB;font-size:13px;font-weight:500">Drop PDF here or click to browse</div>
        <div style="color:#666;font-size:12px;margin-top:4px">Max 50MB · PDF files only</div>
      </div>
      <div id="docUploadProgress_${vehicleId}" style="display:none"></div>
    `;
  },

  // ── Drag & Drop Handlers ──

  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('doc-upload-zone-active');
  },

  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('doc-upload-zone-active');
  },

  handleDrop(e, vehicleId, companyId) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('doc-upload-zone-active');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      this.startUpload(files[0], vehicleId, companyId);
    }
  },

  handleFileSelect(e, vehicleId, companyId) {
    const files = e.target.files;
    if (files.length > 0) {
      this.startUpload(files[0], vehicleId, companyId);
    }
    e.target.value = ''; // Reset so same file can be re-selected
  },

  // ── Upload Flow ──

  async startUpload(file, vehicleId, companyId) {
    if (this._uploading) return;

    // Validate
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are supported');
      return;
    }
    if (file.size > 52428800) {
      alert('File is too large. Maximum size is 50MB.');
      return;
    }

    // Show type picker modal
    this._pendingFile = file;
    this._pendingVehicleId = vehicleId;
    this._pendingCompanyId = companyId;
    document.getElementById('docUploadFileName').textContent = file.name;
    document.getElementById('docUploadFileSize').textContent = this.formatSize(file.size);
    document.getElementById('docUploadType').value = 'manual';
    document.getElementById('docUploadDesc').value = '';
    document.getElementById('docUploadError').classList.add('hidden');
    openModal('docUploadModal');
  },

  async confirmUpload() {
    if (this._uploading) return;
    this._uploading = true;

    const file = this._pendingFile;
    const vehicleId = this._pendingVehicleId;
    const companyId = this._pendingCompanyId;
    const docType = document.getElementById('docUploadType').value;
    const description = document.getElementById('docUploadDesc').value.trim();
    const errEl = document.getElementById('docUploadError');
    errEl.classList.add('hidden');

    closeModals();

    // Show progress
    const progressEl = document.getElementById(`docUploadProgress_${vehicleId}`);
    const uploadZone = document.getElementById(`docUploadZone_${vehicleId}`);
    if (uploadZone) uploadZone.style.display = 'none';
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.innerHTML = `
        <div class="doc-upload-progress">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div class="ai-loading"><div class="spinner"></div></div>
            <span style="color:#F5F1EB;font-size:13px">Uploading ${escHtml(file.name)}...</span>
          </div>
          <div class="doc-progress-bar"><div class="doc-progress-fill" id="docProgressFill_${vehicleId}"></div></div>
          <div style="color:#666;font-size:12px;margin-top:6px" id="docProgressText_${vehicleId}">0%</div>
        </div>
      `;
    }

    try {
      // 1. Upload file to storage
      const storagePath = `${companyId}/${vehicleId}/${Date.now()}_${file.name}`;
      const { url, error: uploadError } = await Storage.upload('van-manuals', storagePath, file, (pct) => {
        const fill = document.getElementById(`docProgressFill_${vehicleId}`);
        const text = document.getElementById(`docProgressText_${vehicleId}`);
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = pct + '%';
      });

      if (uploadError) throw new Error(uploadError);

      // 2. Insert record into vehicle_documents (with return=representation to get the ID)
      const uploaderEmail = document.getElementById('navEmail')?.textContent || 'unknown';

      const insertRes = await fetch(`${SUPA_URL}/rest/v1/vehicle_documents`, {
        method: "POST",
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          company_id: companyId,
          document_type: docType,
          file_name: file.name,
          file_url: `${SUPA_URL}/storage/v1/object/van-manuals/${storagePath}`,
          file_size: file.size,
          uploaded_by: uploaderEmail,
          processing_status: 'pending',
          description: description || null
        })
      });

      if (!insertRes.ok) {
        const errText = await insertRes.text();
        throw new Error(errText);
      }

      const insertedDocs = await insertRes.json();
      const documentId = insertedDocs[0]?.id;

      // 3. Orchestrate multi-step AI processing
      if (documentId) {
        this.processDocument(documentId, vehicleId, companyId, docType);
      }

      // 4. Reload documents list (shows "Processing" status immediately)
      const container = progressEl?.parentElement;
      if (container) {
        await this.loadForVehicle(vehicleId, companyId, container);
      }

    } catch (e) {
      console.error("Upload failed:", e);
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
    }
  },

  // ── Actions ──

  async remove(docId, vehicleId, companyId) {
    if (!confirm('Delete this document? This will also remove all AI-processed chunks.')) return;

    try {
      // Get the file URL to delete from storage
      const docs = await supa(`vehicle_documents?id=eq.${docId}&select=file_url`);
      const doc = docs[0];

      // Delete from database (cascades to document_chunks)
      await supaDelete(`vehicle_documents?id=eq.${docId}`);

      // Delete from storage
      if (doc?.file_url) {
        const path = doc.file_url.split('/van-manuals/')[1];
        if (path) await Storage.remove('van-manuals', path);
      }

      // Reload
      const container = document.getElementById(`docsContainer_${vehicleId}`);
      if (container) {
        await this.loadForVehicle(vehicleId, companyId, container);
      }
    } catch (e) {
      console.error("Delete document failed:", e);
      alert("Failed to delete document: " + e.message);
    }
  },

  async preview(docId, fileUrl) {
    // Open a signed URL for viewing
    const path = fileUrl.split('/van-manuals/')[1];
    if (path) {
      const { url, error } = await Storage.getSignedUrl('van-manuals', path);
      if (url) {
        window.open(url, '_blank');
      } else {
        alert("Could not generate preview URL: " + (error || 'Unknown error'));
      }
    }
  },

  // ── Utilities ──

  formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  },

  /**
   * Get document count for a vehicle (for badge display in client rows)
   */
  async getCount(vehicleId) {
    try {
      const docs = await supa(`vehicle_documents?vehicle_id=eq.${vehicleId}&select=id`);
      return docs.length;
    } catch (e) {
      return 0;
    }
  },

  // ── Multi-step AI Processing ──
  // Orchestrates: start → extract(pages 1-10) → extract(11-20) → ... → embed → cleanup

  async processDocument(documentId, vehicleId, companyId, docType) {
    const PAGE_BATCH = 10;
    const fnUrl = `${SUPA_URL}/functions/v1/process-document`;

    try {
      console.log(`🚀 Starting processing for ${documentId}`);

      // Step 1: Upload PDF to Anthropic, get page count
      const startRes = await this.callProcessFn({ action: "start", document_id: documentId });
      if (!startRes.file_id) throw new Error(startRes.error || "Start failed");

      const { file_id, total_pages, vehicle_id: vId } = startRes;
      console.log(`📄 ${total_pages} pages, file_id: ${file_id}`);

      // Step 2: Extract text in batches of PAGE_BATCH pages
      let allText = "";
      for (let page = 1; page <= total_pages; page += PAGE_BATCH) {
        const endPage = Math.min(page + PAGE_BATCH - 1, total_pages);
        console.log(`📖 Extracting pages ${page}-${endPage}...`);

        const extractRes = await this.callProcessFn({
          action: "extract",
          document_id: documentId,
          file_id,
          start_page: page,
          end_page: endPage,
          document_type: docType,
        });

        if (extractRes.text) {
          allText += (allText ? "\n\n" : "") + extractRes.text;
          console.log(`✅ Pages ${page}-${endPage}: ${extractRes.chars} chars`);
        } else {
          console.warn(`⚠️ No text from pages ${page}-${endPage}`);
        }
      }

      if (allText.trim().length < 50) {
        throw new Error("Could not extract meaningful text from PDF");
      }

      console.log(`📝 Total extracted: ${allText.length} chars`);

      // Step 3: Chunk + embed + store
      console.log("🧠 Embedding and storing...");
      const embedRes = await this.callProcessFn({
        action: "embed",
        document_id: documentId,
        all_text: allText,
        vehicle_id: vId || vehicleId,
        document_type: docType,
      });

      console.log(`✅ Processing complete: ${embedRes.chunk_count} chunks`);

      // Step 4: Cleanup Anthropic file
      await this.callProcessFn({ action: "cleanup", file_id });

      // Reload docs list to show "Ready" status
      const container = document.getElementById(`docsContainer_${vehicleId}`);
      if (container) this.loadForVehicle(vehicleId, companyId, container);

    } catch (e) {
      console.error("Processing failed:", e);
      // Mark as failed in DB
      try {
        await supaPatch(`vehicle_documents?id=eq.${documentId}`, {
          processing_status: 'failed',
          error_message: e.message || 'Processing failed'
        });
      } catch (_) {}
      // Reload to show failed status
      const container = document.getElementById(`docsContainer_${vehicleId}`);
      if (container) this.loadForVehicle(vehicleId, companyId, container);
    }
  },

  async callProcessFn(body) {
    const res = await fetch(`${SUPA_URL}/functions/v1/process-document`, {
      method: "POST",
      headers: {
        apikey: SUPA_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      let errMsg;
      try { errMsg = JSON.parse(errText).error; } catch(_) { errMsg = errText; }
      throw new Error(errMsg || `Edge Function error (${res.status})`);
    }
    return res.json();
  }
};

window.Documents = Documents;
