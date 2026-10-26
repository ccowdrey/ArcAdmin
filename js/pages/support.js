// ArcAdmin — Support Desk
// =======================
// 2026-10-26: ported from the ArcNode Support Desk artifact. Builder support
// staff troubleshoot customer calls against the KB and log each call; Arc
// staff (super admins) see every builder's calls, report support hours and
// edit the KB without a deploy.
//
// Views (routes registered in app.js):
//   /support                Troubleshoot: search + article list | article
//   /support/kb/:slug       Same, deep-linked to one article
//   /support/calls          Call log & insights
//   /support/hours          Hours report (own menu item)
//   /support/new            KB editor, new article (Arc staff)
//   /support/kb/:slug/edit  KB editor (Arc staff)
//
// Data: kb_articles, support_calls, kb_search_misses, support_hours_monthly,
// kb_article_revisions, and RPCs kb_search / support_people. All access rules
// (builder-only articles, own-company calls) live in RLS — see
// supabase/migration_support_desk.sql. The UI never holds article content;
// the repo is public and the KB carries PINs and default passwords.

const SUPPORT_CATEGORIES = ['ArcRemote', 'Connectivity', 'Climate', 'Devices', 'Lights', 'Cameras', 'Power', 'Builder setup', 'iPad & account', 'Safety'];
const SUPPORT_OUTCOMES = { resolved: 'Fixed', arc: 'Escalated to Arc', rixens: 'Escalated to Rixens', open: 'Still open' };
const SUPPORT_BRANCH_KINDS = { yes: 'Yes', no: 'No', other: 'Other' };
const SUPPORT_ARTICLE_FIELDS = 'id,slug,title,category,symptom,keywords,source,builder_only,top_call,safety,sort_order,ask_first,steps,tell_customer,escalate_when,stop_warning,related,status,updated_at';
const SUPPORT_WIDE = 900; // px: two-pane desk above this width, matches the mobile breakpoint

// Attribute-safe escape. escHtml (utils.js) leaves quotes alone.
function supportAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Inline Markdown → HTML. Escapes everything first, then allows **bold**,
// _italic_, `code`, [label](kb:slug) and [label](https://…). Code spans are
// pulled out before escaping so placeholders like `<cerbo-ip>` render as text.
function supportMd(src) {
  const codes = [];
  let s = String(src == null ? '' : src).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escHtml(s);
  s = s.replace(/\[([^\]]+)\]\((kb:[a-z0-9-]+|https?:\/\/[^\s)"'<>]+)\)/g, (_, label, href) => {
    if (href.startsWith('kb:')) {
      const slug = href.slice(3);
      return `<a href="/support/kb/${slug}" data-kb="${slug}">${label}</a>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(“"])_([^_\n]+?)_(?=[\s).,;:!?”"]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escHtml(codes[+i])}</code>`);
}

// Every kb: slug referenced from an article's text fields.
function supportKbLinks(a) {
  const text = [a.symptom, a.stop_warning, a.tell_customer, a.escalate_when, ...(a.ask_first || []),
    ...(a.steps || []).flatMap((s) => [s.text, s.note, ...(s.branches || []).map((b) => b.text)])].join(' ');
  return [...text.matchAll(/\]\(kb:([a-z0-9-]+)\)/g)].map((m) => m[1]);
}

function supportFmtDur(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
const supportHrs = (m) => (m / 60).toFixed(2);
const supportMonthKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const supportMonthName = (k, short) => {
  const [y, m] = k.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString([], short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
};
const supportCsvCell = (x) => { const s = String(x == null ? '' : x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function supportLocalInput(d) {
  d = new Date(d);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
}
function supportMyId() {
  const p = typeof parseJwtPayload === 'function' ? parseJwtPayload(token) : null;
  return p ? p.sub : null;
}

const SupportPage = {
  // ── Shared state ──
  articles: [],
  bySlug: {},
  articlesLoaded: false,
  companies: [],          // Arc staff: every company. Others: their own.
  companyName: {},
  vehicleCache: {},       // company_id → [{id,label}]
  vehicleName: {},        // vehicle_id → label, for logged calls
  people: {},             // user_id → display name
  calls: [],
  misses: [],

  // ── Desk state ──
  q: '',
  cat: null,
  sel: null,
  results: null,          // null = not searching, else ordered slugs
  searchSeq: 0,
  missNoted: new Set(),
  hours: { month: null, company: '' },
  edit: null,             // KB editor model

  el() { return document.getElementById('pageSupport'); },

  // ── Entry point (called by the router) ──
  async load(opts = {}) {
    const el = this.el();
    if (!el) return;
    this._wire(el);
    const view = opts.view || 'desk';

    // Popstate / internal nav between articles: keep the search box and list.
    if (view === 'desk' && this.view === 'desk' && el.querySelector('#supportDesk') && this.articlesLoaded) {
      this.view = view;
      if (opts.slug) this.select(opts.slug, false); else this.closeArticle(false);
      return;
    }

    this.view = view;
    el.innerHTML = '<div class="data-empty">Loading support desk...</div>';
    try {
      await this._ensureBase();
      if (view === 'desk') this.renderDesk(opts.slug || null);
      else if (view === 'calls') await this.renderCalls();
      else if (view === 'hours') await this.renderHours();
      else if (view === 'edit') await this.renderEditor(opts.slug || null);
    } catch (e) {
      console.error('[Support] load failed:', e);
      const missing = /kb_articles|support_calls|PGRST20[02]|42P01/.test(String(e.message || ''));
      el.innerHTML = `<div class="data-empty">${missing
        ? 'The Support Desk tables aren’t set up yet. Run supabase/migration_support_desk.sql in the Supabase SQL editor.'
        : `Failed to load — ${escHtml(e.message || '')}`}</div>`;
    }
  },

  async _ensureBase() {
    const jobs = [];
    if (!this.articlesLoaded) jobs.push(this._loadArticles());
    if (!this.companies.length) {
      jobs.push((async () => {
        if (Auth.isSuper()) {
          this.companies = await supa('companies?select=id,name&order=name.asc');
        } else if (userCompanyId) {
          this.companies = [{ id: userCompanyId, name: userCompanyName || 'Your company' }];
        }
        this.companyName = Object.fromEntries(this.companies.map((c) => [c.id, c.name]));
      })());
    }
    await Promise.all(jobs);
  },

  async _loadArticles() {
    const rows = await supa(`kb_articles?select=${SUPPORT_ARTICLE_FIELDS}&order=sort_order.asc,title.asc`);
    this.articles = rows || [];
    this.bySlug = Object.fromEntries(this.articles.map((a) => [a.slug, a]));
    this.articlesLoaded = true;
  },

  async _loadPeople() {
    try {
      const rows = await supaRpc('support_people');
      this.people = Object.fromEntries((rows || []).map((r) => [r.user_id, r.name]));
    } catch (e) { /* names are cosmetic */ }
  },
  personName(id) { return (id && this.people[id]) || 'Someone'; },
  // The vehicle picked on a call, plus the free-text reference when both are set.
  callVehicle(c) { return [this.vehicleName[c.vehicle_id], c.vehicle_ref].filter(Boolean).join(' · '); },

  categories() {
    const extra = this.articles.map((a) => a.category).filter((c) => c && !SUPPORT_CATEGORIES.includes(c));
    return [...SUPPORT_CATEGORIES, ...new Set(extra)];
  },

  // One delegated listener per page element for every data-action button,
  // kb: link and form input on any Support view.
  _wire(el) {
    if (el._supportWired) return;
    el._supportWired = true;
    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('input', (e) => this._onInput(e));
    el.addEventListener('change', (e) => this._onInput(e));
    el.addEventListener('keydown', (e) => {
      if (e.target.id === 'supportQ' && e.key === 'Enter') {
        e.preventDefault();
        const top = this.visible().list[0];
        if (top) this.select(top.slug);
      }
    });
  },

  _onClick(e) {
    const kb = e.target.closest('a[data-kb]');
    if (kb) {
      e.preventDefault();
      const slug = kb.getAttribute('data-kb');
      if (this.view === 'edit') { window.open(`/support/kb/${slug}`, '_blank'); return; }
      this.openArticle(slug);
      return;
    }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const act = b.getAttribute('data-action');
    const val = b.getAttribute('data-value');
    switch (act) {
      case 'nav': Router.navigate(val); break;
      case 'cat': this.cat = this.cat === val ? null : val; this._renderChips(); this._renderList(); break;
      case 'open': this.select(val); break;
      case 'back': this.closeArticle(true); break;
      case 'copy': this._copy(b, this.bySlug[this.sel]?.tell_customer || ''); break;
      case 'outcome': {
        const a = this.bySlug[this.sel];
        this.openLog({ article_id: a?.id, category: a?.category, outcome: val, question: this.q });
        break;
      }
      case 'log-miss': this.openLog({ question: this.q, category: this.cat || '' }); break;
      case 'log-new': this.openLog({}); break;
      case 'edit-call': { const c = this.calls.find((x) => x.id === val); if (c) this.openLog(c); break; }
      case 'write-from-call': { const c = this.calls.find((x) => x.id === val); if (c) this.newArticleFrom(c.question, c.category); break; }
      case 'write-from-miss': this.newArticleFrom(val, ''); break;
      case 'edit-article': Router.navigate(`/support/kb/${val}/edit`); break;
      case 'new-article': this._prefill = null; Router.navigate('/support/new'); break;
      // Hours
      case 'hours-month': this.hours.month = val; this.renderHours(); break;
      case 'hours-copy': this._copy(b, this._hoursText, 'Copy summary'); break;
      case 'hours-csv': this._downloadCsv(); break;
      // Editor
      default: this._onEditorClick(act, b);
    }
  },

  _onInput(e) {
    const t = e.target;
    if (t.id === 'supportQ' && e.type === 'input') { this.onSearch(t.value); return; }
    if (t.id === 'hoursMonth' && e.type === 'change') { this.hours.month = t.value; this.renderHours(); return; }
    if (t.id === 'hoursCompany' && e.type === 'change') { this.hours.company = t.value; this.renderHours(); return; }
    if (this.view === 'edit') this._onEditorInput(t, e.type);
  },

  async _copy(btn, text, label = 'Copy') {
    try {
      await navigator.clipboard.writeText(text || '');
      btn.textContent = 'Copied';
    } catch (e) {
      showToast('Copy isn’t available here. Select the text instead.', 'error');
    }
    setTimeout(() => { btn.textContent = label; }, 1600);
  },

  _tabs(active) {
    const tab = (id, label, path) =>
      `<button class="tab ${active === id ? 'tab--active' : ''}" data-action="nav" data-value="${path}">${label}</button>`;
    return `<div class="tabs support-tabs">${tab('desk', 'Troubleshoot', '/support')}${tab('calls', 'Call log &amp; insights', '/support/calls')}</div>`;
  },

  _header(title, subtitle, actions = '') {
    return `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">${title}</div>
          <div class="page-subtitle t-muted">${subtitle}</div>
        </div>
        <div class="flex items-center gap-2 support-actions">${actions}</div>
      </div>`;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Troubleshoot
  // ═══════════════════════════════════════════════════════════════════════

  renderDesk(slug) {
    const el = this.el();
    const actions = `
      ${Auth.isSuper() ? '<button class="btn btn-secondary btn-sm" data-action="new-article">New article</button>' : ''}
      <button class="btn btn-primary btn-sm" data-action="log-new">Log a call</button>`;
    el.innerHTML = `
      ${this._header('Support', 'Troubleshoot a customer call, then log how it ended.', actions)}
      ${this._tabs('desk')}
      <div class="search-input support-search">
        <span class="search-input-icon"><svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></span>
        <input id="supportQ" type="search" autocomplete="off" value="${supportAttr(this.q)}"
          placeholder="Describe what the customer says… e.g. “remote won’t control lights”" aria-label="Search troubleshooting">
      </div>
      <div class="support-chips" id="supportChips" aria-label="Filter by system"></div>
      <div class="support-desk" id="supportDesk">
        <div class="support-list-col">
          <div class="support-listhead"><span class="t-label" id="supportListLabel"></span><span class="t-label" id="supportCount"></span></div>
          <div class="support-list" id="supportList"></div>
        </div>
        <div class="support-doc-col" id="supportDoc"></div>
      </div>`;
    this._renderChips();
    if (slug) this.select(slug, false);
    else { this.sel = null; this._renderList(); this._renderDoc(); }
  },

  _renderChips() {
    const el = document.getElementById('supportChips');
    if (!el) return;
    el.innerHTML = this.categories().map((c) =>
      `<button class="support-chip" aria-pressed="${this.cat === c}" data-action="cat" data-value="${supportAttr(c)}">${escHtml(c)}</button>`).join('');
  },

  onSearch(value) {
    this.q = value;
    clearTimeout(this._searchTimer);
    if (!value.trim()) {
      this.results = null;
      this._renderList();
      return;
    }
    this._searchTimer = setTimeout(() => this._runSearch(value), 150);
  },

  async _runSearch(q) {
    const seq = ++this.searchSeq;
    let rows = [];
    try {
      rows = await supaRpc('kb_search', { q, max_results: 30 });
    } catch (e) {
      console.error('[Support] kb_search failed:', e);
    }
    if (seq !== this.searchSeq || q !== this.q) return; // a newer keystroke won
    this.results = (rows || []).map((r) => r.slug).filter((s) => this.bySlug[s]);
    this._renderList();
    const top = this.visible().list[0];
    if (top && window.innerWidth > SUPPORT_WIDE) { this.sel = top.slug; this._renderDoc(); this._markCurrent(); }
    if (!this.results.length) this._noteMiss(q);
  },

  // Record a search that found nothing, once per session per phrase, after
  // the person stops typing (~2 s). Arc staff see these in the Call log.
  _noteMiss(q) {
    clearTimeout(this._missTimer);
    const key = q.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key.length < 4 || this.missNoted.has(key)) return;
    this._missTimer = setTimeout(async () => {
      if (this.q.trim().toLowerCase().replace(/\s+/g, ' ') !== key || this.missNoted.has(key)) return;
      this.missNoted.add(key);
      try { await supaPost('kb_search_misses', { query: q.trim().slice(0, 200) }); } catch (e) { /* best effort */ }
    }, 2000);
  },

  visible() {
    const searching = this.results !== null;
    let list = searching
      ? this.results.map((s) => this.bySlug[s])
      : [...this.articles].sort((a, b) => (b.top_call ? 1 : 0) - (a.top_call ? 1 : 0));
    if (!searching) list = list.filter((a) => a.status !== 'archived');
    if (this.cat) list = list.filter((a) => a.category === this.cat);
    return { list, searching };
  },

  _renderList() {
    const listEl = document.getElementById('supportList');
    if (!listEl) return;
    const { list, searching } = this.visible();
    document.getElementById('supportListLabel').textContent =
      searching ? 'Best matches' : this.cat ? this.cat : 'Most common calls first';
    document.getElementById('supportCount').textContent =
      list.length ? `${list.length} article${list.length > 1 ? 's' : ''}` : '';
    if (!list.length) {
      listEl.innerHTML = searching
        ? `<div class="data-empty support-empty"><div><b>No article matches “${escHtml(this.q)}”.</b><br>This search has been noted so Arc can write one.</div>
             <button class="btn btn-primary btn-sm" data-action="log-miss">Log this question</button></div>`
        : '<div class="data-empty">No articles yet.</div>';
      return;
    }
    listEl.innerHTML = list.map((a) => `
      <button class="support-item" data-action="open" data-value="${a.slug}" aria-current="${this.sel === a.slug}">
        <span class="support-item-title">${escHtml(a.title)}</span>
        <span class="support-item-symptom t-muted">${escHtml(a.symptom)}</span>
        <span class="support-tags">${this._tags(a)}</span>
      </button>`).join('');
  },

  _tags(a) {
    return [
      `<span class="badge ${a.safety ? 'badge--danger' : 'badge--tier-base'}">${escHtml(a.category)}</span>`,
      a.top_call ? '<span class="badge badge--tier-explorer">Top call</span>' : '',
      a.builder_only ? '<span class="badge badge--warning">Builder Mode</span>' : '',
      a.status && a.status !== 'published' ? `<span class="badge badge--tier-base">${escHtml(a.status)}</span>` : '',
    ].join('');
  },

  _markCurrent() {
    document.querySelectorAll('#supportList .support-item').forEach((b) =>
      b.setAttribute('aria-current', String(b.getAttribute('data-value') === this.sel)));
  },

  // Open an article from anywhere (kb: link, call row): switches to the desk.
  openArticle(slug) {
    if (this.view === 'desk' && document.getElementById('supportDesk')) this.select(slug);
    else Router.navigate(`/support/kb/${slug}`);
  },

  select(slug, push = true) {
    if (!this.bySlug[slug]) {
      showToast('That article isn’t available to you.', 'error');
      if (!this.sel) this._renderDoc();
      return;
    }
    this.sel = slug;
    document.getElementById('supportDesk')?.classList.add('is-reading');
    this._renderList();
    this._renderDoc();
    if (push) {
      const path = `/support/kb/${slug}`;
      if (Router.currentPath !== path) {
        Router.history.push(Router.currentPath);
        window.history.pushState({}, '', Router.basePath + path);
        Router.currentPath = path;
      }
    }
    if (window.innerWidth <= SUPPORT_WIDE) window.scrollTo(0, 0);
  },

  closeArticle(push) {
    this.sel = null;
    document.getElementById('supportDesk')?.classList.remove('is-reading');
    this._renderList();
    this._renderDoc();
    if (push && Router.currentPath !== '/support') {
      window.history.pushState({}, '', Router.basePath + '/support');
      Router.currentPath = '/support';
    }
    window.scrollTo(0, 0);
  },

  _renderDoc() {
    const docEl = document.getElementById('supportDoc');
    if (!docEl) return;
    const a = this.bySlug[this.sel] || (window.innerWidth > SUPPORT_WIDE ? this.visible().list[0] : null);
    if (!a) { docEl.innerHTML = ''; return; }
    if (!this.sel && window.innerWidth > SUPPORT_WIDE) { this.sel = a.slug; this._markCurrent(); }
    docEl.innerHTML = this.articleHtml(a);
  },

  // Article body. Shared by the Troubleshoot view and the editor's preview.
  articleHtml(a, { preview = false } = {}) {
    const steps = (a.steps || []).filter((s) => s && (s.text || s.note)).map((s) => `
      <li>
        <div class="support-step-text">${supportMd(s.text)}</div>
        ${s.note ? `<div class="support-step-note t-muted">${supportMd(s.note)}</div>` : ''}
        ${(s.branches || []).length ? `<div class="support-branches">${s.branches.map((b) => `
          <div class="support-branch support-branch--${supportAttr(b.kind || 'other')}"><b>${escHtml(b.label || SUPPORT_BRANCH_KINDS[b.kind] || '')}</b><span>${supportMd(b.text)}</span></div>`).join('')}</div>` : ''}
      </li>`).join('');
    const related = (a.related || []).filter(Boolean);
    const meta = [a.category, a.builder_only ? 'Builder Mode' : '', a.source].filter(Boolean).map(escHtml).join(' · ');
    const canEdit = Auth.isSuper() && !preview && a.slug;
    return `
      <article class="support-doc card" aria-live="polite">
        ${preview ? '' : '<button class="btn btn-ghost btn-sm support-back" data-action="back">← All issues</button>'}
        <header class="support-doc-head">
          <div class="flex items-center justify-between gap-2">
            <span class="t-label t-muted">${meta}</span>
            ${canEdit ? `<button class="btn btn-ghost btn-sm" data-action="edit-article" data-value="${a.slug}">Edit</button>` : ''}
          </div>
          <h2 class="support-doc-title">${escHtml(a.title || 'Untitled')}</h2>
          ${a.status && a.status !== 'published' ? `<span class="badge badge--warning">${escHtml(a.status)}</span>` : ''}
          <p class="support-symptom">${supportMd(a.symptom)}</p>
        </header>
        ${a.stop_warning ? `<div class="support-callout support-callout--stop"><span class="t-label">Stop</span><div>${supportMd(a.stop_warning)}</div></div>` : ''}
        ${(a.ask_first || []).length ? `<section><span class="t-label t-muted">Ask first</span><ul class="support-ask">${a.ask_first.map((x) => `<li>${supportMd(x)}</li>`).join('')}</ul></section>` : ''}
        ${steps ? `<section><span class="t-label t-muted">Walk them through</span><ol class="support-steps">${steps}</ol></section>` : ''}
        ${a.tell_customer ? `<div class="support-callout support-callout--say"><span class="t-label">Tell the customer</span><div>${supportMd(a.tell_customer)}</div>
          ${preview ? '' : '<div><button class="btn btn-secondary btn-sm" data-action="copy">Copy</button></div>'}</div>` : ''}
        ${a.escalate_when ? `<div class="support-callout support-callout--esc"><span class="t-label">Escalate when</span><div>${supportMd(a.escalate_when)}</div></div>` : ''}
        ${related.length ? `<section><span class="t-label t-muted">Related</span><div class="support-related">${related.map((s) =>
          `<a href="/support/kb/${supportAttr(s)}" data-kb="${supportAttr(s)}">${escHtml(this.bySlug[s]?.title || s)}</a>`).join('')}</div></section>` : ''}
        ${preview ? '' : `
        <div class="support-outcome">
          <span class="t-label t-muted">How did this call end?</span>
          <div class="flex gap-2 support-outcome-row">
            <button class="btn btn-primary btn-sm" data-action="outcome" data-value="resolved">Fixed it</button>
            <button class="btn btn-secondary btn-sm" data-action="outcome" data-value="arc">Escalating to Arc</button>
            ${a.slug === 'rixens' ? '<button class="btn btn-secondary btn-sm" data-action="outcome" data-value="rixens">Escalating to Rixens</button>' : ''}
            <button class="btn btn-ghost btn-sm" data-action="outcome" data-value="open">Still open</button>
          </div>
        </div>`}
      </article>`;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Log a call (modal)
  // ═══════════════════════════════════════════════════════════════════════

  async _vehiclesFor(companyId) {
    if (!companyId) return [];
    if (this.vehicleCache[companyId]) return this.vehicleCache[companyId];
    let list = [];
    try {
      const lines = await supa(`build_lines?company_id=eq.${companyId}&select=id`);
      const ids = (lines || []).map((l) => l.id);
      if (ids.length) {
        const vs = await supa(`vehicles?build_line_id=in.(${ids.join(',')})&select=id,user_id,nickname,make,model,year`) || [];
        list = (await this._labelVehicles(vs)).sort((a, b) => a.label.localeCompare(b.label));
      }
    } catch (e) { /* free-text fallback still works */ }
    this.vehicleCache[companyId] = list;
    return list;
  },

  // Vehicle names repeat across a builder's fleet, so label by owner:
  // "First · email", plus the vehicle name when one owner has several
  // (or always, with withVehicle).
  async _labelVehicles(vs, withVehicle = false) {
    const userIds = [...new Set(vs.map((v) => v.user_id).filter(Boolean))];
    const owners = {};
    for (let i = 0; i < userIds.length; i += 100) {
      const rows = await supa(`profiles?id=in.(${userIds.slice(i, i + 100).join(',')})&select=id,first_name,email`).catch(() => []);
      for (const r of rows || []) owners[r.id] = r;
    }
    const perOwner = vs.reduce((m, v) => { m[v.user_id] = (m[v.user_id] || 0) + 1; return m; }, {});
    return vs.map((v) => {
      const vehicle = v.nickname || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
      const o = owners[v.user_id];
      const owner = o ? [o.first_name, o.email].filter(Boolean).join(' · ') : '';
      return { id: v.id, label: owner ? (withVehicle || perOwner[v.user_id] > 1 ? `${owner} (${vehicle})` : owner) : vehicle };
    });
  },

  // Labels for the vehicles picked on logged calls, for Recent calls and the CSV.
  async _loadCallVehicles() {
    const ids = [...new Set(this.calls.map((c) => c.vehicle_id).filter((id) => id && !(id in this.vehicleName)))];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const vs = await supa(`vehicles?id=in.(${chunk.join(',')})&select=id,user_id,nickname,make,model,year`) || [];
        for (const v of await this._labelVehicles(vs, true)) this.vehicleName[v.id] = v.label;
      } catch (e) { /* show the free-text reference only */ }
      // Deleted or unreadable vehicles: don't ask again this session.
      for (const id of chunk) if (!(id in this.vehicleName)) this.vehicleName[id] = '';
    }
  },

  _lastCompany() {
    try { return localStorage.getItem('arcadmin_support_company') || ''; } catch (e) { return ''; }
  },

  async openLog(pre = {}) {
    const editing = !!pre.id;
    const isSuper = Auth.isSuper();
    const companyId = editing ? (pre.company_id || '') : (pre.company_id || (isSuper ? this._lastCompany() : userCompanyId) || '');
    const cats = this.categories();
    const articleOpts = [...this.articles].sort((a, b) => a.title.localeCompare(b.title));
    const outcome = pre.outcome || 'resolved';

    document.getElementById('supportLogModal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'supportLogModal';
    overlay.innerHTML = `
      <form class="modal-box support-log" id="supportLogForm" role="dialog" aria-label="${editing ? 'Edit call' : 'Log a support call'}">
        <div class="modal-header">
          <div class="modal-title">${editing ? 'Edit call' : 'Log this call'}</div>
          <button type="button" class="modal-close" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="error-box hidden" id="supportLogError"></div>
          <div class="t-muted t-detail">Calls are visible to your company and to Arc. Skip customer phone numbers and emails.</div>
          <div class="field"><label for="slQuestion">What did the caller ask or report?</label>
            <textarea id="slQuestion" rows="3" required maxlength="4000" placeholder="In their words, e.g. “Phone app shows my van but the lights won’t turn on.”">${escHtml(pre.question || '')}</textarea></div>
          <div class="field"><label for="slCompany">Builder</label>
            ${isSuper
              ? `<select id="slCompany"><option value="">— No builder —</option>${this.companies.map((c) =>
                  `<option value="${c.id}" ${c.id === companyId ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}</select>`
              : `<input id="slCompany" readonly value="${supportAttr(userCompanyName || 'Your company')}">`}
          </div>
          <div class="support-row2">
            <div class="field"><label for="slVehicle">Vehicle</label>
              <select id="slVehicle"><option value="">Not listed</option></select></div>
            <div class="field"><label for="slVehicleRef">Vehicle or customer reference</label>
              <input id="slVehicleRef" maxlength="120" placeholder="e.g. van number, or owner’s first name" value="${supportAttr(pre.vehicle_ref || '')}"></div>
          </div>
          <div class="support-row2">
            <div class="field"><label for="slWhen">Date and time of call</label>
              <input id="slWhen" type="datetime-local" required value="${supportLocalInput(pre.called_at || Date.now())}"></div>
            <div class="field"><label for="slMinutes">Time spent (minutes)</label>
              <input id="slMinutes" type="number" min="0" max="1440" step="1" inputmode="numeric" placeholder="e.g. 15" value="${pre.minutes != null ? supportAttr(pre.minutes) : ''}"></div>
          </div>
          <div class="support-quick" aria-label="Quick time">${[5, 10, 15, 20, 30, 45, 60].map((m) =>
            `<button type="button" class="support-chip" data-min="${m}">${m < 60 ? `${m} min` : '1 hr'}</button>`).join('')}</div>
          <div class="field"><label for="slCategory">System</label>
            <select id="slCategory"><option value="">Not sure</option>${[...cats, 'Other'].map((c) =>
              `<option ${pre.category === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="slArticle">Article used</label>
            <select id="slArticle"><option value="">None fit</option>${articleOpts.map((a) =>
              `<option value="${a.id}" ${pre.article_id === a.id ? 'selected' : ''}>${escHtml(a.title)}</option>`).join('')}</select></div>
          <div class="field"><label>Outcome</label>
            <div class="support-seg">${Object.entries(SUPPORT_OUTCOMES).map(([k, v]) =>
              `<label><input type="radio" name="slOutcome" value="${k}" ${outcome === k ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
          <div class="field"><label for="slNotes">Notes</label>
            <textarea id="slNotes" rows="3" maxlength="8000" placeholder="What worked, what didn’t, what the article was missing.">${escHtml(pre.notes || '')}</textarea>
            <span class="t-muted t-detail">Gaps in the article are the most useful thing you can tell us.</span></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" id="slSave">${editing ? 'Save changes' : 'Save call'}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) close();
      const q = e.target.closest('[data-min]');
      if (q) document.getElementById('slMinutes').value = q.getAttribute('data-min');
    });

    const fillVehicles = async (cid) => {
      const sel = document.getElementById('slVehicle');
      const list = await this._vehiclesFor(cid);
      if (!document.body.contains(sel)) return;
      sel.innerHTML = '<option value="">Not listed</option>' + list.map((v) =>
        `<option value="${v.id}" ${pre.vehicle_id === v.id ? 'selected' : ''}>${escHtml(v.label)}</option>`).join('');
    };
    fillVehicles(isSuper ? companyId : userCompanyId);
    if (isSuper) document.getElementById('slCompany').addEventListener('change', (e) => fillVehicles(e.target.value));
    setTimeout(() => document.getElementById('slQuestion')?.focus(), 30);

    document.getElementById('supportLogForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('supportLogError');
      const question = document.getElementById('slQuestion').value.trim();
      if (!question) { document.getElementById('slQuestion').focus(); return; }
      const when = new Date(document.getElementById('slWhen').value);
      const mins = parseInt(document.getElementById('slMinutes').value, 10);
      const cid = isSuper ? document.getElementById('slCompany').value : userCompanyId;
      const row = {
        question: question.slice(0, 4000),
        company_id: cid || null,
        vehicle_id: document.getElementById('slVehicle').value || null,
        vehicle_ref: document.getElementById('slVehicleRef').value.trim().slice(0, 120) || null,
        called_at: (Number.isFinite(when.getTime()) ? when : new Date()).toISOString(),
        minutes: Number.isFinite(mins) && mins >= 0 ? Math.min(mins, 1440) : null,
        category: document.getElementById('slCategory').value || null,
        article_id: document.getElementById('slArticle').value || null,
        outcome: (overlay.querySelector('input[name="slOutcome"]:checked') || {}).value || 'open',
        notes: document.getElementById('slNotes').value.trim().slice(0, 8000) || null,
      };
      const btn = document.getElementById('slSave');
      try {
        await withBtnLoading(btn, async () => {
          if (editing) await supaPatch(`support_calls?id=eq.${pre.id}`, row);
          else await supaPost('support_calls', row);
        });
        if (isSuper && cid) { try { localStorage.setItem('arcadmin_support_company', cid); } catch (x) {} }
        close();
        showToast(editing ? 'Call updated' : 'Call logged', 'success');
        if (this.view === 'calls') this.renderCalls();
        else if (this.view === 'hours') this.renderHours();
      } catch (err) {
        console.error('[Support] save call failed:', err);
        errBox.textContent = /row-level security/i.test(String(err.message))
          ? 'You don’t have permission to save this call for that builder.'
          : 'The call wasn’t saved. Check your connection and try again.';
        errBox.classList.remove('hidden');
      }
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Call log & insights
  // ═══════════════════════════════════════════════════════════════════════

  async _loadCalls() {
    const [calls, misses] = await Promise.all([
      supaAll('support_calls?select=*&order=called_at.desc'),
      Auth.isSuper() ? supa('kb_search_misses?select=query,searched_at&order=searched_at.desc&limit=500').catch(() => []) : Promise.resolve([]),
      this._loadPeople(),
    ]);
    this.calls = calls || [];
    this.misses = misses || [];
    await this._loadCallVehicles();
  },

  async renderCalls() {
    const el = this.el();
    await this._loadCalls();
    if (this.view !== 'calls') return;
    const calls = this.calls;
    const n = calls.length;
    const ts = (c) => new Date(c.called_at).getTime();
    const weekAgo = Date.now() - 7 * 864e5;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const timed = calls.filter((c) => Number.isFinite(c.minutes));
    const sum = (arr) => arr.reduce((s, c) => s + c.minutes, 0);
    const totalMin = sum(timed);
    const weekMin = sum(timed.filter((c) => ts(c) > weekAgo));
    const monthMin = sum(timed.filter((c) => ts(c) >= monthStart.getTime()));
    const resolved = calls.filter((c) => c.outcome === 'resolved').length;
    const escalated = calls.filter((c) => c.outcome === 'arc' || c.outcome === 'rixens').length;
    const articleById = Object.fromEntries(this.articles.map((a) => [a.id, a]));

    const count = (arr, f) => arr.reduce((m, x) => { const k = f(x) || 'Unspecified'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const sumBy = (arr, f) => arr.reduce((m, x) => { const k = f(x) || 'Unspecified'; m[k] = (m[k] || 0) + x.minutes; return m; }, {});
    const byCat = Object.entries(count(calls, (c) => c.category)).sort((a, b) => b[1] - a[1]);
    const byArt = Object.entries(count(calls.filter((c) => c.article_id), (c) => c.article_id)).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, c]) => [articleById[id]?.title || 'Unavailable article', c]);
    const noArt = calls.filter((c) => !c.article_id).length;
    const timeCat = Object.entries(sumBy(timed, (c) => c.category)).sort((a, b) => b[1] - a[1]);
    const wk0 = new Date(); wk0.setHours(0, 0, 0, 0); wk0.setDate(wk0.getDate() - ((wk0.getDay() + 6) % 7));
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const s = new Date(wk0); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      weeks.push([s.toLocaleDateString([], { month: 'short', day: 'numeric' }), sum(timed.filter((c) => ts(c) >= s && ts(c) < e))]);
    }
    const missCounts = Object.entries(count(this.misses, (m) => m.query.trim().toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 30);

    const bars = (list, fmt) => {
      if (!list.some((x) => x[1])) return '<p class="t-muted t-detail">Nothing logged yet.</p>';
      const mx = Math.max(1, ...list.map((x) => x[1]));
      return `<div class="support-bars">${list.map(([k, v]) => `
        <div class="support-bar"><span class="support-bar-label" title="${supportAttr(k)}">${escHtml(k)}</span>
          <span class="support-bar-track"><span class="support-bar-fill" style="width:${(v / mx) * 100}%"></span></span>
          <span class="support-bar-n">${fmt ? (v ? fmt(v) : '—') : v}</span></div>`).join('')}</div>`;
    };
    const tile = (label, value, sub) => `
      <div class="stat-tile support-tile"><div class="stat-tile-top">
        <span class="stat-tile-value">${value}</span><span class="stat-tile-label t-muted">${label}</span></div>
        ${sub ? `<span class="t-muted t-detail">${sub}</span>` : ''}</div>`;
    const me = supportMyId();
    const fmtWhen = (d) => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const canEdit = (c) => Auth.isSuper() || c.logged_by === me;

    el.innerHTML = `
      ${this._header('Support', 'What callers are asking, and how much time it takes.', '<button class="btn btn-primary btn-sm" data-action="log-new">Log a call</button>')}
      ${this._tabs('calls')}
      <div class="stat-grid">
        ${tile('Calls logged', n, `${calls.filter((c) => ts(c) > weekAgo).length} in the last 7 days`)}
        ${tile('Support time, 7 days', supportFmtDur(weekMin), `${supportFmtDur(monthMin)} this month`)}
        ${tile('Total support time', supportFmtDur(totalMin), `${timed.length} of ${n} calls timed`)}
        ${tile('Avg per call', timed.length ? supportFmtDur(totalMin / timed.length) : '—')}
        ${tile('Fixed on the call', `${n ? Math.round((resolved / n) * 100) : 0}%`)}
        ${tile('Escalated', escalated)}
      </div>
      <div class="support-grid2">
        <div class="card"><div class="t-section-title">Calls by system</div>${bars(byCat)}</div>
        <div class="card"><div class="t-section-title">Most-used articles</div>${bars(byArt)}
          ${noArt ? `<p class="t-muted t-detail">${noArt} call${noArt > 1 ? 's' : ''} had no matching article.</p>` : ''}</div>
        <div class="card"><div class="t-section-title">Support time per week</div>${bars(weeks, supportFmtDur)}</div>
        <div class="card"><div class="t-section-title">Support time by system</div>${bars(timeCat, supportFmtDur)}</div>
      </div>
      ${Auth.isSuper() ? `
      <div class="card">
        <div class="t-section-title">Searches with no answer</div>
        <p class="t-muted t-detail">Phrases support staff typed that matched no article. Write these up next.</p>
        ${missCounts.length ? `<div class="support-misses">${missCounts.map(([q, c]) =>
          `<button class="support-chip" data-action="write-from-miss" data-value="${supportAttr(q)}" title="Write article from this">${escHtml(q)}${c > 1 ? ` <b>×${c}</b>` : ''}</button>`).join('')}</div>`
          : '<p class="t-muted t-detail">None yet.</p>'}
      </div>` : ''}
      <div class="card">
        <div class="t-section-title">Recent calls</div>
        ${n ? `<div class="support-table-wrap"><table class="support-table">
          <thead><tr><th>When</th><th>Time</th><th>Caller asked</th><th>Builder · vehicle</th><th>Article</th><th>Outcome</th><th>Logged by</th><th></th></tr></thead>
          <tbody>${calls.slice(0, 100).map((c) => {
            const art = articleById[c.article_id];
            return `<tr>
              <td class="support-nowrap">${escHtml(fmtWhen(c.called_at))}</td>
              <td class="support-nowrap">${supportFmtDur(c.minutes)}</td>
              <td class="support-q">${escHtml(c.question)}${c.notes ? `<div class="t-muted t-detail">${escHtml(c.notes)}</div>` : ''}</td>
              <td>${escHtml(this.companyName[c.company_id] || (c.company_id ? 'Builder' : '—'))}${this.callVehicle(c) ? `<div class="t-muted t-detail">${escHtml(this.callVehicle(c))}</div>` : ''}</td>
              <td>${art ? `<a href="/support/kb/${art.slug}" data-kb="${art.slug}">${escHtml(art.title)}</a>` : '<span class="t-muted">None</span>'}</td>
              <td><span class="badge ${c.outcome === 'resolved' ? 'badge--success' : c.outcome === 'open' ? 'badge--tier-base' : 'badge--warning'}">${escHtml(SUPPORT_OUTCOMES[c.outcome] || c.outcome)}</span></td>
              <td>${escHtml(this.personName(c.logged_by))}</td>
              <td class="support-nowrap">
                ${canEdit(c) ? `<button class="btn btn-ghost btn-sm" data-action="edit-call" data-value="${c.id}">Edit</button>` : ''}
                ${Auth.isSuper() && !c.article_id ? `<button class="btn btn-ghost btn-sm" data-action="write-from-call" data-value="${c.id}">Write article</button>` : ''}
              </td></tr>`;
          }).join('')}</tbody></table></div>`
          : '<div class="data-empty">No calls logged yet. Finish a call from any article with “Fixed it” or “Escalating”, or use Log a call.</div>'}
      </div>`;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Hours report
  // ═══════════════════════════════════════════════════════════════════════

  async renderHours() {
    const el = this.el();
    const [monthly] = await Promise.all([
      supaAll('support_hours_monthly?select=month,logged_by,company_id,calls,timed_calls,minutes&order=month.desc'),
      this._loadCalls(),
    ]);
    if (this.view !== 'hours') return;
    const isSuper = Auth.isSuper();
    const now = supportMonthKey(new Date());
    if (!this.hours.month) this.hours.month = now;
    if (!isSuper) this.hours.company = userCompanyId || '';
    const month = this.hours.month;
    const company = this.hours.company;
    // The view's month is a date ('2026-10-01'); take YYYY-MM.
    const rows = (monthly || []).map((r) => ({ ...r, mk: String(r.month).slice(0, 7) }))
      .filter((r) => !company || r.company_id === company);
    const months = [...new Set([now, month, ...rows.map((r) => r.mk)])].sort().reverse();
    const inM = rows.filter((r) => r.mk === month);
    const nm = (id) => this.personName(id);
    const coName = (id) => (id ? this.companyName[id] || 'Builder' : 'No builder');

    const per = {};
    for (const r of inM) {
      const p = per[r.logged_by || ''] || (per[r.logged_by || ''] = { calls: 0, timed: 0, min: 0 });
      p.calls += r.calls; p.timed += r.timed_calls; p.min += r.minutes;
    }
    const people = Object.entries(per).sort((a, b) => b[1].min - a[1].min || nm(a[0]).localeCompare(nm(b[0])));
    const tot = people.reduce((t, [, p]) => ({ calls: t.calls + p.calls, timed: t.timed + p.timed, min: t.min + p.min }), { calls: 0, timed: 0, min: 0 });
    const untimed = tot.calls - tot.timed;

    const byCo = {};
    for (const r of inM) {
      const c = byCo[r.company_id || ''] || (byCo[r.company_id || ''] = { name: coName(r.company_id), min: 0, people: {} });
      c.min += r.minutes;
      const p = c.people[r.logged_by || ''] || (c.people[r.logged_by || ''] = { calls: 0, min: 0 });
      p.calls += r.calls; p.min += r.minutes;
    }
    const coRows = Object.values(byCo).sort((a, b) => a.name.localeCompare(b.name));

    const last = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); last.push(supportMonthKey(d)); }
    const mat = {};
    for (const r of rows) {
      if (!last.includes(r.mk) || !r.minutes) continue;
      const k = r.logged_by || '';
      (mat[k] || (mat[k] = {}))[r.mk] = ((mat[k] || {})[r.mk] || 0) + r.minutes;
    }
    const gridPeople = Object.keys(mat).sort((a, b) => nm(a).localeCompare(nm(b)));
    const colTot = last.map((mk) => gridPeople.reduce((s, p) => s + (mat[p][mk] || 0), 0));

    const label = supportMonthName(month) + (company ? ` · ${coName(company)}` : '');
    this._hoursText = [
      `Support hours, ${label}`,
      ...people.map(([id, p]) => `${nm(id)}: ${supportHrs(p.min)} h (${p.calls} call${p.calls === 1 ? '' : 's'})`),
      `Total: ${supportHrs(tot.min)} h across ${tot.calls} call${tot.calls === 1 ? '' : 's'}`,
    ].join('\n');
    const csvCalls = this.calls.filter((c) => supportMonthKey(c.called_at) === month && (!company || c.company_id === company))
      .sort((a, b) => new Date(a.called_at) - new Date(b.called_at));
    const fin = (m) => Number.isFinite(m);
    this._hoursCsv = ['Date,Logged by,Builder,Vehicle,System,Minutes,Hours,Outcome,Caller asked', ...csvCalls.map((c) => [
      new Date(c.called_at).toLocaleString(), nm(c.logged_by), coName(c.company_id), this.callVehicle(c), c.category,
      fin(c.minutes) ? c.minutes : '', fin(c.minutes) ? supportHrs(c.minutes) : '', SUPPORT_OUTCOMES[c.outcome] || c.outcome, c.question,
    ].map(supportCsvCell).join(','))].join('\n');
    this._hoursCsvName = `arcnode-support-hours-${month}${company ? `-${slugify(coName(company))}` : ''}.csv`;

    const i = months.indexOf(month);
    el.innerHTML = `
      ${this._header('Support hours', 'Support time by person and builder, for billing and reporting.')}
      <div class="flex items-center gap-2 support-reptools">
        <button class="btn btn-secondary btn-sm" data-action="hours-month" data-value="${months[i + 1] || ''}" ${i >= months.length - 1 ? 'disabled' : ''} aria-label="Previous month">←</button>
        <div class="field"><select id="hoursMonth" aria-label="Month">${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${escHtml(supportMonthName(m))}</option>`).join('')}</select></div>
        <button class="btn btn-secondary btn-sm" data-action="hours-month" data-value="${months[i - 1] || ''}" ${i <= 0 ? 'disabled' : ''} aria-label="Next month">→</button>
        ${isSuper ? `<div class="field"><select id="hoursCompany" aria-label="Builder"><option value="">All builders</option>${this.companies.map((c) =>
          `<option value="${c.id}" ${c.id === company ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}</select></div>` : ''}
      </div>
      <div class="card">
        <div class="flex items-center justify-between gap-2 support-card-head">
          <div class="t-section-title">${escHtml(label)}</div>
          <div class="flex gap-2"><button class="btn btn-secondary btn-sm" data-action="hours-copy">Copy summary</button>
            <button class="btn btn-primary btn-sm" data-action="hours-csv" ${csvCalls.length ? '' : 'disabled'}>Download CSV</button></div>
        </div>
        ${people.length ? `<div class="support-table-wrap"><table class="support-table support-table--num">
          <thead><tr><th>Person</th><th>Calls</th><th>Timed</th><th>Hours</th><th>Avg per call</th></tr></thead>
          <tbody>${people.map(([id, p]) => `<tr><td>${escHtml(nm(id))}</td><td>${p.calls}</td><td>${p.timed}</td><td><b>${supportHrs(p.min)}</b></td><td>${p.timed ? supportFmtDur(p.min / p.timed) : '—'}</td></tr>`).join('')}
            <tr class="support-tot"><td>Total</td><td>${tot.calls}</td><td>${tot.timed}</td><td><b>${supportHrs(tot.min)}</b></td><td>${tot.timed ? supportFmtDur(tot.min / tot.timed) : '—'}</td></tr></tbody>
          </table></div>
          ${untimed ? `<p class="t-muted t-detail">${untimed} call${untimed === 1 ? '' : 's'} this month ${untimed === 1 ? 'has' : 'have'} no time logged and ${untimed === 1 ? 'isn’t' : 'aren’t'} in the hours. Edit ${untimed === 1 ? 'it' : 'them'} in the Call log to add minutes.</p>` : ''}`
          : `<div class="data-empty">No calls logged in ${escHtml(supportMonthName(month))}${company ? ` for ${escHtml(coName(company))}` : ''}. Pick another month${isSuper ? ' or builder' : ''}.</div>`}
      </div>
      ${coRows.length ? `<div class="card"><div class="t-section-title">By builder</div>
        <p class="t-muted t-detail">Hours each person spent supporting each builder this month.</p>
        <div class="support-table-wrap"><table class="support-table support-table--num">
          <thead><tr><th>Builder</th><th>Person</th><th>Calls</th><th>Hours</th></tr></thead>
          <tbody>${coRows.map((c) => `<tr class="support-grp"><td colspan="3">${escHtml(c.name)}</td><td><b>${supportHrs(c.min)}</b></td></tr>
            ${Object.entries(c.people).sort((a, b) => b[1].min - a[1].min).map(([id, p]) =>
              `<tr><td></td><td>${escHtml(nm(id))}</td><td>${p.calls}</td><td>${supportHrs(p.min)}</td></tr>`).join('')}`).join('')}</tbody>
        </table></div></div>` : ''}
      <div class="card"><div class="t-section-title">Last 12 months</div>
        <p class="t-muted t-detail">Hours per person per month${company ? ` for ${escHtml(coName(company))}` : ''}. Click a month to open it.</p>
        ${gridPeople.length ? `<div class="support-table-wrap"><table class="support-table support-table--num support-table--grid">
          <thead><tr><th>Person</th>${last.map((m) => `<th><button class="support-mbtn ${m === month ? 'is-on' : ''}" data-action="hours-month" data-value="${m}">${escHtml(supportMonthName(m, true))}</button></th>`).join('')}<th>Total</th></tr></thead>
          <tbody>${gridPeople.map((p) => `<tr><td>${escHtml(nm(p))}</td>${last.map((m) => `<td class="${m === month ? 'is-on' : ''}">${mat[p][m] ? supportHrs(mat[p][m]) : '·'}</td>`).join('')}<td><b>${supportHrs(last.reduce((s, m) => s + (mat[p][m] || 0), 0))}</b></td></tr>`).join('')}
            <tr class="support-tot"><td>Total</td>${colTot.map((t, j) => `<td class="${last[j] === month ? 'is-on' : ''}">${t ? supportHrs(t) : '·'}</td>`).join('')}<td><b>${supportHrs(colTot.reduce((a, b) => a + b, 0))}</b></td></tr></tbody>
        </table></div>` : '<p class="t-muted t-detail">No timed calls in the last 12 months yet.</p>'}
      </div>`;
  },

  _downloadCsv() {
    const blob = new Blob([this._hoursCsv || ''], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._hoursCsvName || 'support-hours.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // KB editor (Arc staff)
  // ═══════════════════════════════════════════════════════════════════════

  newArticleFrom(title, category) {
    this._prefill = { title: (title || '').split('\n')[0].slice(0, 120), keywords: (title || '').toLowerCase().slice(0, 300), category: category || '' };
    Router.navigate('/support/new');
  },

  _blankArticle() {
    return {
      id: null, slug: '', title: '', category: SUPPORT_CATEGORIES[0], symptom: '', keywords: '', source: 'Support playbook',
      builder_only: false, top_call: false, safety: false, sort_order: 1000, ask_first: [], steps: [{ text: '', note: '', branches: [] }],
      tell_customer: '', escalate_when: '', stop_warning: '', related: [], status: 'draft',
    };
  },

  async renderEditor(slug) {
    // Re-read so the editor starts from the latest saved version.
    await this._loadArticles();
    if (this.view !== 'edit') return;
    if (slug && !this.bySlug[slug]) { showToast('Article not found', 'error'); Router.navigate('/support'); return; }
    const src = slug ? this.bySlug[slug] : { ...this._blankArticle(), ...(this._prefill || {}) };
    this._prefill = null;
    this.edit = JSON.parse(JSON.stringify(src));
    this.edit.steps = (this.edit.steps || []).map((s) => ({ text: s.text || '', note: s.note || '', branches: (s.branches || []).map((b) => ({ ...b })) }));
    this._slugTouched = !!slug;
    this.revisions = [];
    this._renderEditor();
    if (this.edit.id) this._loadRevisions();
  },

  _renderEditor() {
    const el = this.el();
    const a = this.edit;
    const isNew = !a.id;
    const opt = (v, cur, label) => `<option value="${supportAttr(v)}" ${v === cur ? 'selected' : ''}>${escHtml(label || v)}</option>`;
    const f = (key, label, inner) => `<div class="field"><label for="kbf_${key}">${label}</label>${inner}</div>`;
    const input = (key, attrs = '') => `<input id="kbf_${key}" data-f="${key}" value="${supportAttr(a[key] == null ? '' : a[key])}" ${attrs}>`;
    const area = (key, rows = 2, ph = '') => `<textarea id="kbf_${key}" data-f="${key}" rows="${rows}" placeholder="${supportAttr(ph)}">${escHtml(a[key] || '')}</textarea>`;
    const cats = this.categories();
    if (a.category && !cats.includes(a.category)) cats.push(a.category);
    const others = this.articles.filter((x) => x.slug !== a.slug && !(a.related || []).includes(x.slug)).sort((x, y) => x.title.localeCompare(y.title));

    el.innerHTML = `
      <div><button class="btn btn-ghost btn-sm" data-action="nav" data-value="${isNew ? '/support' : `/support/kb/${a.slug}`}">← ${isNew ? 'Support' : escHtml(a.title)}</button></div>
      ${this._header(isNew ? 'New article' : 'Edit article', 'Changes go live for support staff as soon as you publish. No deploy needed.', `
        <button class="btn btn-primary btn-sm" data-action="kb-save">${isNew ? 'Create article' : 'Save changes'}</button>`)}
      <div class="error-box hidden" id="kbError"></div>
      <div class="support-editor">
        <div class="support-editor-form card">
          ${f('title', 'Title', input('title', 'maxlength="200" placeholder="e.g. Router needs a hard restart"'))}
          <div class="support-row2">
            ${f('slug', 'Slug (link address)', input('slug', `pattern="[a-z0-9-]+" placeholder="router-hard-restart" ${isNew ? '' : 'readonly'}`))}
            ${f('status', 'Status', `<select id="kbf_status" data-f="status">${opt('draft', a.status, 'Draft')}${opt('published', a.status, 'Published')}${opt('archived', a.status, 'Archived')}</select>`)}
          </div>
          <div class="support-row2">
            ${f('category', 'System', `<select id="kbf_category" data-f="category">${cats.map((c) => opt(c, a.category)).join('')}</select>`)}
            ${f('source', 'Source label', input('source', 'placeholder="e.g. User Manual v1.1"'))}
          </div>
          ${f('symptom', 'Symptom (what the caller sees)', area('symptom', 2))}
          ${f('keywords', 'Keywords: how callers phrase it, part names, typos', area('keywords', 2, 'remote phone app lights not responding…'))}
          <div class="support-flags">
            <label><input type="checkbox" data-f="builder_only" ${a.builder_only ? 'checked' : ''}> Builder only (PINs, passwords, wiring)</label>
            <label><input type="checkbox" data-f="top_call" ${a.top_call ? 'checked' : ''}> Top call</label>
            <label><input type="checkbox" data-f="safety" ${a.safety ? 'checked' : ''}> Safety</label>
            <label>Sort order <input type="number" data-f="sort_order" value="${supportAttr(a.sort_order)}" style="width:90px"></label>
          </div>
          ${f('stop_warning', 'Stop callout (optional)', area('stop_warning', 2))}
          ${f('ask_first', 'Ask first (one question per line)', `<textarea id="kbf_ask_first" data-f="ask_first" rows="3">${escHtml((a.ask_first || []).join('\n'))}</textarea>`)}
          <div class="t-label t-muted">Steps</div>
          <div class="support-step-editor">${a.steps.map((s, i) => this._stepEditorHtml(s, i, a.steps.length)).join('')}</div>
          <button class="btn btn-secondary btn-sm" data-action="kb-step-add">+ Add step</button>
          ${f('tell_customer', 'Tell the customer', area('tell_customer', 2))}
          ${f('escalate_when', 'Escalate when', area('escalate_when', 2))}
          <div class="field"><label>Related articles</label>
            <div class="support-related-edit">${(a.related || []).map((s, i) => `
              <span class="support-chip">${escHtml(this.bySlug[s]?.title || s)} <button type="button" class="support-x" data-action="kb-rel-del" data-i="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>
            <select id="kbRelAdd"><option value="">+ Add a related article…</option>${others.map((x) => `<option value="${x.slug}">${escHtml(x.title)}</option>`).join('')}</select>
          </div>
          <p class="t-muted t-detail">Formatting: **bold**, _italic_, \`code\`, and links to other articles as [label](kb:slug).</p>
        </div>
        <div class="support-editor-side">
          <div class="t-label t-muted">Preview</div>
          <div id="kbPreview"></div>
          ${isNew ? '' : '<div class="card support-history"><div class="t-section-title">History</div><div id="kbHistory" class="t-muted t-detail">Loading…</div></div>'}
        </div>
      </div>`;
    this._renderPreview();
    if (this.revisions && this.revisions.length) this._renderHistory();
  },

  _stepEditorHtml(s, i, n) {
    return `
      <div class="support-step-card" data-step="${i}">
        <div class="flex items-center justify-between">
          <span class="t-body-bold">Step ${i + 1}</span>
          <span class="flex gap-1">
            <button type="button" class="btn btn-ghost btn-sm" data-action="kb-step-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="kb-step-down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="kb-step-del" data-i="${i}" aria-label="Delete step">Delete</button>
          </span>
        </div>
        <div class="field"><textarea rows="2" data-step-f="text" data-i="${i}" placeholder="What to do">${escHtml(s.text)}</textarea></div>
        <div class="field"><input data-step-f="note" data-i="${i}" placeholder="Optional note" value="${supportAttr(s.note || '')}"></div>
        ${(s.branches || []).map((b, j) => `
          <div class="support-branch-edit">
            <select data-br-f="kind" data-i="${i}" data-j="${j}">${Object.entries(SUPPORT_BRANCH_KINDS).map(([k, v]) => `<option value="${k}" ${b.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <input data-br-f="label" data-i="${i}" data-j="${j}" placeholder="Label, e.g. IP shown" value="${supportAttr(b.label || '')}">
            <input data-br-f="text" data-i="${i}" data-j="${j}" placeholder="Then…" value="${supportAttr(b.text || '')}">
            <button type="button" class="btn btn-ghost btn-sm" data-action="kb-br-del" data-i="${i}" data-j="${j}" aria-label="Remove branch">✕</button>
          </div>`).join('')}
        <button type="button" class="btn btn-ghost btn-sm" data-action="kb-br-add" data-i="${i}">+ Branch (yes / no / other)</button>
      </div>`;
  },

  _onEditorInput(t, type) {
    const a = this.edit;
    if (!a) return;
    if (t.id === 'kbRelAdd') {
      if (type === 'change' && t.value) { a.related = [...(a.related || []), t.value]; this._renderEditor(); }
      return;
    }
    const key = t.getAttribute('data-f');
    if (key) {
      if (t.type === 'checkbox') a[key] = t.checked;
      else if (key === 'ask_first') a.ask_first = t.value.split('\n').map((x) => x.trim()).filter(Boolean);
      else if (key === 'sort_order') a.sort_order = parseInt(t.value, 10) || 0;
      else a[key] = t.value;
      if (key === 'title' && !a.id && !this._slugTouched) {
        a.slug = slugify(t.value).slice(0, 80);
        const slugEl = document.getElementById('kbf_slug');
        if (slugEl) slugEl.value = a.slug;
      }
      if (key === 'slug') this._slugTouched = true;
    }
    const i = t.getAttribute('data-i');
    if (t.hasAttribute('data-step-f')) a.steps[+i][t.getAttribute('data-step-f')] = t.value;
    if (t.hasAttribute('data-br-f')) a.steps[+i].branches[+t.getAttribute('data-j')][t.getAttribute('data-br-f')] = t.value;
    this._renderPreview();
  },

  _onEditorClick(act, b) {
    const a = this.edit;
    if (!a || !act.startsWith('kb-')) return;
    const i = +b.getAttribute('data-i');
    const j = +b.getAttribute('data-j');
    const swap = (x, y) => { [a.steps[x], a.steps[y]] = [a.steps[y], a.steps[x]]; };
    switch (act) {
      case 'kb-step-add': a.steps.push({ text: '', note: '', branches: [] }); break;
      case 'kb-step-del': a.steps.splice(i, 1); break;
      case 'kb-step-up': if (i > 0) swap(i, i - 1); break;
      case 'kb-step-down': if (i < a.steps.length - 1) swap(i, i + 1); break;
      case 'kb-br-add': a.steps[i].branches.push({ kind: a.steps[i].branches.length ? 'no' : 'yes', label: '', text: '' }); break;
      case 'kb-br-del': a.steps[i].branches.splice(j, 1); break;
      case 'kb-rel-del': a.related.splice(i, 1); break;
      case 'kb-restore': this._restore(+b.getAttribute('data-value')); return;
      case 'kb-save': this._saveArticle(b); return;
      default: return;
    }
    this._renderEditor();
  },

  _renderPreview() {
    const el = document.getElementById('kbPreview');
    if (el) el.innerHTML = this.articleHtml(this.edit, { preview: true });
  },

  _validate(a) {
    const errs = [];
    if (!a.title.trim()) errs.push('Add a title.');
    if (!/^[a-z0-9-]+$/.test(a.slug)) errs.push('The slug can only use lowercase letters, numbers and dashes.');
    else if (!a.id && this.bySlug[a.slug]) errs.push(`The slug “${a.slug}” is already used by another article.`);
    if (!a.symptom.trim()) errs.push('Add the symptom.');
    if (!a.category) errs.push('Pick a system.');
    const known = (s) => s === a.slug || !!this.bySlug[s];
    const badLinks = [...new Set(supportKbLinks(a).filter((s) => !known(s)))];
    if (badLinks.length) errs.push(`These kb: links don’t match an article: ${badLinks.join(', ')}.`);
    const badRel = (a.related || []).filter((s) => !known(s));
    if (badRel.length) errs.push(`These related articles don’t exist: ${badRel.join(', ')}.`);
    return errs;
  },

  async _saveArticle(btn) {
    const a = this.edit;
    const errBox = document.getElementById('kbError');
    const errs = this._validate(a);
    if (errs.length) {
      errBox.innerHTML = errs.map(escHtml).join('<br>');
      errBox.classList.remove('hidden');
      window.scrollTo(0, 0);
      return;
    }
    errBox.classList.add('hidden');
    const nul = (s) => (s && String(s).trim() ? String(s).trim() : null);
    const row = {
      slug: a.slug, title: a.title.trim(), category: a.category, symptom: a.symptom.trim(), keywords: (a.keywords || '').trim(),
      source: nul(a.source), builder_only: !!a.builder_only, top_call: !!a.top_call, safety: !!a.safety,
      sort_order: Number.isFinite(+a.sort_order) ? +a.sort_order : 1000, ask_first: a.ask_first || [],
      steps: a.steps.filter((s) => s.text.trim()).map((s) => ({
        text: s.text.trim(), note: nul(s.note),
        branches: (s.branches || []).filter((x) => (x.text || '').trim()).map((x) => ({ kind: x.kind || 'other', label: (x.label || '').trim(), text: x.text.trim() })),
      })),
      tell_customer: nul(a.tell_customer), escalate_when: nul(a.escalate_when), stop_warning: nul(a.stop_warning),
      related: a.related || [], status: a.status,
    };
    try {
      await withBtnLoading(btn, async () => {
        if (a.id) await supaPatch(`kb_articles?id=eq.${a.id}`, row);
        else await supaPost('kb_articles', row);
      });
      await this._loadArticles();
      showToast(a.id ? 'Article saved' : 'Article created', 'success');
      Router.navigate(`/support/kb/${row.slug}`);
    } catch (e) {
      console.error('[Support] save article failed:', e);
      errBox.textContent = /duplicate key/i.test(String(e.message)) ? 'That slug is already used by another article.' : `The article wasn’t saved — ${String(e.message || '').slice(0, 200)}`;
      errBox.classList.remove('hidden');
    }
  },

  async _loadRevisions() {
    try {
      const [revs] = await Promise.all([
        supa(`kb_article_revisions?article_id=eq.${this.edit.id}&select=id,snapshot,edited_by,edited_at&order=edited_at.desc&limit=50`),
        this._loadPeople(),
      ]);
      this.revisions = revs || [];
    } catch (e) {
      this.revisions = [];
    }
    this._renderHistory();
  },

  _renderHistory() {
    const el = document.getElementById('kbHistory');
    if (!el) return;
    if (!this.revisions.length) { el.textContent = 'No earlier versions yet.'; return; }
    el.innerHTML = `<p>Each row is the version before that edit. Restore loads it into the form; save to keep it.</p>
      ${this.revisions.map((r) => `
        <div class="support-rev">
          <span>${escHtml(formatDateTime(r.edited_at))} · ${escHtml(this.personName(r.edited_by))}<br><span class="t-dim">${escHtml(r.snapshot?.title || '')} · ${escHtml(r.snapshot?.status || '')}</span></span>
          <button class="btn btn-ghost btn-sm" data-action="kb-restore" data-value="${r.id}">Restore</button>
        </div>`).join('')}`;
  },

  _restore(revId) {
    const r = this.revisions.find((x) => x.id === revId);
    if (!r) return;
    const keep = { id: this.edit.id, slug: this.edit.slug };
    const snap = r.snapshot || {};
    const fields = ['title', 'category', 'symptom', 'keywords', 'source', 'builder_only', 'top_call', 'safety', 'sort_order', 'ask_first', 'steps', 'tell_customer', 'escalate_when', 'stop_warning', 'related', 'status'];
    for (const k of fields) if (k in snap) this.edit[k] = JSON.parse(JSON.stringify(snap[k]));
    this.edit.steps = (this.edit.steps || []).map((s) => ({ text: s.text || '', note: s.note || '', branches: s.branches || [] }));
    Object.assign(this.edit, keep);
    this._renderEditor();
    showToast('Earlier version loaded. Save to keep it.', 'success');
  },
};

window.SupportPage = SupportPage;
