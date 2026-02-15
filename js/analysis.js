// ArcOS Admin — AI Log Analysis
// ===============================

const AIAnalysis = {
  async run(logs, dateRange, contentEl, btnEl) {
    if (!logs || logs.length === 0) return;
    
    btnEl.textContent = "Analyzing...";
    btnEl.disabled = true;
    contentEl.innerHTML = `<div class="ai-loading"><div class="spinner"></div>Analyzing ${logs.length} log entries...</div>`;
    
    await new Promise(r => setTimeout(r, 800));
    
    const stats = this.computeStats(logs);
    const analysis = this.generate(stats, logs.length, dateRange);
    contentEl.innerHTML = this.render(analysis);
    btnEl.textContent = "Re-Analyze";
    btnEl.disabled = false;
  },
  
  computeStats(logs) {
    const s = {
      battery: { minSoc: Infinity, maxSoc: -Infinity, avgSoc: 0, minVoltage: Infinity, maxVoltage: -Infinity, avgVoltage: 0, timeBelowCritical: 0, timeBelowHalf: 0 },
      solar: { maxPower: 0, avgPowerWhenActive: 0, activeEntries: 0, minYield: Infinity, maxYield: -Infinity },
      loads: { avgDC: 0, maxDC: 0, avgAC: 0, maxAC: 0, avgTotal: 0, maxTotal: 0 },
      shore: { connectedEntries: 0, avgPower: 0 },
      engine: { runningEntries: 0, avgPower: 0 },
      water: { freshMin: null, freshMax: null, greyMin: null, greyMax: null },
      temp: { hasData: false, min: Infinity, max: -Infinity },
      gaps: []
    };
    let socSum=0, voltSum=0, solarPowerSum=0, shorePowerSum=0, enginePowerSum=0, dcSum=0, acSum=0, totalSum=0;
    
    logs.forEach((l, i) => {
      const soc=l.battery_soc||0, volt=l.battery_voltage||0, solar=l.solar_power||0;
      const dc=l.dc_load_power||0, ac=l.ac_load_power||0, total=l.total_consumption||0;
      
      s.battery.minSoc = Math.min(s.battery.minSoc, soc);
      s.battery.maxSoc = Math.max(s.battery.maxSoc, soc);
      socSum += soc;
      s.battery.minVoltage = Math.min(s.battery.minVoltage, volt);
      s.battery.maxVoltage = Math.max(s.battery.maxVoltage, volt);
      voltSum += volt;
      if (soc < 20) s.battery.timeBelowCritical++;
      if (soc < 50) s.battery.timeBelowHalf++;
      
      s.solar.maxPower = Math.max(s.solar.maxPower, solar);
      if (solar > 5) { solarPowerSum += solar; s.solar.activeEntries++; }
      const y = l.solar_daily_yield || 0;
      if (y > 0) { s.solar.minYield = Math.min(s.solar.minYield, y); s.solar.maxYield = Math.max(s.solar.maxYield, y); }
      
      dcSum += dc; s.loads.maxDC = Math.max(s.loads.maxDC, dc);
      acSum += ac; s.loads.maxAC = Math.max(s.loads.maxAC, ac);
      totalSum += total; s.loads.maxTotal = Math.max(s.loads.maxTotal, total);
      
      if (l.shore_connected) { s.shore.connectedEntries++; shorePowerSum += (l.shore_power||0); }
      if (l.engine_running) { s.engine.runningEntries++; enginePowerSum += (l.alternator_power||0); }
      
      if (l.fresh_water_level != null) { s.water.freshMin = s.water.freshMin === null ? l.fresh_water_level : Math.min(s.water.freshMin, l.fresh_water_level); s.water.freshMax = s.water.freshMax === null ? l.fresh_water_level : Math.max(s.water.freshMax, l.fresh_water_level); }
      if (l.grey_water_level != null) { s.water.greyMin = s.water.greyMin === null ? l.grey_water_level : Math.min(s.water.greyMin, l.grey_water_level); s.water.greyMax = s.water.greyMax === null ? l.grey_water_level : Math.max(s.water.greyMax, l.grey_water_level); }
      if (l.outside_temp != null) { s.temp.hasData = true; s.temp.min = Math.min(s.temp.min, l.outside_temp); s.temp.max = Math.max(s.temp.max, l.outside_temp); }
      
      if (i > 0) {
        const diffMin = (new Date(l.logged_at).getTime() - new Date(logs[i-1].logged_at).getTime()) / 60000;
        if (diffMin > 20) s.gaps.push({ from: new Date(logs[i-1].logged_at).toLocaleString(), to: new Date(l.logged_at).toLocaleString(), duration: diffMin > 60 ? (diffMin/60).toFixed(1)+' hours' : Math.round(diffMin)+' min' });
      }
    });
    
    const n = logs.length || 1;
    s.battery.avgSoc = socSum/n; s.battery.avgVoltage = voltSum/n;
    s.solar.avgPowerWhenActive = s.solar.activeEntries > 0 ? solarPowerSum/s.solar.activeEntries : 0;
    if (s.solar.minYield === Infinity) s.solar.minYield = 0;
    if (s.solar.maxYield === -Infinity) s.solar.maxYield = 0;
    s.loads.avgDC = dcSum/n; s.loads.avgAC = acSum/n; s.loads.avgTotal = totalSum/n;
    s.shore.avgPower = s.shore.connectedEntries > 0 ? shorePowerSum/s.shore.connectedEntries : 0;
    s.engine.avgPower = s.engine.runningEntries > 0 ? enginePowerSum/s.engine.runningEntries : 0;
    return s;
  },
  
  generate(stats, logCount, dateRange) {
    let score = 100;
    const good = [], concerns = [], recs = [];
    const s = stats;
    const pctBelowCritical = s.battery.timeBelowCritical/logCount*100;
    const pctShore = s.shore.connectedEntries/logCount*100;
    const solarHours = s.solar.activeEntries*15/60;
    
    if (s.battery.avgSoc >= 70) good.push(`Battery maintained a healthy average SOC of ${s.battery.avgSoc.toFixed(0)}%`);
    else if (s.battery.avgSoc >= 50) { recs.push(`Average SOC of ${s.battery.avgSoc.toFixed(0)}% is moderate — consider more frequent charging`); score -= 10; }
    else { concerns.push(`Average SOC of ${s.battery.avgSoc.toFixed(0)}% is low — battery is consistently undercharged`); score -= 25; }
    
    if (pctBelowCritical > 10) { concerns.push(`Battery below 20% SOC for ${s.battery.timeBelowCritical} readings (${pctBelowCritical.toFixed(0)}%) — accelerates degradation`); score -= 20; }
    else if (pctBelowCritical > 0) { concerns.push(`Battery briefly dipped below 20% SOC (${s.battery.timeBelowCritical} readings)`); score -= 5; }
    
    if (s.battery.minVoltage < 11.5 && s.battery.minVoltage > 0) { concerns.push(`Min voltage ${s.battery.minVoltage.toFixed(1)}V is dangerously low`); score -= 15; }
    else if (s.battery.minVoltage >= 12.0) good.push(`Voltage stayed healthy — never below ${s.battery.minVoltage.toFixed(1)}V`);
    
    if (s.battery.maxVoltage > 14.8) { concerns.push(`Peak voltage ${s.battery.maxVoltage.toFixed(1)}V may indicate overcharging`); score -= 10; }
    
    if (s.solar.maxPower > 200) good.push(`Strong solar — peaked ${s.solar.maxPower.toFixed(0)}W over ${solarHours.toFixed(1)} hours`);
    else if (s.solar.maxPower > 50) good.push(`Solar active — peaked ${s.solar.maxPower.toFixed(0)}W over ${solarHours.toFixed(1)} hours`);
    else if (s.solar.maxPower > 0) { concerns.push(`Solar very low (peak ${s.solar.maxPower.toFixed(0)}W) — check panels`); score -= 10; }
    else if (pctShore < 90) { concerns.push(`No solar production detected`); score -= 10; }
    
    if (s.loads.maxTotal > 2000) { concerns.push(`Peak consumption ${s.loads.maxTotal.toFixed(0)}W — verify expected`); score -= 5; }
    if (s.loads.avgTotal > 500) recs.push(`Avg consumption ${s.loads.avgTotal.toFixed(0)}W — consider reducing loads`);
    else if (s.loads.avgTotal > 0) good.push(`Consumption reasonable at ${s.loads.avgTotal.toFixed(0)}W avg`);
    
    if (s.loads.avgAC > 300 && pctShore < 20) { concerns.push(`High AC load (${s.loads.avgAC.toFixed(0)}W) while off-grid`); score -= 10; }
    if (pctShore > 80) good.push(`Shore power ${pctShore.toFixed(0)}% of the time`);
    else if (pctShore > 0) good.push(`Shore power ${pctShore.toFixed(0)}% of period`);
    
    if (s.water.freshMin !== null && s.water.freshMin < 15) { concerns.push(`Fresh water at ${s.water.freshMin.toFixed(0)}%`); recs.push(`Fill fresh water soon`); score -= 5; }
    else if (s.water.freshMin !== null) good.push(`Fresh water healthy (${s.water.freshMin.toFixed(0)}%–${s.water.freshMax.toFixed(0)}%)`);
    if (s.water.greyMax !== null && s.water.greyMax > 80) { concerns.push(`Grey tank at ${s.water.greyMax.toFixed(0)}%`); recs.push(`Dump grey water soon`); score -= 5; }
    
    if (s.gaps.length > 5) { concerns.push(`${s.gaps.length} data gaps — monitoring interrupted frequently`); recs.push(`Keep iPad connected to Cerbo network`); score -= 10; }
    else if (s.gaps.length > 0) { concerns.push(`${s.gaps.length} data gap${s.gaps.length > 1 ? 's' : ''} detected`); score -= 3; }
    
    if (good.length === 0) good.push(`System operational and logging`);
    score = Math.max(0, Math.min(100, score));
    
    let summary = score >= 80 ? `System in excellent health. Battery, solar, and consumption well-balanced.`
      : score >= 60 ? `System adequate but ${concerns.length} concern${concerns.length !== 1 ? 's' : ''} found.`
      : score >= 40 ? `Several issues need attention. Review battery and charging.`
      : `System health poor — immediate attention recommended.`;
    if (logCount < 10) summary += ` Limited data (${logCount} entries).`;
    
    return { score, summary, good, concerns, recs, stats };
  },
  
  render(analysis) {
    const { score, summary, good, concerns, recs, stats: s } = analysis;
    const scoreClass = score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad';
    
    const bullets = (items, empty) => {
      if (!items || !items.length) return `<div style="color:#8E8D8A;font-size:13px">${empty || 'None identified'}</div>`;
      return items.map(i => `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:13px;color:#C8C4BC;line-height:1.5"><span style="flex-shrink:0">•</span><span>${i}</span></div>`).join('');
    };
    
    let h = `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px">
      <div class="ai-score ${scoreClass}">${score}</div>
      <div><div class="ai-body">${summary}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        <div class="ai-metric"><span class="label">Avg SOC</span> ${s.battery.avgSoc.toFixed(0)}%</div>
        <div class="ai-metric"><span class="label">Avg Voltage</span> ${s.battery.avgVoltage.toFixed(1)}V</div>
        ${s.solar.maxPower > 0 ? `<div class="ai-metric"><span class="label">Peak Solar</span> ${s.solar.maxPower.toFixed(0)}W</div>` : ''}
        <div class="ai-metric"><span class="label">Avg Load</span> ${s.loads.avgTotal.toFixed(0)}W</div>
        ${s.water.freshMin !== null ? `<div class="ai-metric"><span class="label">Fresh Water</span> ${s.water.freshMin.toFixed(0)}–${s.water.freshMax.toFixed(0)}%</div>` : ''}
      </div></div></div>`;
    
    h += `<div class="ai-section"><div class="ai-section-title green">✓ What's Looking Good</div>${bullets(good)}</div>`;
    h += `<div class="ai-section"><div class="ai-section-title red">⚠ Concerns & Anomalies</div>${bullets(concerns, 'No concerns — everything healthy')}</div>`;
    if (recs.length) h += `<div class="ai-section"><div class="ai-section-title blue">→ Recommendations</div>${bullets(recs)}</div>`;
    
    if (s.gaps.length > 0) {
      h += `<div class="ai-section"><div class="ai-section-title" style="color:#8E8D8A">Data Gaps</div>`;
      h += s.gaps.slice(0,8).map(g => `<div style="font-size:12px;color:#666;margin-bottom:4px">${g.from} → ${g.to} (${g.duration})</div>`).join('');
      if (s.gaps.length > 8) h += `<div style="font-size:12px;color:#666">...and ${s.gaps.length-8} more</div>`;
      h += '</div>';
    }
    return h;
  }
};

window.AIAnalysis = AIAnalysis;
