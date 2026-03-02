// ArcOS Admin — Trips Page (Strava-style Route Viewer)
// =====================================================

const TripsPage = {
  trips: [],
  filteredTrips: [],
  selectedTrip: null,
  selectedPoints: [],
  map: null,
  routeLine: null,
  markers: [],
  hoverMarker: null,
  
  async load() {
    setActivePage('pageTrips');
    setActiveTab('tabTrips');
    
    document.getElementById('tripsContent').innerHTML = `
      <div class="trips-loading"><div class="spinner"></div> Loading trips...</div>
    `;
    document.getElementById('tripDetailPanel').innerHTML = '';
    document.getElementById('tripDetailPanel').style.display = 'none';
    
    try {
      // Fetch all trips with user profile info
      const trips = await supa(
        `trips?select=*,profiles(email,first_name,last_name)&order=started_at.desc&limit=200`
      );
      this.trips = trips;
      this.filteredTrips = trips;
      this.renderTripsList();
      this.renderStats();
    } catch (e) {
      document.getElementById('tripsContent').innerHTML = `
        <div class="logs-empty" style="color:#FF6565">Failed to load trips: ${e.message}</div>
      `;
    }
  },
  
  renderStats() {
    const trips = this.filteredTrips;
    const totalKm = trips.reduce((sum, t) => sum + (t.distance_km || 0), 0);
    const totalDuration = trips.reduce((sum, t) => sum + (t.duration_seconds || 0), 0);
    const totalPoints = trips.reduce((sum, t) => sum + (t.point_count || 0), 0);
    const uniqueUsers = new Set(trips.map(t => t.user_id)).size;
    
    document.getElementById('statTotalTrips').textContent = trips.length;
    document.getElementById('statTotalDistance').textContent = totalKm.toFixed(0) + ' km';
    document.getElementById('statTotalDriveTime').textContent = this.formatDuration(totalDuration);
    document.getElementById('statUniqueDrivers').textContent = uniqueUsers;
  },
  
  formatDuration(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },
  
  formatSpeed(kmh) {
    if (!kmh) return '—';
    // Convert to mph for US users
    return (kmh * 0.621371).toFixed(0) + ' mph';
  },
  
  filter(query) {
    const q = (query || '').toLowerCase();
    if (!q) {
      this.filteredTrips = this.trips;
    } else {
      this.filteredTrips = this.trips.filter(t => {
        const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.toLowerCase();
        const email = (t.profiles?.email || '').toLowerCase();
        const start = (t.start_location_name || '').toLowerCase();
        const end = (t.end_location_name || '').toLowerCase();
        return name.includes(q) || email.includes(q) || start.includes(q) || end.includes(q);
      });
    }
    this.renderTripsList();
    this.renderStats();
  },
  
  renderTripsList() {
    const trips = this.filteredTrips;
    
    if (trips.length === 0) {
      document.getElementById('tripsContent').innerHTML = `
        <div class="logs-empty">No trips recorded yet</div>
      `;
      return;
    }
    
    const rows = trips.map(t => {
      const name = `${t.profiles?.first_name || ''} ${t.profiles?.last_name || ''}`.trim() || t.profiles?.email || '—';
      const startLoc = t.start_location_name || (t.start_lat ? `${t.start_lat.toFixed(2)}, ${t.start_lng.toFixed(2)}` : '—');
      const endLoc = t.end_location_name || (t.end_lat ? `${t.end_lat.toFixed(2)}, ${t.end_lng.toFixed(2)}` : '—');
      const dist = t.distance_km ? (t.distance_km * 0.621371).toFixed(1) + ' mi' : '—';
      const duration = this.formatDuration(t.duration_seconds);
      const avgSpeed = this.formatSpeed(t.avg_speed_kmh);
      const maxSpeed = this.formatSpeed(t.max_speed_kmh);
      const points = t.point_count || 0;
      const date = formatDate(t.started_at);
      const time = formatTime(t.started_at);
      const isSelected = this.selectedTrip?.id === t.id;
      
      return `<tr class="${isSelected ? 'trip-row-active' : ''}" onclick="TripsPage.selectTrip('${t.id}')">
        <td>
          <div class="user-name">${escHtml(name)}</div>
          <div class="user-email">${escHtml(t.profiles?.email || '')}</div>
        </td>
        <td>
          <div class="trip-route">
            <span class="trip-dot trip-dot-start"></span>
            <span>${escHtml(startLoc)}</span>
          </div>
          <div class="trip-route">
            <span class="trip-dot trip-dot-end"></span>
            <span>${escHtml(endLoc)}</span>
          </div>
        </td>
        <td class="trip-stat">${dist}</td>
        <td class="trip-stat">${duration}</td>
        <td class="trip-stat">${avgSpeed}</td>
        <td class="trip-stat">${maxSpeed}</td>
        <td class="trip-stat">${points}</td>
        <td>
          <div style="color:#666;font-size:11px">${date}</div>
          <div style="color:#8E8D8A;font-size:12px">${time}</div>
        </td>
      </tr>`;
    }).join('');
    
    document.getElementById('tripsContent').innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Driver</th><th>Route</th><th>Distance</th><th>Duration</th>
            <th>Avg Speed</th><th>Max Speed</th><th>Points</th><th>Date</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },
  
  async selectTrip(tripId) {
    const trip = this.trips.find(t => t.id === tripId);
    if (!trip) return;
    
    this.selectedTrip = trip;
    this.renderTripsList(); // Re-render to highlight selected row
    
    const panel = document.getElementById('tripDetailPanel');
    panel.style.display = 'block';
    
    const name = `${trip.profiles?.first_name || ''} ${trip.profiles?.last_name || ''}`.trim() || trip.profiles?.email || '—';
    
    panel.innerHTML = `
      <div class="trip-detail-header">
        <div>
          <h3 class="trip-detail-title">${escHtml(name)}'s Trip</h3>
          <div class="trip-detail-meta">${formatDateTime(trip.started_at)}${trip.ended_at ? ' → ' + formatTime(trip.ended_at) : ' (in progress)'}</div>
        </div>
        <button class="btn-secondary" onclick="TripsPage.closeDetail()">✕ Close</button>
      </div>
      
      <div class="trip-detail-stats">
        <div class="trip-detail-stat">
          <div class="trip-detail-stat-value">${trip.distance_km ? (trip.distance_km * 0.621371).toFixed(1) : '—'}</div>
          <div class="trip-detail-stat-label">miles</div>
        </div>
        <div class="trip-detail-stat">
          <div class="trip-detail-stat-value">${this.formatDuration(trip.duration_seconds)}</div>
          <div class="trip-detail-stat-label">duration</div>
        </div>
        <div class="trip-detail-stat">
          <div class="trip-detail-stat-value">${this.formatSpeed(trip.avg_speed_kmh)}</div>
          <div class="trip-detail-stat-label">avg speed</div>
        </div>
        <div class="trip-detail-stat">
          <div class="trip-detail-stat-value">${this.formatSpeed(trip.max_speed_kmh)}</div>
          <div class="trip-detail-stat-label">max speed</div>
        </div>
      </div>
      
      <div id="tripMap" class="trip-map">
        <div class="trips-loading"><div class="spinner"></div> Loading route...</div>
      </div>
      
      <div id="tripTimeline" class="trip-timeline"></div>
    `;
    
    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Fetch trip points
    try {
      const points = await supa(
        `trip_points?trip_id=eq.${tripId}&order=timestamp.asc`
      );
      this.selectedPoints = points;
      
      if (points.length === 0) {
        document.getElementById('tripMap').innerHTML = '<div class="logs-empty">No GPS points for this trip</div>';
        return;
      }
      
      this.renderMap(points);
      this.renderTimeline(points);
    } catch (e) {
      document.getElementById('tripMap').innerHTML = `<div class="logs-empty" style="color:#FF6565">Failed to load route: ${e.message}</div>`;
    }
  },
  
  renderMap(points) {
    const mapEl = document.getElementById('tripMap');
    mapEl.innerHTML = ''; // Clear loading
    
    // Initialize Leaflet map
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    
    this.map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false
    });
    
    // Dark tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(this.map);
    
    // Build route polyline
    const coords = points.map(p => [p.latitude, p.longitude]);
    
    // Gradient line: color by speed
    const maxSpeed = Math.max(...points.map(p => p.speed || 0), 1);
    
    // Draw segments colored by speed
    for (let i = 1; i < coords.length; i++) {
      const speed = points[i].speed || 0;
      const ratio = Math.min(speed / maxSpeed, 1);
      const color = this.speedColor(ratio);
      
      L.polyline([coords[i-1], coords[i]], {
        color: color,
        weight: 4,
        opacity: 0.9
      }).addTo(this.map);
    }
    
    // Start marker (green)
    const startIcon = L.divIcon({
      className: 'trip-marker-start',
      html: '<div class="trip-pin trip-pin-start">▶</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker(coords[0], { icon: startIcon })
      .addTo(this.map)
      .bindPopup(`<b>Start</b><br>${formatDateTime(points[0].timestamp)}<br>Battery: ${points[0].battery_soc?.toFixed(0) || '—'}%`);
    
    // End marker (red)
    const endIcon = L.divIcon({
      className: 'trip-marker-end',
      html: '<div class="trip-pin trip-pin-end">■</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker(coords[coords.length - 1], { icon: endIcon })
      .addTo(this.map)
      .bindPopup(`<b>End</b><br>${formatDateTime(points[points.length - 1].timestamp)}<br>Battery: ${points[points.length - 1].battery_soc?.toFixed(0) || '—'}%`);
    
    // Hover marker (hidden until timeline hover)
    this.hoverMarker = L.circleMarker([0, 0], {
      radius: 7,
      fillColor: '#E7B400',
      fillOpacity: 1,
      color: '#fff',
      weight: 2
    });
    
    // Fit bounds
    const bounds = L.latLngBounds(coords);
    this.map.fitBounds(bounds, { padding: [40, 40] });
    
    // Speed legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'trip-legend');
      div.innerHTML = `
        <div class="trip-legend-title">Speed</div>
        <div class="trip-legend-bar"></div>
        <div class="trip-legend-labels">
          <span>Slow</span><span>Fast</span>
        </div>
      `;
      return div;
    };
    legend.addTo(this.map);
  },
  
  speedColor(ratio) {
    // Blue (slow) → Green (medium) → Yellow (fast) → Red (very fast)
    if (ratio < 0.25) {
      return `rgb(${Math.round(66 + ratio * 4 * (76 - 66))}, ${Math.round(133 + ratio * 4 * (175 - 133))}, ${Math.round(244 - ratio * 4 * (244 - 80))})`;
    } else if (ratio < 0.5) {
      const r = (ratio - 0.25) * 4;
      return `rgb(${Math.round(76 + r * (231 - 76))}, ${Math.round(175 + r * (180 - 175))}, ${Math.round(80 - r * 80)})`;
    } else if (ratio < 0.75) {
      const r = (ratio - 0.5) * 4;
      return `rgb(${Math.round(231 + r * (255 - 231))}, ${Math.round(180 - r * (180 - 101))}, 0)`;
    } else {
      const r = (ratio - 0.75) * 4;
      return `rgb(255, ${Math.round(101 - r * 101)}, 0)`;
    }
  },
  
  renderTimeline(points) {
    const container = document.getElementById('tripTimeline');
    if (points.length === 0) { container.innerHTML = ''; return; }
    
    // Sample points for timeline (max 50 entries)
    const step = Math.max(1, Math.floor(points.length / 50));
    const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    
    const rows = sampled.map((p, i) => {
      const speed = p.speed ? (p.speed * 3.6 * 0.621371).toFixed(0) + ' mph' : '—';
      const soc = p.battery_soc != null ? p.battery_soc.toFixed(0) + '%' : '—';
      const solar = p.solar_power != null ? p.solar_power.toFixed(0) + 'W' : '—';
      const alt = p.alternator_power != null ? p.alternator_power.toFixed(0) + 'W' : '—';
      const socClass = p.battery_soc > 50 ? 'soc-high' : p.battery_soc > 20 ? 'soc-mid' : 'soc-low';
      
      return `<tr onmouseenter="TripsPage.highlightPoint(${p.latitude}, ${p.longitude})" onmouseleave="TripsPage.clearHighlight()">
        <td style="color:#666;font-size:11px">${formatTime(p.timestamp)}</td>
        <td>${speed}</td>
        <td><span class="${socClass}">${soc}</span></td>
        <td class="solar-val">${solar}</td>
        <td class="engine-on">${alt}</td>
        <td style="color:#666;font-size:11px">${p.altitude?.toFixed(0) || '—'}m</td>
        <td style="color:#555;font-size:10px">${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</td>
      </tr>`;
    }).join('');
    
    container.innerHTML = `
      <div class="card-title" style="margin-top:16px">Timeline (${points.length} points, showing ${sampled.length})</div>
      <div class="logs-table">
        <table>
          <thead><tr>
            <th>Time</th><th>Speed</th><th>Battery</th><th>Solar</th><th>Alternator</th><th>Altitude</th><th>Coordinates</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },
  
  highlightPoint(lat, lng) {
    if (this.map && this.hoverMarker) {
      this.hoverMarker.setLatLng([lat, lng]);
      if (!this.map.hasLayer(this.hoverMarker)) {
        this.hoverMarker.addTo(this.map);
      }
    }
  },
  
  clearHighlight() {
    if (this.map && this.hoverMarker && this.map.hasLayer(this.hoverMarker)) {
      this.map.removeLayer(this.hoverMarker);
    }
  },
  
  closeDetail() {
    this.selectedTrip = null;
    this.selectedPoints = [];
    document.getElementById('tripDetailPanel').style.display = 'none';
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.renderTripsList();
  }
};

window.TripsPage = TripsPage;