// ArcAdmin — Models Page (company admin scope)
// ==============================================
// Shows the authenticated company admin's own build lines. Thin wrapper
// around BuildLinesPage.loadForCompany, scoped to the user's company.
//
// Super admins who somehow land here also see their own company's build
// lines if they have a userCompanyId, otherwise get redirected.
//
// Navigation: clicking a row opens /models/:buildLineId which renders the
// existing BuildLineDetailPage (shared with the super admin flow).

const ModelsPage = {
  async load() {
    const pageEl = document.getElementById('pageModels');
    if (!pageEl) return;

    if (!userCompanyId) {
      pageEl.innerHTML = '<div class="data-empty">No company associated with this account.</div>';
      return;
    }

    // Header + container for BuildLinesPage to render into
    pageEl.innerHTML = `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">Models</div>
          <div class="page-subtitle t-muted">${escHtml(userCompanyName || 'Your company')} — product lineup, manuals, and schematics.</div>
        </div>
      </div>
      <div id="modelsBuildLinesContainer" style="width:100%"></div>
    `;

    const container = document.getElementById('modelsBuildLinesContainer');

    // Reuse BuildLinesPage. It already handles the list, add/edit modals,
    // and the row-click navigation. We override the row-click nav target
    // via a route-aware slugged link — the /models/:id route we registered
    // in app.js picks up navigation at that prefix.
    if (window.BuildLinesPage && BuildLinesPage.loadForCompany) {
      // Monkey-patch _renderList to emit /models/:id links instead of
      // /companies/:c/builds/:b links while this page is active.
      // Restored when any other page loads.
      const originalRender = BuildLinesPage._renderList;
      BuildLinesPage._renderList = function () {
        const container = this.listContainer;
        if (!container) return;
        try {
          const headerMarkup = `
            <div class="flex items-center justify-between" style="margin-bottom:20px">
              <div>
                <div class="t-section-title">Build Lines</div>
                <div class="t-muted t-detail">The product lineup clients pick from during onboarding.</div>
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

          const rows = this.buildLines.map((bl) => {
            Router.registerSlug(bl.id, bl.name);
            const blSlug = Router.getSlug(bl.id) || slugify(bl.name);
            const schematicPill = bl.schematic_url
              ? '<span class="badge badge--success">✓ Schematic</span>'
              : '<span class="badge badge--tier-base-camp">No schematic</span>';
            return `
              <div class="data-table-row" onclick="Router.navigate('/models/${escHtml(blSlug)}')">
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
          console.error('[Models] render failed:', e);
          container.innerHTML = `<div class="data-empty">Error rendering build lines — ${escHtml(e.message || '')}.</div>`;
        }
      };

      // Restore original when the user navigates away
      ModelsPage._restoreFn = () => {
        BuildLinesPage._renderList = originalRender;
      };

      await BuildLinesPage.loadForCompany(userCompanyId, userCompanyName, container);
    } else {
      container.innerHTML = '<div class="data-empty">Build lines module not loaded.</div>';
    }
  },
};

window.ModelsPage = ModelsPage;
