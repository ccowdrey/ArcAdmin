// ArcAdmin — BOM Builder (super admin)
// =====================================
// Build a bill-of-materials estimate for a prospective customer from the
// Stripe product catalog, tweak prices per client, and export a branded PDF.
//
// Catalog comes from the `stripe-catalog` edge function (Stripe key stays
// server-side). The draft quote autosaves to localStorage so a reload doesn't
// lose work; it isn't written to Supabase. PDF export lazy-loads jsPDF.

const BOM_DRAFT_KEY = 'arcadmin_bom_draft';
const BOM_JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const BOM_AUTOTABLE_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
const BOM_BRAND_RGB = [118, 125, 251];   // --brand-primary #767DFB
const BOM_DARK_RGB = [56, 56, 60];       // --text-dark #38383C
const BOM_MUTED_RGB = [96, 96, 96];      // --text-secondary #606060

const BomPage = {
  catalog: [],
  catalogError: null,
  quote: null,
  lines: [],

  async load() {
    this._restoreDraft();
    this.render();
    if (this.catalog.length === 0) await this.loadCatalog();
  },

  // ── Catalog ──

  async loadCatalog(btn) {
    const run = async () => {
      this.catalogError = null;
      this._renderPicker('Loading Stripe catalog...');
      try {
        const res = await withAuthRetry(() => fetch(`${SUPA_URL}/functions/v1/stripe-catalog`, {
          method: 'POST',
          headers: {
            apikey: SUPA_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Catalog request failed (${res.status})`);
        this.catalog = data.items || [];
      } catch (e) {
        console.error('[BOM] catalog load failed:', e);
        this.catalogError = e.message || 'Failed to load catalog';
      }
      this._renderPicker();
    };
    return btn ? withBtnLoading(btn, run) : run();
  },

  _priceLabel(item) {
    const amount = item.unit_amount == null ? 'custom price' : this._money(item.unit_amount, item.currency);
    const name = item.nickname ? `${item.name} (${item.nickname})` : item.name;
    return `${name} — ${amount}${this._intervalSuffix(item)}`;
  },

  _intervalSuffix(item) {
    if (!item.interval) return '';
    return item.interval_count > 1 ? ` / ${item.interval_count} ${item.interval}s` : ` / ${item.interval}`;
  },

  // ── Draft state ──

  _newQuote() {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      number: `ARC-${ymd}-${suffix}`,
      date: localDate(now),
      validDays: 30,
      customerName: '',
      customerCompany: '',
      customerEmail: '',
      preparedBy: [Auth._userName, Auth._userEmail].filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i).join(' · '),
      notes: '',
      discountPct: 0,
      taxPct: 0,
      shippingCents: 0,
    };
  },

  _restoreDraft() {
    if (this.quote) return;
    try {
      const saved = JSON.parse(localStorage.getItem(BOM_DRAFT_KEY) || 'null');
      if (saved && saved.quote) {
        this.quote = { ...this._newQuote(), ...saved.quote };
        this.lines = Array.isArray(saved.lines) ? saved.lines : [];
        return;
      }
    } catch (e) { /* fall through to a fresh quote */ }
    this.quote = this._newQuote();
    this.lines = [];
  },

  _saveDraft() {
    try {
      localStorage.setItem(BOM_DRAFT_KEY, JSON.stringify({ quote: this.quote, lines: this.lines }));
    } catch (e) { /* storage unavailable — draft just won't persist */ }
  },

  newQuote() {
    if (this.lines.length > 0 && !confirm('Start a new estimate? The current sheet will be cleared.')) return;
    this.quote = this._newQuote();
    this.lines = [];
    this._saveDraft();
    this.render();
  },

  // ── Line items ──

  addSelected() {
    const select = document.getElementById('bomProductSelect');
    const qtyEl = document.getElementById('bomAddQty');
    const item = this.catalog.find((c) => c.price_id === select?.value);
    if (!item) { showToast('Pick a product first', 'error'); return; }
    const qty = Math.max(0, parseFloat(qtyEl?.value) || 1);

    // Same Stripe price already on the sheet → bump its quantity.
    const existing = this.lines.find((l) => l.priceId === item.price_id);
    if (existing) {
      existing.qty += qty;
    } else {
      this.lines.push({
        id: this._lineId(),
        priceId: item.price_id,
        name: item.nickname ? `${item.name} (${item.nickname})` : item.name,
        description: item.description || '',
        sku: item.sku || '',
        qty,
        unitCents: item.unit_amount || 0,
        listCents: item.unit_amount,
        currency: item.currency || 'usd',
        interval: item.interval,
        intervalCount: item.interval_count || 1,
      });
    }
    if (qtyEl) qtyEl.value = 1;
    this._saveDraft();
    this._renderLines();
  },

  addCustom() {
    this.lines.push({
      id: this._lineId(),
      priceId: null,
      name: '',
      description: '',
      sku: '',
      qty: 1,
      unitCents: 0,
      listCents: null,
      currency: this._currency(),
      interval: null,
      intervalCount: 1,
    });
    this._saveDraft();
    this._renderLines();
    const inputs = document.querySelectorAll('#bomLines .bom-line-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  },

  removeLine(id) {
    this.lines = this.lines.filter((l) => l.id !== id);
    this._saveDraft();
    this._renderLines();
  },

  moveLine(id, dir) {
    const i = this.lines.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.lines.length) return;
    [this.lines[i], this.lines[j]] = [this.lines[j], this.lines[i]];
    this._saveDraft();
    this._renderLines();
  },

  resetPrice(id) {
    const line = this.lines.find((l) => l.id === id);
    if (!line || line.listCents == null) return;
    line.unitCents = line.listCents;
    this._saveDraft();
    this._renderLines();
  },

  // Text/number edits update state in place and refresh only computed cells,
  // so the input being typed into keeps focus.
  updateLine(id, field, value) {
    const line = this.lines.find((l) => l.id === id);
    if (!line) return;
    if (field === 'qty') line.qty = Math.max(0, parseFloat(value) || 0);
    else if (field === 'unit') line.unitCents = this._toCents(value);
    else line[field] = value;
    this._saveDraft();

    const totalEl = document.getElementById(`bomLineTotal-${id}`);
    if (totalEl) totalEl.textContent = this._money(this._lineTotal(line), line.currency) + this._lineIntervalLabel(line);
    const hintEl = document.getElementById(`bomLineHint-${id}`);
    if (hintEl) hintEl.innerHTML = this._priceHint(line);
    this._renderTotals();
  },

  updateQuote(field, value) {
    if (field === 'discountPct' || field === 'taxPct') this.quote[field] = Math.max(0, parseFloat(value) || 0);
    else if (field === 'shippingCents') this.quote[field] = this._toCents(value);
    else if (field === 'validDays') this.quote[field] = Math.max(0, parseInt(value, 10) || 0);
    else this.quote[field] = value;
    this._saveDraft();
    this._renderTotals();
  },

  // ── Math ──

  _lineTotal(line) { return Math.round(line.qty * line.unitCents); },

  _totals() {
    const oneTime = this.lines.filter((l) => !l.interval);
    const subtotal = oneTime.reduce((s, l) => s + this._lineTotal(l), 0);
    const discount = Math.round(subtotal * (this.quote.discountPct || 0) / 100);
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * (this.quote.taxPct || 0) / 100);
    const shipping = this.quote.shippingCents || 0;

    // Recurring lines are summarized per billing interval, outside the
    // one-time total (discount/tax/shipping apply to hardware only).
    const recurring = {};
    this.lines.filter((l) => l.interval).forEach((l) => {
      const key = this._lineIntervalLabel(l).trim();
      recurring[key] = (recurring[key] || 0) + this._lineTotal(l);
    });

    return { subtotal, discount, tax, shipping, total: taxable + tax + shipping, recurring };
  },

  // ── Formatting helpers ──

  _currency() { return (this.lines[0] && this.lines[0].currency) || 'usd'; },

  _money(cents, currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() })
        .format((cents || 0) / 100);
    } catch (e) {
      return `$${((cents || 0) / 100).toFixed(2)}`;
    }
  },

  _toCents(value) { return Math.max(0, Math.round((parseFloat(value) || 0) * 100)); },
  _toDollars(cents) { return ((cents || 0) / 100).toFixed(2); },

  _lineIntervalLabel(line) {
    if (!line.interval) return '';
    return line.intervalCount > 1 ? ` / ${line.intervalCount} ${line.interval}s` : ` / ${line.interval}`;
  },

  _priceHint(line) {
    if (line.listCents == null) return line.priceId ? 'Custom price' : 'Custom line';
    if (line.unitCents === line.listCents) return `List ${escHtml(this._money(line.listCents, line.currency))}`;
    return `List ${escHtml(this._money(line.listCents, line.currency))} · <button class="bom-link" onclick="BomPage.resetPrice('${line.id}')">Reset</button>`;
  },

  _lineId() { return 'l' + Math.random().toString(36).slice(2, 10); },

  _validUntil() {
    const d = new Date(`${this.quote.date}T12:00:00`);
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + (this.quote.validDays || 0));
    return localDate(d);
  },

  _displayDate(ymd) {
    const d = new Date(`${ymd}T12:00:00`);
    return isNaN(d) ? ymd : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  },

  // ── Rendering ──

  render() {
    const pageEl = document.getElementById('pageBom');
    if (!pageEl) return;
    const q = this.quote;
    const field = (label, key, attrs = '') => `
      <div class="field">
        <label for="bomQ-${key}">${label}</label>
        <input id="bomQ-${key}" value="${escHtml(q[key])}" ${attrs}
          oninput="BomPage.updateQuote('${key}', this.value)">
      </div>`;

    pageEl.innerHTML = `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">BOM Builder</div>
          <div class="page-subtitle t-muted">Build an estimate from the Stripe catalog and export it as a PDF.</div>
        </div>
        <div class="flex gap-2 bom-title-actions">
          <button class="btn btn-secondary" onclick="BomPage.newQuote()">New estimate</button>
          <button class="btn btn-primary" onclick="BomPage.exportPdf(this)">Save as PDF</button>
        </div>
      </div>

      <div class="card bom-card">
        <div class="card-title">Customer</div>
        <div class="bom-grid">
          ${field('Customer name', 'customerName', 'placeholder="Jane Smith"')}
          ${field('Company', 'customerCompany', 'placeholder="Optional"')}
          ${field('Email', 'customerEmail', 'type="email" placeholder="Optional"')}
          ${field('Estimate #', 'number')}
          ${field('Date', 'date', 'type="date"')}
          ${field('Valid for (days)', 'validDays', 'type="number" min="0" step="1"')}
          ${field('Prepared by', 'preparedBy')}
        </div>
      </div>

      <div class="card bom-card">
        <div class="flex items-center justify-between" style="margin-bottom:var(--space-5)">
          <div class="card-title" style="margin:0">Add products</div>
          <button class="btn btn-ghost btn-sm" onclick="BomPage.loadCatalog(this)">Refresh catalog</button>
        </div>
        <div id="bomPicker"></div>
      </div>

      <div class="card bom-card">
        <div class="card-title">Sheet</div>
        <div id="bomLines"></div>
        <div class="bom-footer">
          <div class="field bom-notes">
            <label for="bomQ-notes">Notes for the customer</label>
            <textarea id="bomQ-notes" rows="4" placeholder="Lead time, install scope, payment terms..."
              oninput="BomPage.updateQuote('notes', this.value)">${escHtml(q.notes)}</textarea>
          </div>
          <div class="bom-totals" id="bomTotals"></div>
        </div>
      </div>
    `;
    this._renderPicker();
    this._renderLines();
  },

  _renderPicker(message) {
    const el = document.getElementById('bomPicker');
    if (!el) return;
    if (message) { el.innerHTML = `<div class="data-empty">${escHtml(message)}</div>`; return; }
    if (this.catalogError) {
      el.innerHTML = `
        <div class="data-empty">Couldn't load the Stripe catalog — ${escHtml(this.catalogError)}</div>
        <div class="flex" style="margin-top:var(--space-4)">
          <button class="btn btn-secondary btn-sm" onclick="BomPage.addCustom()">+ Custom line</button>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="bom-picker">
        <div class="field bom-picker-search">
          <label for="bomProductSearch">Search</label>
          <input id="bomProductSearch" placeholder="Filter products" oninput="BomPage._fillProductOptions(this.value)">
        </div>
        <div class="field bom-picker-product">
          <label for="bomProductSelect">Product</label>
          <select id="bomProductSelect"></select>
        </div>
        <div class="field bom-picker-qty">
          <label for="bomAddQty">Qty</label>
          <input id="bomAddQty" type="number" min="0" step="1" value="1"
            onkeydown="if(event.key==='Enter')BomPage.addSelected()">
        </div>
        <div class="bom-picker-actions">
          <button class="btn btn-primary" onclick="BomPage.addSelected()">Add to sheet</button>
          <button class="btn btn-secondary" onclick="BomPage.addCustom()">+ Custom line</button>
        </div>
      </div>
      <div class="t-muted t-detail">${this.catalog.length} active prices from Stripe.</div>
    `;
    this._fillProductOptions('');
  },

  _fillProductOptions(filter) {
    const select = document.getElementById('bomProductSelect');
    if (!select) return;
    const f = (filter || '').toLowerCase().trim();
    const matches = this.catalog.filter((c) => !f
      || [c.name, c.nickname, c.sku, c.description].some((v) => (v || '').toLowerCase().includes(f)));
    select.innerHTML = matches.length
      ? matches.map((c) => `<option value="${escHtml(c.price_id)}">${escHtml(this._priceLabel(c))}</option>`).join('')
      : '<option value="">No matching products</option>';
  },

  _renderLines() {
    const el = document.getElementById('bomLines');
    if (!el) return;
    if (this.lines.length === 0) {
      el.innerHTML = '<div class="data-empty">No items yet. Pick a product above and click Add to sheet.</div>';
      this._renderTotals();
      return;
    }

    const rows = this.lines.map((l, i) => `
      <div class="bom-line">
        <div class="bom-cell bom-cell--item">
          <input class="bom-input bom-line-name" value="${escHtml(l.name)}" placeholder="Item name"
            aria-label="Item name" oninput="BomPage.updateLine('${l.id}', 'name', this.value)">
          <input class="bom-input bom-input--sub" value="${escHtml(l.description)}" placeholder="Description (optional)"
            aria-label="Description" oninput="BomPage.updateLine('${l.id}', 'description', this.value)">
        </div>
        <div class="bom-cell bom-cell--qty">
          <span class="bom-cell-label">Qty</span>
          <input class="bom-input bom-input--num" type="number" min="0" step="1" value="${l.qty}"
            aria-label="Quantity" oninput="BomPage.updateLine('${l.id}', 'qty', this.value)">
        </div>
        <div class="bom-cell bom-cell--price">
          <span class="bom-cell-label">Unit price</span>
          <div class="bom-money">
            <span>$</span>
            <input class="bom-input bom-input--num" type="number" min="0" step="0.01" value="${this._toDollars(l.unitCents)}"
              aria-label="Unit price" oninput="BomPage.updateLine('${l.id}', 'unit', this.value)">
          </div>
          <div class="bom-hint" id="bomLineHint-${l.id}">${this._priceHint(l)}</div>
        </div>
        <div class="bom-cell bom-cell--total">
          <span class="bom-cell-label">Total</span>
          <span id="bomLineTotal-${l.id}">${escHtml(this._money(this._lineTotal(l), l.currency) + this._lineIntervalLabel(l))}</span>
        </div>
        <div class="bom-cell bom-cell--actions">
          <button class="bom-icon-btn" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}
            onclick="BomPage.moveLine('${l.id}', -1)">↑</button>
          <button class="bom-icon-btn" title="Move down" aria-label="Move down" ${i === this.lines.length - 1 ? 'disabled' : ''}
            onclick="BomPage.moveLine('${l.id}', 1)">↓</button>
          <button class="bom-icon-btn bom-icon-btn--danger" title="Remove" aria-label="Remove"
            onclick="BomPage.removeLine('${l.id}')">×</button>
        </div>
      </div>
    `).join('');

    el.innerHTML = `
      <div class="bom-lines-head">
        <div class="bom-cell--item">Item</div>
        <div class="bom-cell--qty">Qty</div>
        <div class="bom-cell--price">Unit price</div>
        <div class="bom-cell--total">Total</div>
        <div class="bom-cell--actions"></div>
      </div>
      ${rows}
    `;
    this._renderTotals();
  },

  _renderTotals() {
    const el = document.getElementById('bomTotals');
    if (!el) return;
    const t = this._totals();
    const cur = this._currency();
    const q = this.quote;
    const recurringRows = Object.entries(t.recurring).map(([label, cents]) => `
      <div class="bom-total-row"><span>Recurring</span><span>${escHtml(this._money(cents, cur))} ${escHtml(label)}</span></div>
    `).join('');

    el.innerHTML = `
      <div class="bom-total-row"><span>Subtotal</span><span>${escHtml(this._money(t.subtotal, cur))}</span></div>
      <div class="bom-total-row">
        <label for="bomQ-discountPct">Discount %</label>
        <input id="bomQ-discountPct" class="bom-input bom-input--num" type="number" min="0" step="0.5"
          value="${q.discountPct}" onchange="BomPage.updateQuote('discountPct', this.value)">
      </div>
      ${t.discount ? `<div class="bom-total-row t-muted"><span></span><span>−${escHtml(this._money(t.discount, cur))}</span></div>` : ''}
      <div class="bom-total-row">
        <label for="bomQ-taxPct">Sales tax %</label>
        <input id="bomQ-taxPct" class="bom-input bom-input--num" type="number" min="0" step="0.01"
          value="${q.taxPct}" onchange="BomPage.updateQuote('taxPct', this.value)">
      </div>
      ${t.tax ? `<div class="bom-total-row t-muted"><span></span><span>+${escHtml(this._money(t.tax, cur))}</span></div>` : ''}
      <div class="bom-total-row">
        <label for="bomQ-shippingCents">Shipping $</label>
        <input id="bomQ-shippingCents" class="bom-input bom-input--num" type="number" min="0" step="0.01"
          value="${this._toDollars(q.shippingCents)}" onchange="BomPage.updateQuote('shippingCents', this.value)">
      </div>
      <div class="bom-total-row bom-total-row--grand"><span>Total</span><span>${escHtml(this._money(t.total, cur))}</span></div>
      ${recurringRows}
    `;
  },

  // ── PDF export ──

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load PDF library'));
      document.head.appendChild(s);
    });
  },

  // Loads the ArcNode logo as a PNG data URL for jsPDF.
  _logoPng() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ data: canvas.toDataURL('image/png'), ratio: canvas.height / canvas.width });
      };
      img.onerror = () => resolve(null);
      img.src = '/assets/arcnode-logo.png';
    });
  },

  async exportPdf(btn) {
    if (this.lines.length === 0) { showToast('Add at least one item first', 'error'); return; }
    await withBtnLoading(btn, async () => {
      try {
        await this._loadScript(BOM_JSPDF_URL);
        await this._loadScript(BOM_AUTOTABLE_URL);
        const logo = await this._logoPng();
        const doc = this._buildPdf(logo);
        const who = (this.quote.customerCompany || this.quote.customerName || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        doc.save(`ArcNode-Estimate-${this.quote.number}${who ? '-' + who : ''}.pdf`);
      } catch (e) {
        console.error('[BOM] PDF export failed:', e);
        showToast(`PDF export failed — ${e.message || 'unknown error'}`, 'error', 5000);
      }
    });
  },

  _pdfSubline(l) { return [l.sku ? `SKU ${l.sku}` : '', (l.description || '').trim()].filter(Boolean).join(' — '); },

  _buildPdf(logo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const q = this.quote;
    const cur = this._currency();
    const t = this._totals();
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;

    // Brand bar + header
    doc.setFillColor(...BOM_BRAND_RGB);
    doc.rect(0, 0, W, 6, 'F');
    if (logo) {
      const lw = 170;
      doc.addImage(logo.data, 'PNG', M, 44, lw, lw * logo.ratio);
    } else {
      doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(...BOM_DARK_RGB);
      doc.text('ArcNode', M, 66);
    }

    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...BOM_BRAND_RGB);
    doc.text('Estimate', W - M, 58, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...BOM_MUTED_RGB);
    const meta = [
      ['Estimate #', q.number],
      ['Date', this._displayDate(q.date)],
      ['Valid until', this._displayDate(this._validUntil())],
    ];
    meta.forEach(([k, v], i) => {
      const y = 76 + i * 13;
      doc.setTextColor(...BOM_MUTED_RGB).text(k, W - M - 170, y);
      doc.setTextColor(...BOM_DARK_RGB).text(String(v || ''), W - M, y, { align: 'right' });
    });

    // Prepared for / from
    let y = 140;
    const block = (title, linesArr, x) => {
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...BOM_BRAND_RGB);
      doc.text(title.toUpperCase(), x, y);
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...BOM_DARK_RGB);
      linesArr.filter(Boolean).forEach((line, i) => doc.text(String(line), x, y + 15 + i * 13));
    };
    block('Prepared for', [q.customerName || '—', q.customerCompany, q.customerEmail], M);
    block('From', ['ArcNode', 'Arc Energy Labs, Inc.', 'San Diego, CA', q.preparedBy], W / 2 + 20);
    y += 15 + 4 * 13 + 18;

    // Line items
    const body = this.lines.map((l, i) => [
      String(i + 1),
      { content: [l.name || 'Item', this._pdfSubline(l)].filter(Boolean).join('\n'), _line: l },
      String(l.qty),
      this._money(l.unitCents, l.currency) + this._lineIntervalLabel(l),
      this._money(this._lineTotal(l), l.currency) + this._lineIntervalLabel(l),
    ]);

    doc.autoTable({
      startY: y,
      margin: { left: M, right: M, bottom: 60 },
      head: [['#', 'Item', 'Qty', 'Unit price', 'Total']],
      body,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9.5, textColor: BOM_DARK_RGB, cellPadding: { top: 7, bottom: 9, left: 6, right: 6 }, valign: 'top' },
      headStyles: { fillColor: BOM_BRAND_RGB, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      alternateRowStyles: { fillColor: [240, 241, 247] },
      columnStyles: {
        0: { cellWidth: 24, textColor: BOM_MUTED_RGB },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 40, halign: 'right' },
        3: { cellWidth: 90, halign: 'right' },
        4: { cellWidth: 90, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right';
      },
      // Item name bold, SKU/description muted beneath it.
      willDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) data.cell.text = [];
      },
      didDrawCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 1) return;
        const l = data.cell.raw._line;
        const x = data.cell.x + data.cell.padding('left');
        const maxW = data.cell.width - data.cell.padding('horizontal');
        let cy = data.cell.y + data.cell.padding('top') + 8;
        doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...BOM_DARK_RGB);
        doc.splitTextToSize(l.name || 'Item', maxW).forEach((s) => { doc.text(s, x, cy); cy += 11; });
        doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...BOM_MUTED_RGB);
        const sub = this._pdfSubline(l);
        if (sub) doc.splitTextToSize(sub, maxW).forEach((s) => { doc.text(s, x, cy); cy += 10; });
      },
    });

    // Totals
    y = doc.lastAutoTable.finalY + 18;
    const rows = [['Subtotal', this._money(t.subtotal, cur)]];
    if (t.discount) rows.push([`Discount (${q.discountPct}%)`, '-' + this._money(t.discount, cur)]);
    if (t.tax) rows.push([`Sales tax (${q.taxPct}%)`, this._money(t.tax, cur)]);
    if (t.shipping) rows.push(['Shipping', this._money(t.shipping, cur)]);
    const recurring = Object.entries(t.recurring);
    const needed = rows.length * 16 + 34 + recurring.length * 16;
    if (y + needed > H - 60) { doc.addPage(); y = 60; }

    const labelX = W - M - 200;
    doc.setFontSize(10);
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal').setTextColor(...BOM_MUTED_RGB).text(k, labelX, y);
      doc.setTextColor(...BOM_DARK_RGB).text(v, W - M, y, { align: 'right' });
      y += 16;
    });
    doc.setDrawColor(...BOM_BRAND_RGB).setLineWidth(1).line(labelX, y - 6, W - M, y - 6);
    y += 10;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...BOM_DARK_RGB).text('Total', labelX, y);
    doc.setTextColor(...BOM_BRAND_RGB).text(this._money(t.total, cur), W - M, y, { align: 'right' });
    y += 20;
    recurring.forEach(([label, cents]) => {
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...BOM_MUTED_RGB).text('Plus recurring', labelX, y);
      doc.setTextColor(...BOM_DARK_RGB).text(`${this._money(cents, cur)} ${label}`, W - M, y, { align: 'right' });
      y += 16;
    });

    // Notes
    if ((q.notes || '').trim()) {
      const noteLines = doc.splitTextToSize(q.notes.trim(), W - 2 * M);
      if (y + 30 + noteLines.length * 12 > H - 60) { doc.addPage(); y = 60; } else { y += 16; }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...BOM_BRAND_RGB).text('NOTES', M, y);
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...BOM_DARK_RGB);
      doc.text(noteLines, M, y + 15, { lineHeightFactor: 1.35 });
    }

    // Footer on every page
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFillColor(...BOM_BRAND_RGB).rect(0, H - 6, W, 6, 'F');
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...BOM_MUTED_RGB);
      doc.text(`Estimate ${q.number} · Prices in ${cur.toUpperCase()} · Valid until ${this._displayDate(this._validUntil())}`, M, H - 24);
      doc.text(`arcnode.app   ·   Page ${p} of ${pages}`, W - M, H - 24, { align: 'right' });
    }
    return doc;
  },
};

window.BomPage = BomPage;
