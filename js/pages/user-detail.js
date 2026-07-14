// ArcAdmin — User Detail Page
// ============================
// Identity + subscription + vehicle + account actions + Victron Cerbo
// system logs with pagination.
//
// 2026-04-23 update: Cerbo telemetry log viewer restored.
//
// 2026-05-12 update: per-vehicle battery capacity override row in the
// Vehicle Info card. Effective = vehicle.battery_capacity_ah ??
// build_line.battery_capacity_ah ?? null. Inline edit; empty clears the
// override. The iPad's BatteryCapacityLearner mirrors this hierarchy.
//
// 2026-05-16 update: device control logs section. Surfaces every user-
// initiated switch / scene activation emitted by the iPad app from the
// device_control_logs table. Date range, optional filters by category and
// source, paginated. Empty state explains that the table is populated by
// the iPad app — useful for troubleshooting "did the fan ever come on?".
//
// 2026-06-10 update: ArcRemote (iPhone) support in Device Activity.
//   * source='remote' rows (inserted by the trg_log_remote_command trigger
//     on device_commands) get a distinct purple phone badge.
//   * "Remote (iPhone)" added to the Source filter.
//   * Category filter options aligned with the Builder Mode tab categories
//     the iPad's DeviceLogger actually emits (climate, heating, rooftop,
//     exterior, interior, media, scene).
//   * Value cell tolerates raw command payloads: JSON strings are parsed
//     and re-rendered compactly; full value preserved in a title tooltip.

const UserDetailPage = {
  userId: null,
  userName: '',
  userEmail: '',
  vehicleId: null,

  // Stashed context for inline battery + dimensions edit
  _vehicle: null,
  _buildLineBatteryAh: null,
  _buildLineWheelbase: null,
  _buildLineTrack: null,

  // Cerbo telemetry log state
  _logs: [],
  _page: 1,
  _perPage: 100,
  _dateRange: { start: '', end: '' },

  // Device control log state
  _devLogs: [],
  _devLogsPage: 1,
  _devLogsPerPage: 50,
  _devLogsDateRange: { start: '', end: '' },
  _devLogsFilters: { category: '', action: '', source: '' },

  // Harsh-driving event state. Per-page is smaller than device activity
  // because each row carries denser info (peak g, duration, severity badge)
  // and the section is consulted incident-by-incident, not scanned in bulk.
  _motionEvents: [],
  _motionPage: 1,
  _motionPerPage: 25,

  async load(params) {
    this.userId = Router.resolveId(params.userId);
    const contentEl = document.getElementById('userDetailContent');
    if (contentEl) contentEl.innerHTML = '<div class="data-empty">Loading user...</div>';

    try {
      const [profiles, subs, vehicles, lastLog, lastDevLog] = await Promise.all([
        supa(`profiles?id=eq.${this.userId}&select=*`),
        supa(`subscriptions?user_id=eq.${this.userId}&select=*`),
        supa(`vehicles?user_id=eq.${this.userId}&select=*`),
        // Strongest "last active" signals beyond last_login_at: the most
        // recent telemetry log and the most recent device-control action.
        // last_login_at writes are best-effort (silent try? on the client),
        // so we don't rely on them alone — we take the newest of all three.
        supa(`system_logs?user_id=eq.${this.userId}&order=logged_at.desc&limit=1&select=logged_at`).catch(() => []),
        supa(`device_control_logs?user_id=eq.${this.userId}&order=created_at.desc&limit=1&select=created_at`).catch(() => []),
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

      // Newest of: login, last telemetry log, last device-control action.
      const lastActiveAt = this._maxTimestamp([
        p.last_login_at,
        lastLog?.[0]?.logged_at,
        lastDevLog?.[0]?.created_at,
      ]);

      // Build line + company (if present). We pull battery_capacity_ah and
      // the leveling dimensions on the build line so the vehicle rows can show
      // the effective value hierarchy (vehicle override > build line > unset).
      let buildLineLabel = '—';
      let buildLineBatteryAh = null;
      let buildLineWheelbase = null;
      let buildLineTrack = null;
      let companyLabel = '—';
      if (v?.build_line_id) {
        try {
          const bls = await supa(`build_lines?id=eq.${v.build_line_id}&select=name,company_id,battery_capacity_ah,wheelbase_inches,track_width_inches`);
          if (bls[0]) {
            buildLineLabel = bls[0].name;
            buildLineBatteryAh = bls[0].battery_capacity_ah ?? null;
            buildLineWheelbase = bls[0].wheelbase_inches ?? null;
            buildLineTrack = bls[0].track_width_inches ?? null;
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

      this._render({ profile: p, sub, vehicle: v, lastActiveAt, buildLineLabel, buildLineBatteryAh, buildLineWheelbase, buildLineTrack, companyLabel });

      if (v) {
        this._initLogsSection();
      }
    } catch (e) {
      console.error('User detail load failed:', e);
      if (contentEl) contentEl.innerHTML = `<div class="data-empty">Failed to load — ${escHtml(e.message || '')}</div>`;
    }
  },

  _render({ profile, sub, vehicle, lastActiveAt, buildLineLabel, buildLineBatteryAh, buildLineWheelbase, buildLineTrack, companyLabel }) {
    const contentEl = document.getElementById('userDetailContent');
    if (!contentEl) return;

    // Stash the vehicle + build-line context so the inline battery + dimension
    // edit handlers can reference them without re-fetching.
    this._vehicle = vehicle || null;
    this._buildLineBatteryAh = (buildLineBatteryAh != null) ? buildLineBatteryAh : null;
    this._buildLineWheelbase = (buildLineWheelbase != null) ? buildLineWheelbase : null;
    this._buildLineTrack = (buildLineTrack != null) ? buildLineTrack : null;

    const tier = sub?.tier || 'base_camp';

    contentEl.innerHTML = `
      <div class="page-title-row">
        <div class="page-title-block">
          <div class="page-title">${escHtml(this.userName)}</div>
          <div class="page-subtitle t-muted">${escHtml(this.userEmail || '')}</div>
        </div>
        <div>${tierBadge(tier)}</div>
      </div>

      <div class="info-grid">
        <div class="info-card">
          <div class="info-card-title">ACCOUNT INFO</div>
          ${this._infoLine('User ID', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all">${escHtml(this.userId)}</span>`)}
          ${this._infoLine('Joined', escHtml(formatDate(profile.created_at)))}
          ${this._infoLine('Last active', escHtml(lastActiveAt ? timeAgo(lastActiveAt) : 'Never'))}
          ${this._infoLine('Company', escHtml(companyLabel))}
        </div>

        <div class="info-card">
          <div class="info-card-title">VEHICLE INFO</div>
          ${vehicle ? `
            ${this._infoLine('Make', escHtml(vehicle.make || '—'))}
            ${this._infoLine('Model', escHtml(vehicle.model || '—'))}
            ${this._infoLine('Year', escHtml(String(vehicle.year || '—')))}
            ${this._infoLine('Build line', escHtml(buildLineLabel))}
            ${this._renderBatteryRow(vehicle, buildLineBatteryAh)}
            ${this._renderDimensionsRow(vehicle, buildLineWheelbase, buildLineTrack)}
            ${this._infoLine('Nickname', escHtml(vehicle.nickname || vehicle.name || '—'))}
            ${this._infoLine('VIN', escHtml(vehicle.vin || '—'))}
            ${this._infoLine('Cerbo IP', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_ip || '—')}</span>`)}
            ${this._infoLine('Cerbo portal ID', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escHtml(vehicle.cerbo_portal_id || '—')}</span>`)}
          ` : `<div class="t-muted t-detail" style="padding:8px 0">No vehicle registered.</div>`}
        </div>

        <div class="info-card">
          <div class="info-card-title">SUBSCRIPTION</div>
          ${this._infoLine('Tier', tierBadge(tier))}
          ${this._infoLine('Status', escHtml(sub?.status || '—'))}
          ${this._infoLine('Platform', escHtml(this._platformLabel(sub?.platform)))}
          ${this._infoLine('Started', escHtml(sub?.started_at ? formatDate(sub.started_at) : '—'))}
          ${this._infoLine('Renews', escHtml(sub?.current_period_end ? formatDate(sub.current_period_end) : '—'))}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Account actions</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">Change subscription tier or remove the account entirely.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('explore')">Set Explorer</button>
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.changeTier('base_camp')">Set Base Camp</button>
          <button class="btn btn-ghost btn-sm t-danger" onclick="UserDetailPage.deleteUser()">Delete user</button>
        </div>
      </div>

      ${vehicle ? this._renderTripsCard() : ''}
      ${vehicle ? this._renderDrivingEventsCard() : ''}
      ${vehicle ? this._renderDeviceControlLogsCard() : ''}
      ${vehicle ? this._renderLogsCard() : ''}
    `;
  },

  // Normalize the subscription platform for display. We moved off Stripe
  // to Apple in-app subscriptions, so legacy 'stripe' rows are stale
  // billing-provider tags, not live Stripe subs — all active billing now
  // runs through the App Store. 'admin' stays distinct so manually-comped
  // accounts (set via the buttons below) are obvious. Change the stripe
  // fallback to '—' or 'Legacy' here if you'd rather not normalize it.
  // Return the newest of a set of ISO timestamps (ignores null/blank).
  // Used to derive "Last active" from whichever signal is freshest.
  _maxTimestamp(values) {
    const valid = (values || []).filter(Boolean);
    if (!valid.length) return null;
    return valid.reduce((newest, t) =>
      (new Date(t).getTime() > new Date(newest).getTime() ? t : newest)
    );
  },

  _platformLabel(platform) {
    if (!platform) return '—';
    switch (String(platform).toLowerCase()) {
      case 'app_store':
      case 'appstore':
      case 'apple':
      case 'ios':
      case 'storekit':
        return 'App Store';
      case 'admin':
      case 'manual':
        return 'Admin (manual)';
      case 'stripe':
      default:
        return 'App Store';
    }
  },

  _infoLine(label, value) {
    return `
      <div class="info-line">
        <span class="info-line-label">${escHtml(label)}</span>
        <span class="info-line-value">${value || '—'}</span>
      </div>
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

  // ═══════════════════════════════════════════════════════════════════════
  // BATTERY CAPACITY ROW + INLINE EDIT (per-vehicle override)
  // ═══════════════════════════════════════════════════════════════════════
  // Effective value = vehicle.battery_capacity_ah ?? build_line.battery_capacity_ah
  // The iPad's BatteryCapacityLearner mirrors this hierarchy: vehicle
  // override wins, otherwise build line default, otherwise observation.

  _renderBatteryRow(vehicle, buildLineAh) {
    const vehicleAh = (vehicle.battery_capacity_ah != null) ? vehicle.battery_capacity_ah : null;
    const effectiveAh = vehicleAh ?? buildLineAh ?? null;

    const valueText = effectiveAh != null
      ? `${effectiveAh} Ah`
      : '<span class="t-muted">Not set</span>';

    // Sub-label distinguishes the three states. Helps builders see "this
    // customer is on a non-stock spec."
    let subLabel = '';
    if (vehicleAh != null && buildLineAh != null && vehicleAh !== buildLineAh) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Override · build line default: ${buildLineAh} Ah</div>`;
    } else if (vehicleAh != null && buildLineAh == null) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Custom · no build line default</div>`;
    } else if (vehicleAh == null && buildLineAh != null) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Inherited from build line</div>`;
    }

    return `
      <div class="info-line" id="batteryInfoRow" style="align-items:flex-start">
        <span class="info-line-label">Battery</span>
        <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:0">
          <span style="display:flex;align-items:center;gap:8px">
            <span>${valueText}</span>
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:12px" onclick="UserDetailPage.editBattery()">Edit</button>
          </span>
          ${subLabel}
        </span>
      </div>
    `;
  },

  editBattery() {
    const row = document.getElementById('batteryInfoRow');
    if (!row) return;
    const currentAh = (this._vehicle && this._vehicle.battery_capacity_ah != null)
      ? this._vehicle.battery_capacity_ah
      : '';
    const blAh = this._buildLineBatteryAh;
    const placeholder = (blAh != null) ? `Build line default: ${blAh}` : 'e.g. 600';

    row.innerHTML = `
      <span class="info-line-label">Battery</span>
      <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span style="display:flex;align-items:center;gap:8px">
          <input id="batteryEditInput" type="number" min="0" step="1" value="${escHtml(String(currentAh))}"
                 placeholder="${escHtml(placeholder)}"
                 style="width:110px;padding:4px 8px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-default);color:var(--text-primary);font-size:13px;text-align:right">
          <span class="t-muted t-detail" style="font-size:13px">Ah</span>
          <button class="btn btn-primary btn-sm" style="padding:4px 12px;font-size:12px" onclick="UserDetailPage.saveBattery()">Save</button>
          <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:12px" onclick="UserDetailPage._reloadBatteryRow()">Cancel</button>
        </span>
        <span class="t-muted t-detail" style="font-size:11px">
          ${blAh != null
            ? `Leave blank to inherit build line default (${blAh} Ah)`
            : 'Build line has no default. Leave blank to let the iPad learn from observation.'}
        </span>
      </span>
    `;

    const input = document.getElementById('batteryEditInput');
    if (input) { input.focus(); input.select(); }
  },

  async saveBattery() {
    if (!this.vehicleId) {
      alert('No vehicle for this user — nothing to update.');
      return;
    }
    const input = document.getElementById('batteryEditInput');
    if (!input) return;

    const raw = (input.value || '').trim();
    let newValue;
    if (raw === '') {
      newValue = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        alert('Battery capacity must be a positive whole number (Ah), or empty to clear.');
        return;
      }
      newValue = n;
    }

    try {
      await supaPatch(`vehicles?id=eq.${this.vehicleId}`, {
        battery_capacity_ah: newValue,
        updated_at: new Date().toISOString(),
      });

      if (this._vehicle) this._vehicle.battery_capacity_ah = newValue;
      this._reloadBatteryRow();
    } catch (e) {
      alert(`Failed to update battery: ${e.message || e}`);
    }
  },

  _reloadBatteryRow() {
    const row = document.getElementById('batteryInfoRow');
    if (!row) return;
    const newMarkup = this._renderBatteryRow(this._vehicle, this._buildLineBatteryAh);
    row.outerHTML = newMarkup;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LEVELING DIMENSIONS ROW + INLINE EDIT (per-vehicle override)
  // ═══════════════════════════════════════════════════════════════════════
  // Effective value = vehicle.<dim> ?? build_line.<dim>. The iPad's
  // LevelService mirrors this: vehicle override wins, else build line default,
  // else the app's Sprinter fallback (144" / 67").

  _renderDimensionsRow(vehicle, blWheelbase, blTrack) {
    const vWb = (vehicle.wheelbase_inches != null) ? vehicle.wheelbase_inches : null;
    const vTr = (vehicle.track_width_inches != null) ? vehicle.track_width_inches : null;
    const effWb = vWb ?? blWheelbase ?? null;
    const effTr = vTr ?? blTrack ?? null;

    const fmt = (n) => (n != null ? `${(+n % 1 === 0) ? n : (+n).toFixed(1)}"` : '—');
    const valueText = (effWb != null || effTr != null)
      ? `WB ${fmt(effWb)} · Track ${fmt(effTr)}`
      : '<span class="t-muted">Not set</span>';

    // Sub-label distinguishes override / inherited / custom states.
    const hasOverride = (vWb != null || vTr != null);
    const hasBL = (blWheelbase != null || blTrack != null);
    let subLabel = '';
    if (hasOverride && hasBL) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Override · build line default: WB ${fmt(blWheelbase)} · Track ${fmt(blTrack)}</div>`;
    } else if (hasOverride && !hasBL) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Custom · no build line default</div>`;
    } else if (!hasOverride && hasBL) {
      subLabel = `<div class="t-muted t-detail" style="font-size:11px;margin-top:2px">Inherited from build line</div>`;
    }

    return `
      <div class="info-line" id="dimsInfoRow" style="align-items:flex-start">
        <span class="info-line-label">Dimensions</span>
        <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:0">
          <span style="display:flex;align-items:center;gap:8px">
            <span>${valueText}</span>
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:12px" onclick="UserDetailPage.editDimensions()">Edit</button>
          </span>
          ${subLabel}
        </span>
      </div>
    `;
  },

  editDimensions() {
    const row = document.getElementById('dimsInfoRow');
    if (!row) return;
    const v = this._vehicle || {};
    const curWb = (v.wheelbase_inches != null) ? v.wheelbase_inches : '';
    const curTr = (v.track_width_inches != null) ? v.track_width_inches : '';
    const blWb = this._buildLineWheelbase;
    const blTr = this._buildLineTrack;
    const wbPlaceholder = (blWb != null) ? `Default: ${blWb}` : 'e.g. 144';
    const trPlaceholder = (blTr != null) ? `Default: ${blTr}` : 'e.g. 67';

    const inputStyle = 'width:84px;padding:4px 8px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-default);color:var(--text-primary);font-size:13px;text-align:right';

    row.innerHTML = `
      <span class="info-line-label">Dimensions</span>
      <span class="info-line-value" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <span class="t-muted t-detail" style="font-size:12px">WB</span>
          <input id="dimWbInput" type="number" min="40" max="400" step="0.1" value="${escHtml(String(curWb))}"
                 placeholder="${escHtml(wbPlaceholder)}" style="${inputStyle}">
          <span class="t-muted t-detail" style="font-size:12px">Track</span>
          <input id="dimTrInput" type="number" min="30" max="120" step="0.1" value="${escHtml(String(curTr))}"
                 placeholder="${escHtml(trPlaceholder)}" style="${inputStyle}">
          <span class="t-muted t-detail" style="font-size:13px">in</span>
          <button class="btn btn-primary btn-sm" style="padding:4px 12px;font-size:12px" onclick="UserDetailPage.saveDimensions()">Save</button>
          <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:12px" onclick="UserDetailPage._reloadDimensionsRow()">Cancel</button>
        </span>
        <span class="t-muted t-detail" style="font-size:11px">
          ${(blWb != null || blTr != null)
            ? `Leave blank to inherit build line default (WB ${blWb ?? '—'} · Track ${blTr ?? '—'})`
            : 'Build line has no default. Leave blank to use the app default (Sprinter 144" / 67").'}
        </span>
      </span>
    `;
    const wb = document.getElementById('dimWbInput');
    if (wb) { wb.focus(); wb.select(); }
  },

  async saveDimensions() {
    if (!this.vehicleId) {
      alert('No vehicle for this user — nothing to update.');
      return;
    }
    const wbInput = document.getElementById('dimWbInput');
    const trInput = document.getElementById('dimTrInput');
    if (!wbInput || !trInput) return;

    const parse = (raw, min, max, name) => {
      const s = (raw || '').trim();
      if (s === '') return { ok: true, value: null };
      const n = Number(s);
      if (!Number.isFinite(n) || n < min || n > max) {
        return { ok: false, error: `${name} must be between ${min} and ${max} inches, or blank to inherit.` };
      }
      return { ok: true, value: n };
    };

    const wb = parse(wbInput.value, 40, 400, 'Wheelbase');
    if (!wb.ok) { alert(wb.error); return; }
    const tr = parse(trInput.value, 30, 120, 'Track width');
    if (!tr.ok) { alert(tr.error); return; }

    try {
      await supaPatch(`vehicles?id=eq.${this.vehicleId}`, {
        wheelbase_inches: wb.value,
        track_width_inches: tr.value,
        updated_at: new Date().toISOString(),
      });
      if (this._vehicle) {
        this._vehicle.wheelbase_inches = wb.value;
        this._vehicle.track_width_inches = tr.value;
      }
      this._reloadDimensionsRow();
    } catch (e) {
      alert(`Failed to update dimensions: ${e.message || e}`);
    }
  },

  _reloadDimensionsRow() {
    const row = document.getElementById('dimsInfoRow');
    if (!row) return;
    const newMarkup = this._renderDimensionsRow(this._vehicle, this._buildLineWheelbase, this._buildLineTrack);
    row.outerHTML = newMarkup;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DRIVING EVENTS (harsh-driving records from the WT901 motion detector)
  // ═══════════════════════════════════════════════════════════════════════
  // Rows arrive via the Cerbo level bridge (v1.3+) -> log-motion-event Edge
  // Function -> device_control_logs (device_key='motion_sensor',
  // device_category='safety', source='system'). The value payload carries
  // the full event record (peak_g, duration_ms, raw axis data, event_id).
  // Builders use these as supporting evidence for insurance claims, so the
  // section leads with the summary and renders generously: peak g, duration,
  // and both clocks live in the row tooltip.

  _motionDays: '30',

  _motionActionLabel(action) {
    return ({
      hard_brake: 'Hard braking',
      hard_accel: 'Hard acceleration',
      hard_corner: 'Hard cornering',
      harsh_motion: 'Harsh motion',
    })[action] || action || '—';
  },

  _motionSeverityBadge(severity) {
    const s = severity || 'moderate';
    const cls = s === 'extreme' ? 'badge--severity-extreme'
              : s === 'harsh' ? 'badge--severity-harsh'
              : 'badge--severity-moderate';
    return `<span class="badge ${cls}" style="font-size:10px">${escHtml(s)}</span>`;
  },

  // ── Trips ─────────────────────────────────────────────────────────────
  // Recorded drives for this customer: GPS route + battery/solar/alternator
  // captured along the way. Grouped by day; selecting a trip replays its
  // route on a Leaflet map. Reads the `trips` / `trip_points` tables the iPad
  // recorder writes. Trips are user_id-scoped today (no vehicle_id column yet),
  // so this keys on the customer's user_id like the other activity sections.
  _renderTripsCard() {
    return `
      <div class="card">
        <div class="card-title">Trips</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          Recorded drives — GPS route plus battery, solar, and alternator data
          captured along the way. Pick a day to see that day's trips, then tap a
          trip to replay its route on the map.
        </div>
        <div class="logs-filter-row" style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Day</label>
            <select id="userTripDay" onchange="UserDetailPage.renderTripsForDay()">
              <option value="">Loading…</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.loadTrips()">Refresh</button>
        </div>
        <div id="userTripsSummary"></div>
        <div id="userTripsContent">
          <div class="t-muted t-detail">Loading trips…</div>
        </div>
        <div id="userTripMapWrap" style="display:none;margin-top:16px">
          <div class="t-muted t-detail" style="margin-bottom:8px;font-size:11px">Route colored by speed — tap any point for exact mph + time.</div>
          <div id="userTripMap" style="height:340px;border-radius:8px;overflow:hidden;border:1px solid var(--border-subtle)"></div>
          ${tripSpeedLegendHtml()}
        </div>
      </div>
    `;
  },

  async loadTrips() {
    const contentEl = document.getElementById('userTripsContent');
    const dayEl = document.getElementById('userTripDay');
    if (!contentEl) return;
    contentEl.innerHTML = '<div class="t-muted t-detail">Loading trips…</div>';
    try {
      const trips = await supa(
        `trips?user_id=eq.${this.userId}` +
        `&order=started_at.desc&limit=500` +
        `&select=id,started_at,ended_at,distance_km,duration_seconds,avg_speed_kmh,max_speed_kmh,start_location_name,end_location_name,point_count`
      );
      this._trips = trips || [];

      // Group by the viewer's local calendar day (we don't store the driver's
      // timezone; local grouping matches how the builder reads the page).
      this._tripsByDay = {};
      for (const t of this._trips) {
        const key = this._tripDayKey(t.started_at);
        if (!key) continue;
        (this._tripsByDay[key] = this._tripsByDay[key] || []).push(t);
      }

      const days = Object.keys(this._tripsByDay).sort().reverse();
      if (dayEl) {
        dayEl.innerHTML = days.length === 0
          ? '<option value="">No trips</option>'
          : days.map((d) => {
              const n = this._tripsByDay[d].length;
              return `<option value="${d}">${escHtml(this._tripDayLabel(d))} · ${n} trip${n > 1 ? 's' : ''}</option>`;
            }).join('');
      }
      this.renderTripsForDay();
    } catch (e) {
      console.error('Trips load failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load trips — ${escHtml(e.message || '')}</div>`;
    }
  },

  renderTripsForDay() {
    const contentEl = document.getElementById('userTripsContent');
    const summaryEl = document.getElementById('userTripsSummary');
    const dayEl = document.getElementById('userTripDay');
    if (!contentEl) return;

    // Hide the map when switching days so a stale route isn't shown.
    const mapWrap = document.getElementById('userTripMapWrap');
    if (mapWrap) mapWrap.style.display = 'none';

    const day = dayEl && dayEl.value ? dayEl.value : '';
    const trips = (this._tripsByDay && this._tripsByDay[day]) ? this._tripsByDay[day] : [];

    if (trips.length === 0) {
      if (summaryEl) summaryEl.innerHTML = '';
      contentEl.innerHTML = '<div class="t-muted t-detail">No trips recorded for this day.</div>';
      return;
    }

    const totalKm = trips.reduce((s, t) => s + (t.distance_km || 0), 0);
    const totalSec = trips.reduce((s, t) => s + (t.duration_seconds || 0), 0);
    const chip = (label, val) => `
      <div style="padding:8px 14px;border:1px solid var(--border-subtle);border-radius:8px">
        <div class="t-muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${label}</div>
        <div style="font-weight:600;font-size:16px">${val}</div>
      </div>`;
    if (summaryEl) summaryEl.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        ${chip('Trips', trips.length)}
        ${chip('Miles', (totalKm * 0.621371).toFixed(1))}
        ${chip('Drive time', this._fmtTripDur(totalSec))}
      </div>`;

    const cell = (content, style = '') =>
      `<td style="padding:8px 10px;border-top:1px solid var(--border-subtle);${style}">${content}</td>`;
    const rows = trips.map((t) => {
      const miles = t.distance_km != null ? (t.distance_km * 0.621371).toFixed(1) + ' mi' : '—';
      const dur = this._fmtTripDur(t.duration_seconds);
      const time = t.started_at
        ? new Date(t.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '—';
      const route = `${escHtml(t.start_location_name || '—')} → ${escHtml(t.end_location_name || '—')}`;
      return `
        <tr style="cursor:pointer" onclick="UserDetailPage.showTripRoute('${t.id}')">
          ${cell(`<span style="font-weight:600">${time}</span>`, 'white-space:nowrap')}
          ${cell(`<span class="t-muted">${route}</span>`)}
          ${cell(miles, 'white-space:nowrap')}
          ${cell(dur, 'white-space:nowrap')}
          ${cell(`<span class="t-muted">${t.point_count != null ? t.point_count : '—'} pts</span>`, 'white-space:nowrap')}
        </tr>`;
    }).join('');

    contentEl.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr class="t-muted" style="text-align:left;font-size:11px;text-transform:uppercase">
              <th style="padding:6px 10px">Start</th>
              <th style="padding:6px 10px">Route</th>
              <th style="padding:6px 10px">Distance</th>
              <th style="padding:6px 10px">Duration</th>
              <th style="padding:6px 10px">Points</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="t-muted t-detail" style="margin-top:8px;font-size:11px">Tap a trip to replay its route on the map.</div>`;
  },

  async showTripRoute(tripId) {
    const mapWrap = document.getElementById('userTripMapWrap');
    const mapEl = document.getElementById('userTripMap');
    if (!mapWrap || !mapEl || typeof L === 'undefined') return;
    mapWrap.style.display = 'block';

    // Lazily create the Leaflet map; reuse it across trip selections.
    if (!this._tripMap) {
      this._tripMap = L.map(mapEl, { zoomControl: true });
      // OpenStreetMap is the only tile host allowed by the site CSP
      // (img-src in vercel.json). Other tile providers render blank here.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(this._tripMap);
    }
    // Clear the previous route's layers.
    if (this._tripLayers) this._tripLayers.forEach((l) => this._tripMap.removeLayer(l));
    this._tripLayers = [];

    try {
      // Page past the 1000-row API cap so long trips draw in full.
      const points = await supaAll(
        `trip_points?trip_id=eq.${tripId}` +
        `&order=timestamp.asc` +
        `&select=latitude,longitude,speed,timestamp`
      );
      if (!points || points.length === 0) {
        this._tripMap.setView([39.5, -98.35], 4); // continental US fallback
        setTimeout(() => this._tripMap.invalidateSize(), 50);
        return;
      }

      // Speed-graded route + tappable per-interval speed points.
      this._tripLayers = drawTripRoute(this._tripMap, points);
      // Leaflet mis-sizes when its container was display:none at creation, so
      // invalidate once it's visible.
      setTimeout(() => this._tripMap.invalidateSize(), 50);
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      console.error('Trip route load failed:', e);
    }
  },

  // 'YYYY-MM-DD' in the viewer's local timezone (falls back to the raw ISO
  // date slice if the timestamp can't be parsed).
  _tripDayKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  _tripDayLabel(key) {
    const [y, m, day] = key.split('-').map(Number);
    if (!y || !m || !day) return key;
    const date = new Date(y, m - 1, day);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - date) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (date.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(undefined, opts);
  },

  _fmtTripDur(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },

  _renderDrivingEventsCard() {
    return `
      <div class="card">
        <div class="card-title">Driving Events</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          Harsh braking, acceleration, and cornering detected by the vehicle's
          motion sensor — timestamped records builders can reference as
          supporting evidence for insurance claims. Events are written once
          and never edited. Requires the level sensor bridge v1.3+.
        </div>
        <div class="logs-filter-row" style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Range</label>
            <select id="userMotionRange" onchange="UserDetailPage.loadMotionEvents()">
              <option value="7">Last 7 days</option>
              <option value="30" selected>Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="UserDetailPage.loadMotionEvents()">Refresh</button>
        </div>
        <div id="userMotionContent">
          <div class="t-muted t-detail">Loading driving events…</div>
        </div>
      </div>
    `;
  },

  async loadMotionEvents() {
    const contentEl = document.getElementById('userMotionContent');
    if (!contentEl) return;
    const rangeEl = document.getElementById('userMotionRange');
    const days = parseInt(rangeEl?.value || this._motionDays, 10) || 30;
    this._motionDays = String(days);

    contentEl.innerHTML = '<div class="t-muted t-detail">Loading driving events…</div>';
    try {
      const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
      const rows = await supa(
        `device_control_logs?user_id=eq.${this.userId}` +
        `&device_category=eq.safety&device_key=eq.motion_sensor` +
        `&occurred_at=gte.${encodeURIComponent(sinceISO)}` +
        `&order=occurred_at.desc&limit=500` +
        `&select=occurred_at,action,value,created_at`
      );
      // Stash for paginated rendering; reset to page 1 on every fresh fetch
      // so a range change always lands the user on the first (newest) page.
      this._motionEvents = rows || [];
      this._motionPage = 1;
      this._renderMotionContent(days);
    } catch (e) {
      console.error('Driving events load failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load driving events — ${escHtml(e.message || '')}</div>`;
    }
  },

  _renderMotionContent(days) {
    const contentEl = document.getElementById('userMotionContent');
    if (!contentEl) return;

    const rows = this._motionEvents;

    if (rows.length === 0) {
      contentEl.innerHTML = `
        <div class="t-muted t-detail">
          No harsh-driving events in the last ${days} days.
          <div style="margin-top:6px;font-size:11px">
            Events are detected by the leveling sensor's accelerometer and
            uploaded by the Cerbo. If this vehicle should be reporting and
            isn't, confirm the level bridge is v1.3+ and the sensor's output
            rate is set to 10 Hz.
          </div>
        </div>`;
      return;
    }

    // Summary always reflects the FULL result set, not the current page —
    // page-scoped counts would mislead anyone reading the chips for a
    // quick incident gut-check.
    let harsh = 0, extreme = 0, worst = null;
    for (const r of rows) {
      const v = r.value || {};
      if (v.severity === 'harsh') harsh++;
      if (v.severity === 'extreme') extreme++;
      if (!worst || (v.peak_g || 0) > (worst.value?.peak_g || 0)) worst = r;
    }
    const chip = (label, val, color) => `
      <div style="padding:8px 14px;border:1px solid var(--border-subtle);border-radius:8px">
        <div class="t-muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${label}</div>
        <div style="font-weight:600;font-size:16px;color:${color || 'var(--text-primary)'}">${val}</div>
      </div>`;
    const summary = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        ${chip(`Events · ${days}d`, rows.length)}
        ${chip('Harsh', harsh, harsh ? 'var(--warning)' : null)}
        ${chip('Extreme', extreme, extreme ? 'var(--danger)' : null)}
        ${chip('Worst', worst?.value?.peak_g ? `${worst.value.peak_g.toFixed(2)} g` : '—',
               extreme ? 'var(--danger)' : null)}
      </div>`;

    // Page slice — mirrors _renderDevLogsPage so behavior is identical
    // across the two activity sections on this page.
    const total = rows.length;
    const perPage = this._motionPerPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, this._motionPage), totalPages);
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageRows = rows.slice(startIdx, endIdx);

    const cell = (content, color = 'var(--text-primary)', style = '') =>
      `<td style="padding:6px 10px;white-space:nowrap;color:${color};border-top:1px solid var(--border-subtle);${style}">${content}</td>`;

    const body = pageRows.map((r) => {
      const v = r.value || {};
      const dur = v.duration_ms != null ? `${(v.duration_ms / 1000).toFixed(1)} s` : '—';
      const peak = v.peak_g != null ? `${v.peak_g.toFixed(2)} g` : '—';
      // Both clocks in the tooltip — device event time vs server receipt —
      // exactly the provenance question an adjuster asks first.
      const tip = `device: ${v.occurred_at || r.occurred_at} · received: ${r.created_at || '—'}`
        + (v.event_id ? ` · id: ${v.event_id}` : '');
      return `
        <tr title="${escHtml(tip)}">
          ${cell(formatDateTime(r.occurred_at), 'var(--text-secondary)', 'font-size:11px')}
          ${cell(`<span style="font-weight:500">${escHtml(this._motionActionLabel(r.action))}</span>`)}
          ${cell(this._motionSeverityBadge(v.severity))}
          ${cell(peak, 'var(--text-primary)', 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px')}
          ${cell(dur, 'var(--text-secondary)', 'font-size:11px')}
        </tr>`;
    }).join('');

    const head = (t) => `<th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-secondary)">${t}</th>`;

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToMotionPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="t-muted" style="padding:0 8px">Page ${page} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToMotionPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      </div>
    ` : '';

    contentEl.innerHTML = `
      ${summary}
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>${head('Time')}${head('Event')}${head('Severity')}${head('Peak')}${head('Duration')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${pagination}`;
  },

  _goToMotionPage(page) {
    const totalPages = Math.ceil(this._motionEvents.length / this._motionPerPage);
    this._motionPage = Math.max(1, Math.min(totalPages, page));
    // We need to know `days` for the summary chip label; re-derive it from
    // the dropdown so a Refresh-then-paginate sequence stays consistent
    // with what the user picked.
    const rangeEl = document.getElementById('userMotionRange');
    const days = parseInt(rangeEl?.value || this._motionDays, 10) || 30;
    this._renderMotionContent(days);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DEVICE CONTROL LOGS (manual switch / scene activation events)
  // ═══════════════════════════════════════════════════════════════════════

  _renderDeviceControlLogsCard() {
    const today = localDate();
    const weekAgo = localDate(new Date(Date.now() - 7 * 86400000));
    return `
      <div class="card">
        <div class="card-title">Device Activity</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          User-triggered switch flips, scene activations, ArcRemote (iPhone)
          commands, and remediation actions. Use this to troubleshoot "did the
          fan ever come on last night?" or spot patterns in how a client is
          using their build.
        </div>
        <div class="logs-filter-row" style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Start</label>
            <input type="date" id="userDevLogStart" value="${weekAgo}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>End</label>
            <input type="date" id="userDevLogEnd" value="${today}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Category</label>
            <select id="userDevLogCategory">
              <option value="">All</option>
              <option value="climate">Climate</option>
              <option value="heating">Heating</option>
              <option value="rooftop">Rooftop</option>
              <option value="exterior">Exterior</option>
              <option value="interior">Interior</option>
              <option value="media">Media</option>
              <option value="power">Power</option>
              <option value="safety">Safety</option>
              <option value="scene">Scenes</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Source</label>
            <select id="userDevLogSource">
              <option value="">All</option>
              <option value="manual">Manual tap (iPad)</option>
              <option value="remote">Remote (iPhone)</option>
              <option value="scene">Scene</option>
              <option value="schedule">Schedule</option>
              <option value="bedtime">Bedtime</option>
              <option value="alert">Alert</option>
              <option value="system">System</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm" id="userLoadDevLogsBtn" onclick="UserDetailPage.loadDeviceControlLogs()">Load Activity</button>
        </div>
        <div id="userDevLogsContent">
          <div class="t-muted t-detail">Pick a date range and click <strong>Load Activity</strong>.</div>
        </div>
      </div>
    `;
  },

  async loadDeviceControlLogs() {
    const startInput = document.getElementById('userDevLogStart');
    const endInput = document.getElementById('userDevLogEnd');
    const catInput = document.getElementById('userDevLogCategory');
    const srcInput = document.getElementById('userDevLogSource');
    const btn = document.getElementById('userLoadDevLogsBtn');
    const contentEl = document.getElementById('userDevLogsContent');
    if (!startInput || !endInput || !btn || !contentEl) return;

    const start = startInput.value;
    const end = endInput.value;
    if (!start || !end) {
      contentEl.innerHTML = '<div class="t-danger t-detail">Pick a start and end date.</div>';
      return;
    }

    this._devLogsFilters = {
      category: catInput?.value || '',
      action: '',
      source: srcInput?.value || '',
    };

    btn.textContent = 'Loading...';
    btn.disabled = true;
    contentEl.innerHTML = '<div class="t-muted t-detail">Fetching device activity...</div>';

    try {
      const startISO = localDateToUTCStart(start);
      const endISO = localDateToUTCEnd(end);

      const filters = [
        `user_id=eq.${this.userId}`,
        `occurred_at=gte.${startISO}`,
        `occurred_at=lte.${endISO}`,
      ];
      if (this._devLogsFilters.category) {
        filters.push(`device_category=eq.${encodeURIComponent(this._devLogsFilters.category)}`);
      }
      if (this._devLogsFilters.source) {
        filters.push(`source=eq.${encodeURIComponent(this._devLogsFilters.source)}`);
      }

      const url = `device_control_logs?${filters.join('&')}&order=occurred_at.desc&limit=5000&select=*`;
      const logs = await supa(url);

      this._devLogs = logs;
      this._devLogsPage = 1;
      this._devLogsDateRange = { start, end };

      if (logs.length === 0) {
        contentEl.innerHTML = `
          <div class="t-muted t-detail" style="padding:12px;background:var(--bg-muted);border-radius:8px">
            No device activity logged from ${escHtml(start)} to ${escHtml(end)}.
            <div style="margin-top:6px;font-size:11px">
              Activity is emitted by the ArcNode iPad app and by ArcRemote
              (iPhone) commands. If this client has the latest app and you
              still see nothing, they may not have toggled any devices in
              this window.
            </div>
          </div>
        `;
      } else {
        this._renderDevLogsPage();
      }
    } catch (e) {
      console.error('[Device Activity] fetch failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load — ${escHtml(e.message || '')}</div>`;
    }

    btn.textContent = 'Load Activity';
    btn.disabled = false;
  },

  _renderDevLogsPage() {
    const contentEl = document.getElementById('userDevLogsContent');
    if (!contentEl) return;

    const logs = this._devLogs;
    const total = logs.length;
    const perPage = this._devLogsPerPage;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(Math.max(1, this._devLogsPage), totalPages);
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageRows = logs.slice(startIdx, endIdx);

    const counts = {};
    for (const l of logs) {
      const key = l.device_name || l.device_key || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
    const topDevices = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topMarkup = topDevices.length > 0 ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        ${topDevices.map(([name, count]) => `
          <div style="padding:6px 10px;background:var(--brand-primary-10,rgba(118,123,251,0.08));border:1px solid var(--brand-primary);border-radius:999px;font-size:12px;color:var(--text-primary)">
            <span style="font-weight:500">${escHtml(name)}</span>
            <span class="t-muted" style="margin-left:4px">×${count}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

    const table = `
      <div style="overflow-x:auto;border:1px solid var(--border-default);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-muted);text-align:left">
              ${['Time','Device','Category','Action','Source','Value'].map((h) => `
                <th style="padding:8px 10px;font-weight:500;color:var(--text-dark);white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${h}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((l) => this._renderDevLogRow(l)).join('')}
          </tbody>
        </table>
      </div>
    `;

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToDevLogsPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="t-muted" style="padding:0 8px">Page ${page} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage._goToDevLogsPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} event${total === 1 ? '' : 's'} from ${this._devLogsDateRange.start} to ${this._devLogsDateRange.end}</div>`;

    contentEl.innerHTML = topMarkup + table + pagination;
  },

  // Source → badge. 'remote' gets a distinct purple phone pill so iPhone
  // actions stand out from iPad taps and scene runs at a glance. 'manual'
  // stays as quiet muted text (it's the overwhelming majority of rows).
  // Everything else keeps the neutral gray pill.
  _sourceBadge(source) {
    const s = source || 'manual';
    if (s === 'manual') {
      return `<span class="t-muted" style="font-size:11px">manual</span>`;
    }
    if (s === 'remote') {
      const phoneIcon = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;flex-shrink:0"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>`;
      return `<span class="badge badge--source-remote" style="font-size:10px">${phoneIcon}Remote</span>`;
    }
    return `<span class="badge badge--tier-base-camp" style="font-size:10px">${escHtml(s)}</span>`;
  },

  // Value → display text. iPad-logged values arrive as scalars or small
  // objects; remote rows carry the raw command payload from device_commands
  // (often a JSON string). Parse JSON strings so both render compactly, and
  // keep the full value in a tooltip when we truncate.
  _devLogValueText(value) {
    if (value == null) return { text: '—', full: '' };
    let text;
    try {
      let v = value;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try { v = JSON.parse(trimmed); } catch (_) { /* leave as string */ }
        }
      }
      text = (typeof v === 'string') ? v : JSON.stringify(v);
    } catch (_) {
      text = String(value);
    }
    const full = text;
    if (text.length > 60) text = text.slice(0, 57) + '…';
    return { text, full };
  },

  _renderDevLogRow(l) {
    const actionColors = {
      on: 'var(--success)',
      activate: 'var(--success)',
      off: 'var(--text-secondary)',
      deactivate: 'var(--text-secondary)',
      set: 'var(--brand-primary)',
    };
    const actionColor = actionColors[l.action] || 'var(--text-primary)';
    const sourceBadge = this._sourceBadge(l.source);
    const val = this._devLogValueText(l.value);

    const cell = (content, color = 'var(--text-primary)', style = '') =>
      `<td style="padding:6px 10px;white-space:nowrap;color:${color};border-top:1px solid var(--border-subtle);${style}">${content}</td>`;

    return `
      <tr>
        ${cell(formatDateTime(l.occurred_at), 'var(--text-secondary)', 'font-size:11px')}
        ${cell(`<span style="font-weight:500">${escHtml(l.device_name || l.device_key || '—')}</span>`)}
        ${cell(escHtml(l.device_category || '—'), 'var(--text-secondary)')}
        ${cell(`<span style="font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.04em">${escHtml(l.action || '—')}</span>`, actionColor)}
        ${cell(sourceBadge)}
        ${cell(`<span title="${escHtml(val.full)}" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px">${escHtml(val.text)}</span>`, 'var(--text-secondary)')}
      </tr>
    `;
  },

  _goToDevLogsPage(page) {
    const totalPages = Math.ceil(this._devLogs.length / this._devLogsPerPage);
    this._devLogsPage = Math.max(1, Math.min(totalPages, page));
    this._renderDevLogsPage();
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CERBO SYSTEM LOGS
  // ═══════════════════════════════════════════════════════════════════════

  _renderLogsCard() {
    const today = localDate();
    const weekAgo = localDate(new Date(Date.now() - 7 * 86400000));
    return `
      <div class="card">
        <div class="card-title">Victron Cerbo Telemetry</div>
        <div class="t-muted t-detail" style="margin-bottom:16px">
          Data logged from the vehicle's Cerbo GX via the ArcNode history server.
          Select a date range to load telemetry.
        </div>
        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>Start</label>
            <input type="date" id="userLogStart" value="${weekAgo}" max="${today}">
          </div>
          <div class="field" style="margin-bottom:0;flex:0 0 auto">
            <label>End</label>
            <input type="date" id="userLogEnd" value="${today}" max="${today}">
          </div>
          <button class="btn btn-primary btn-sm" id="userLoadLogsBtn" onclick="UserDetailPage.loadLogs()">Load Logs</button>
        </div>
        <div id="userLogsContent">
          <div class="t-muted t-detail">Select a date range and click Load Logs.</div>
        </div>
      </div>
    `;
  },

  _initLogsSection() {
    this._logs = [];
    this._page = 1;
    this._devLogs = [];
    this._devLogsPage = 1;
    this._motionEvents = [];
    this._motionPage = 1;
    this._trips = [];
    this._tripsByDay = {};
    // Driving events auto-load (small query, and builders come to this page
    // specifically for it when chasing an incident).
    this.loadMotionEvents();
    // Trips auto-load too — builders open a customer to review recent drives.
    this.loadTrips();
  },

  async loadLogs() {
    const startInput = document.getElementById('userLogStart');
    const endInput = document.getElementById('userLogEnd');
    const btn = document.getElementById('userLoadLogsBtn');
    const contentEl = document.getElementById('userLogsContent');
    if (!startInput || !endInput || !btn || !contentEl) return;

    const start = startInput.value;
    const end = endInput.value;
    if (!start || !end) {
      contentEl.innerHTML = '<div class="t-danger t-detail">Pick a start and end date.</div>';
      return;
    }

    btn.textContent = 'Loading...';
    btn.disabled = true;
    contentEl.innerHTML = '<div class="t-muted t-detail">Fetching logs...</div>';

    try {
      const logs = await this._fetchAllLogs(
        this.userId,
        localDateToUTCStart(start),
        localDateToUTCEnd(end)
      );

      this._logs = logs;
      this._page = 1;
      this._dateRange = { start, end };

      if (logs.length === 0) {
        contentEl.innerHTML = `<div class="t-muted t-detail">No log entries from ${escHtml(start)} to ${escHtml(end)}.</div>`;
      } else {
        this._renderLogsPage();
      }
    } catch (e) {
      console.error('[Logs] fetch failed:', e);
      contentEl.innerHTML = `<div class="t-danger t-detail">Failed to load logs — ${escHtml(e.message || '')}</div>`;
    }

    btn.textContent = 'Load Logs';
    btn.disabled = false;
  },

  async _fetchAllLogs(userId, startISO, endISO) {
    const batchSize = 1000;
    let all = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await supa(
        `system_logs?user_id=eq.${userId}&logged_at=gte.${startISO}&logged_at=lte.${endISO}&order=logged_at.asc&limit=${batchSize}&offset=${offset}`
      );
      all = all.concat(batch);
      if (batch.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
      if (all.length > 50000) {
        console.warn('[Logs] hit 50k cap, stopping fetch');
        hasMore = false;
      }
    }

    return all;
  },

  _renderLogsPage() {
    const contentEl = document.getElementById('userLogsContent');
    if (!contentEl) return;

    const logs = this._logs;
    const page = this._page;
    const perPage = this._perPage;
    const total = logs.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const startIdx = (page - 1) * perPage;
    const endIdx = Math.min(startIdx + perPage, total);
    const pageLogs = logs.slice(startIdx, endIdx);

    const perPageSelect = `
      <select onchange="UserDetailPage.setPerPage(parseInt(this.value))" style="padding:6px 10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:13px">
        <option value="50" ${perPage === 50 ? 'selected' : ''}>50 / page</option>
        <option value="100" ${perPage === 100 ? 'selected' : ''}>100 / page</option>
        <option value="250" ${perPage === 250 ? 'selected' : ''}>250 / page</option>
        <option value="500" ${perPage === 500 ? 'selected' : ''}>500 / page</option>
      </select>
    `;

    const pageButtons = this._buildPageButtons(page, totalPages);

    const pagination = totalPages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="t-muted t-detail">Showing ${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}</span>
          ${perPageSelect}
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(1)" ${page === 1 ? 'disabled' : ''} title="First">«</button>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>
          ${pageButtons}
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>
          <button class="btn btn-ghost btn-sm" onclick="UserDetailPage.goToPage(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last">»</button>
        </div>
      </div>
    ` : `<div class="t-muted t-detail" style="margin-top:12px">${total.toLocaleString()} entries from ${this._dateRange.start} to ${this._dateRange.end}</div>`;

    contentEl.innerHTML = this._renderLogsTable(pageLogs) + pagination;
  },

  _buildPageButtons(current, total) {
    const btn = (p) => `<button class="btn ${p === current ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="UserDetailPage.goToPage(${p})" style="min-width:32px;padding:4px 8px">${p}</button>`;
    const ellipsis = `<span class="t-muted" style="padding:0 4px">…</span>`;

    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1).map(btn).join('');
    }

    const pages = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

    let html = '';
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) html += ellipsis;
      html += btn(p);
      prev = p;
    }
    return html;
  },

  _renderLogsTable(logs) {
    return `
      <div style="overflow-x:auto;border:1px solid var(--border-default);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-muted);text-align:left">
              ${['Date','Time','Battery','Voltage','Solar','DC Load','AC Load','Fresh','Grey','Shore','Engine','Outside','Indoor','Outdoor','Humidity','Location']
                .map((h) => `<th style="padding:8px 10px;font-weight:500;color:var(--text-dark);white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${logs.map((l) => this._renderLogRow(l)).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  _renderLogRow(l) {
    const socColor = l.battery_soc == null ? 'var(--text-muted)'
      : l.battery_soc > 50 ? 'var(--success)'
      : l.battery_soc > 20 ? 'var(--warning, #E8A33B)'
      : 'var(--danger)';
    const fwColor = l.fresh_water_level == null ? 'var(--text-muted)'
      : l.fresh_water_level < 20 ? 'var(--danger)'
      : 'var(--text-primary)';
    const gwColor = l.grey_water_level == null ? 'var(--text-muted)'
      : l.grey_water_level > 80 ? 'var(--danger)'
      : 'var(--text-primary)';
    const dim = 'var(--text-secondary)';
    const primary = 'var(--text-primary)';

    const cell = (content, color = primary, style = '') =>
      `<td style="padding:6px 10px;white-space:nowrap;color:${color};border-top:1px solid var(--border-subtle);${style}">${content}</td>`;

    return `
      <tr>
        ${cell(formatDate(l.logged_at), dim, 'font-size:11px')}
        ${cell(formatTime(l.logged_at), dim, 'font-size:11px')}
        ${cell(`${(l.battery_soc || 0).toFixed(0)}%`, socColor, 'font-weight:500')}
        ${cell(`${(l.battery_voltage || 0).toFixed(1)}V`, primary)}
        ${cell(`${(l.solar_power || 0).toFixed(0)}W`, l.solar_power > 0 ? 'var(--success)' : dim)}
        ${cell(`${(l.dc_load_power || 0).toFixed(0)}W`, primary)}
        ${cell(`${(l.ac_load_power || 0).toFixed(0)}W`, primary)}
        ${cell(l.fresh_water_level != null ? `${l.fresh_water_level.toFixed(0)}%` : '—', fwColor)}
        ${cell(l.grey_water_level != null ? `${l.grey_water_level.toFixed(0)}%` : '—', gwColor)}
        ${cell(l.shore_connected ? '●' : '○', l.shore_connected ? 'var(--brand-primary)' : dim)}
        ${cell(l.engine_running ? '●' : '○', l.engine_running ? 'var(--success)' : dim)}
        ${cell(l.outside_temp != null ? `${l.outside_temp.toFixed(0)}°` : '—', primary)}
        ${cell(l.ruuvi_indoor_temp_f != null ? `${l.ruuvi_indoor_temp_f.toFixed(1)}°F` : '—', 'var(--brand-primary)')}
        ${cell(l.ruuvi_outdoor_temp_f != null ? `${l.ruuvi_outdoor_temp_f.toFixed(1)}°F` : '—', 'var(--success)')}
        ${cell(
          `${l.ruuvi_indoor_humidity != null ? l.ruuvi_indoor_humidity.toFixed(0) + '%' : '—'}${l.ruuvi_outdoor_humidity != null ? ' / ' + l.ruuvi_outdoor_humidity.toFixed(0) + '%' : ''}`,
          dim, 'font-size:11px'
        )}
        ${cell(l.latitude ? `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}` : '—', dim, 'font-size:11px')}
      </tr>
    `;
  },

  goToPage(page) {
    const totalPages = Math.ceil(this._logs.length / this._perPage);
    this._page = Math.max(1, Math.min(totalPages, page));
    this._renderLogsPage();
  },

  setPerPage(n) {
    this._perPage = n;
    this._page = 1;
    this._renderLogsPage();
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

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