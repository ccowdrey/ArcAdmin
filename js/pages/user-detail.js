// ArcAdmin — User Detail Page
// ============================
// 2026-04-23 lean rewrite for new design. Focus on identity + subscription +
// vehicle + account actions. Advanced telemetry/logs/trips sections removed
// from this view — trips belong on the Trips page, telemetry is a debug tool
// that should get its own dedicated view if brought back.

const UserDetailPage = {
  userId: null,
  userName: '',
  userEmail: '',
  vehicleId: null,

  async load(params) {
    this.userId = Router.resolveId(params.userId);
    const contentEl = document.getElementById('userDetailContent');
    if (contentEl) contentEl.innerHTML = '<div class="data-empty">Loading user...</div>';

    try {
      // Core profile + subscription + vehicle + company
      const [profiles, subs, vehicles] = await Promise.all([
        supa(`profiles?id=eq.${this.userId}&select=*`),
        supa(`subscriptions?user_id=eq.${this.userId}&select=*`),
        supa(`vehicles?user_id=eq.${this.userId}&select=*`),
      ]);

      const p = profiles[0];
      if (!p) {
        if (contentEl) contentEl.innerHTML = '<div class="data-empty">User not found.</div>';
        return;
      }

      const sub = subs[0];
      const v = vehicles[0];
      this.vehicleId = v?.id || null;
      this.userName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email;
      this.userEmail = p.email;

      // Build line + company (if present)
      let buildLineLabel = '—';
      let companyLabel = '—';
      if (v?.build_line_id) {
        try {
          const bls = await supa(`build_lines?id=eq.${v.build_line_id}&select=name,company_id`);
          if (bls[0]) {
            buildLineLabel = bls[0].name;
            if (bls[0].company_id) {
              const cos = await supa(`companies?id=eq.${bls[0].company_id}&select=name`);
              if (cos[0]) companyLabel = cos[0].name;
            }
          }
        } catch (_) {}
      } else if (p.company_id) {
        try {
          const cos = await supa(`companies?id=eq.${p.company_id}&select=name`);
          if (cos[0]) companyLabel = cos[0].name;
        } catch (_) {}
      }

      this._render({ profile: p, sub, vehicle: v, buildLineLabel, companyLabel });
    } catch (e) {
      console.error('User detail load failed:', e);
      if (contentEl) contentEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  _render({ profile, sub, vehicle, buildLineLabel, companyLabel }) {
    const contentEl = document.getElementById('userDetailContent');
    if (!contentEl) return;

    const tier = sub?.tier || 'base_camp';

    contentEl.innerHTML = `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">${escHtml(this.userName)}</div>
          <div class="page-subtitle t-muted">${escHtml(this.userEmail || '')}</div>
        </div>
        <div>${tierBadge(tier)}</div>
      </div>

      <div class="card">
        <div class="card-title">Account</div>
        <div class="flex flex-col gap-2">
          ${this._row('User ID', `<span style="font-family:ui-monospace,monospace;font-size:13px">${escHtml(this.userId.slice(0, 8))}...</span>`)}
          ${this._row('Joined', escHtml(formatDate(profile.created_at)))}
          ${this._row('Last active', escHtml(profile.last_login_at ? timeAgo(profile.last_login_at) : 'Never'))}
          ${this._row('Company', escHtml(companyLabel))}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Subscription</div>
        ${sub ? `
          <div class="flex flex-col gap-2">
            ${this._row('Tier', `<span style="text-transform:uppercase">${escHtml(sub.tier || '—')}</span>`)}
            ${this._row('Status', escHtml(sub.status || '—'))}
            ${this._row('Platform', escHtml(sub.platform || '—'))}
            ${sub.current_period_end ? this._row('Renews', escHtml(formatDate(sub.current_period_end))) : ''}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('explorer')">Set Explorer</button>
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('base_camp')">Set Base Camp</button>
          </div>
        ` : `
          <div class="t-muted t-detail">No subscription on record.</div>
          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('explorer')">Grant Explorer</button>
            <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('base_camp')">Grant Base Camp</button>
          </div>
        `}
      </div>

      <div class="card">
        <div class="card-title">Vehicle</div>
        ${vehicle ? `
          <div class="flex flex-col gap-2">
            ${this._row('Make & model', escHtml([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'))}
            ${this._row('Build line', escHtml(buildLineLabel))}
            ${this._row('Name', escHtml(vehicle.name || '—'))}
            ${this._row('VIN', escHtml(vehicle.vin || '—'))}
            ${this._row('Cerbo portal ID', `<span style="font-family:ui-monospace,monospace;font-size:13px">${escHtml(vehicle.cerbo_portal_id || '—')}</span>`)}
            ${this._row('Vehicle ID', `<span style="font-family:ui-monospace,monospace;font-size:13px">${escHtml(vehicle.id.slice(0, 8))}...</span>`)}
          </div>
        ` : `<div class="t-muted t-detail">No vehicle registered yet.</div>`}
      </div>

      ${Auth.isSuper() ? `
        <div class="card">
          <div class="card-title t-danger">Danger zone</div>
          <div class="t-muted t-detail" style="margin-bottom:16px">
            Permanently delete this user and all their data. This cannot be undone.
          </div>
          <button class="btn btn-danger btn-sm" onclick="UserDetailPage.deleteUser()">Delete user</button>
        </div>
      ` : ''}
    `;
  },

  _row(label, value) {
    return `
      <div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div class="t-muted t-detail" style="width:160px;flex-shrink:0">${escHtml(label)}</div>
        <div class="t-body" style="flex:1">${value || '—'}</div>
      </div>
    `;
  },

  async changeTier(newTier) {
    try {
      const existing = await supa(`subscriptions?user_id=eq.${this.userId}&select=*`);
      if (existing[0]) {
        await supaPatch(`subscriptions?user_id=eq.${this.userId}`, {
          tier: newTier,
          status: 'active',
        });
      } else {
        await supaPost('subscriptions', {
          user_id: this.userId,
          tier: newTier,
          status: 'active',
          platform: 'admin',
        });
      }
      await this.load({ userId: this.userId });
    } catch (e) {
      alert(`Failed to change tier: ${e.message}`);
    }
  },

  async deleteUser() {
    if (!confirm(`Permanently delete ${this.userName}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: this.userId }),
      });
      if (!res.ok) throw new Error(await res.text());
      Router.navigate('clients');
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  },
};

window.UserDetailPage = UserDetailPage;
