/**
 * mumbai_drainage.js - AquaAlert Mumbai Monsoon Drainage Operations & IoT Twin
 * ============================================================================
 * Powers:
 *   - Leaflet Geospatial Drainage Map with CartoDB Dark tiles
 *   - Heavy Rainfall Drain Locator & Proximity Highlights
 *   - Real-Time ESP32 Hardware Digital Twin (16x2 LCD, 3 LEDs, Web-Audio Buzzer)
 *   - Automatic Weather Stations & Rain Radar Circles
 *   - Arabian Sea Tide Telemetry & Floodgate Automation
 *   - Socket.IO Live Telemetry & Scenario Stress Testing
 */

(function () {
  'use strict';

  // ── State Variables ────────────────────────────────────────────────────────
  let map = null;
  let socket = null;
  let drainsData = [];
  let stationsData = [];
  let hardwareState = {};
  let tideData = {};
  let drainMarkers = {};
  let stationMarkers = {};
  let radarCircles = [];
  let currentFilter = 'all';
  let activeWard = '';
  let searchQuery = '';
  let heavyRainOnlyActive = false;
  let buzzerAudioEnabled = false; // Enabled upon first user interaction to comply with browser audio policies
  let audioCtx = null;
  let buzzerInterval = null;

  // ── DOM Elements Cache ─────────────────────────────────────────────────────
  const el = {
    // Header & Banner
    banner: document.getElementById('monsoon-banner'),
    alertHeadline: document.getElementById('alert-headline'),
    alertSubtext: document.getElementById('alert-subtext'),
    alertIcon: document.getElementById('alert-banner-icon'),
    globalHwBadge: document.getElementById('global-hw-badge'),
    // Tide
    tideHeight: document.getElementById('tide-height-val'),
    tideLockTag: document.getElementById('tide-lock-tag'),
    tidePhase: document.getElementById('tide-phase-text'),
    // Hardware Twin
    hwDrainSelect: document.getElementById('hw-drain-select'),
    btnBuzzerAudio: document.getElementById('btn-toggle-buzzer-audio'),
    buzzerAudioText: document.getElementById('buzzer-audio-text'),
    buzzerAudioIcon: document.getElementById('buzzer-audio-icon'),
    lcdRow1: document.getElementById('hw-lcd-row-1'),
    lcdRow2: document.getElementById('hw-lcd-row-2'),
    bulbGreen: document.getElementById('bulb-green'),
    bulbYellow: document.getElementById('bulb-yellow'),
    bulbRed: document.getElementById('bulb-red'),
    buzzerBar: document.getElementById('hw-buzzer-bar'),
    buzzerTitle: document.getElementById('buzzer-title-text'),
    buzzerSub: document.getElementById('buzzer-sub-text'),
    buzzerPill: document.getElementById('buzzer-state-pill'),
    hwDistance: document.getElementById('hw-distance-val'),
    hwDepth: document.getElementById('hw-depth-val'),
    hwCapacity: document.getElementById('hw-capacity-val'),
    hwCapacityFill: document.getElementById('hw-capacity-fill'),
    hwStatusBadge: document.getElementById('hw-status-badge'),
    hwMaxDepthNote: document.getElementById('hw-max-depth-note'),
    // Filter controls
    btnLocateHeavy: document.getElementById('btn-locate-heavy-rain'),
    heavyCountBadge: document.getElementById('heavy-drain-badge'),
    wardSelect: document.getElementById('ward-filter-select'),
    searchInput: document.getElementById('drain-search-input'),
    drainsContainer: document.getElementById('drains-cards-list'),
    drainsShowingText: document.getElementById('drains-showing-text'),
    btnRefresh: document.getElementById('btn-refresh-drains'),
    // Map Stats
    statActiveStations: document.getElementById('active-stations-val'),
    statMaxRain: document.getElementById('max-rain-val'),
    statCritDrains: document.getElementById('crit-drains-count'),
    // Simulation controls
    simScenarioTag: document.getElementById('sim-active-scenario'),
    rainSlider: document.getElementById('monsoon-rain-slider'),
    sliderVal: document.getElementById('slider-rain-val'),
  };

  // ── Web Audio Buzzer Synthesizer ───────────────────────────────────────────
  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playBuzzerBeep(freq = 2200, duration = 0.15) {
    if (!buzzerAudioEnabled || !audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square'; // Authentic buzzer piezo sound
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('[AquaAlert] Audio synth error:', e);
    }
  }

  function updateBuzzerAudioLoop(mode) {
    if (buzzerInterval) {
      clearInterval(buzzerInterval);
      buzzerInterval = null;
    }

    if (!buzzerAudioEnabled) return;

    if (mode === 'CONTINUOUS') {
      // Rapid critical alarm: 3 short beeps every 0.8s
      buzzerInterval = setInterval(() => {
        playBuzzerBeep(2600, 0.12);
        setTimeout(() => playBuzzerBeep(2600, 0.12), 160);
        setTimeout(() => playBuzzerBeep(2600, 0.12), 320);
      }, 850);
    } else if (mode === 'PULSE') {
      // High alert: 2 pulses every 1.5s
      buzzerInterval = setInterval(() => {
        playBuzzerBeep(2000, 0.2);
        setTimeout(() => playBuzzerBeep(2000, 0.2), 260);
      }, 1500);
    } else if (mode === 'SLOW_BEEP') {
      // Caution chime: 1 beep every 3s
      buzzerInterval = setInterval(() => {
        playBuzzerBeep(1400, 0.25);
      }, 3000);
    }
  }

  // ── Leaflet Map Initialization ─────────────────────────────────────────────
  function initLeafletMap() {
    const mapEl = document.getElementById('mumbai-leaflet-map');
    if (!mapEl) return;

    // Center on Mumbai coordinates: 19.0760 N, 72.8777 E
    map = L.map('mumbai-leaflet-map', {
      center: [19.0760, 72.8777],
      zoom: 11,
      zoomControl: true,
      minZoom: 10,
      maxZoom: 17,
    });

    // Sleek, high-contrast Dark CartoDB Matter tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
  }

  // ── Render Radar Rain Ripples ──────────────────────────────────────────────
  function renderRainRadarCircles() {
    if (!map) return;

    // Clear old radar circles
    radarCircles.forEach((circle) => map.removeLayer(circle));
    radarCircles = [];

    // Find weather stations with heavy rain >= 65 mm/h
    stationsData.forEach((stn) => {
      if (stn.rainfall_mm_h >= 65.0) {
        // Outer danger radius (~3.5 km)
        const outerCircle = L.circle([stn.lat, stn.lon], {
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.12,
          weight: 2,
          dashArray: '6, 6',
          radius: 3500,
        }).addTo(map);

        // Core intensity radius (~1.8 km)
        const coreCircle = L.circle([stn.lat, stn.lon], {
          color: '#f87171',
          fillColor: '#dc2626',
          fillOpacity: 0.25,
          weight: 2,
          radius: 1800,
        }).addTo(map);

        radarCircles.push(outerCircle, coreCircle);
      }
    });
  }

  // ── Render Weather Station Markers ─────────────────────────────────────────
  function renderWeatherStations() {
    if (!map) return;

    stationsData.forEach((stn) => {
      const isHeavy = stn.rainfall_mm_h >= 65.0;
      const markerKey = stn.id;

      if (!stationMarkers[markerKey]) {
        const iconHtml = `
          <div class="station-pin ${isHeavy ? 'station-heavy' : ''}" title="${stn.name}">
            🌧️
          </div>
        `;

        const customIcon = L.divIcon({
          className: 'station-marker-icon',
          html: iconHtml,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const marker = L.marker([stn.lat, stn.lon], { icon: customIcon }).addTo(map);
        stationMarkers[markerKey] = marker;
      }

      // Update popup
      const popupHtml = `
        <div style="min-width: 190px;">
          <div style="font-weight: 800; font-size: 0.9rem; color: #60a5fa; margin-bottom: 0.35rem;">
            📍 ${stn.name}
          </div>
          <div class="popup-metric-row">
            <span>Zone:</span> <strong>${stn.zone}</strong>
          </div>
          <div class="popup-metric-row">
            <span>Rainfall Rate:</span> 
            <strong style="color: ${isHeavy ? '#f87171' : '#34d399'};">
              ${stn.rainfall_mm_h} mm/hr ${isHeavy ? '(HEAVY)' : ''}
            </strong>
          </div>
          <div class="popup-metric-row">
            <span>Condition:</span> <strong>${stn.condition}</strong>
          </div>
          <div class="popup-metric-row">
            <span>Wind / Humidity:</span> <strong>${stn.wind_kmh} km/h • ${stn.humidity_pct}%</strong>
          </div>
        </div>
      `;
      stationMarkers[markerKey].bindPopup(popupHtml);
    });
  }

  // ── Render Drain Markers on Leaflet Map ────────────────────────────────────
  function renderDrainMarkers() {
    if (!map) return;

    drainsData.forEach((drain) => {
      const isHw = Boolean(drain.is_hardware_node || drain.assigned_device_id);
      const isHeavy = Boolean(drain.in_heavy_rain_zone);
      const status = (drain.status || 'NORMAL').toUpperCase();

      let pinClass = 'pin-normal';
      if (status === 'WARNING') pinClass = 'pin-warning';
      else if (status === 'HIGH') pinClass = 'pin-high';
      else if (status === 'CRITICAL' || status === 'OVERFLOW') pinClass = 'pin-critical';

      if (isHw) pinClass += ' pin-hw-beacon';

      const markerKey = drain.id;
      const markerLabel = isHw ? 'ESP' : `${drain.percentage}%`;

      const iconHtml = `
        <div class="drain-marker-pin ${pinClass}" id="marker-${drain.id}">
          ${markerLabel}
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-drain-icon',
        html: iconHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      if (!drainMarkers[markerKey]) {
        const marker = L.marker([drain.lat, drain.lon], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
          highlightDrainCard(drain.id);
        });
        drainMarkers[markerKey] = marker;
      } else {
        drainMarkers[markerKey].setIcon(customIcon);
      }

      // Popup Content with Live Telemetry
      const popupHtml = `
        <div style="min-width: 230px;">
          <div class="popup-drain-title">
            ${isHw ? '⚡ [ESP32 DEV NODE] ' : ''}${drain.name}
          </div>
          <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 0.5rem;">
            Ward: ${drain.ward} • Basin: ${drain.basin}
          </div>

          <div class="popup-metric-row">
            <span>Water Level:</span> 
            <strong style="color: #60a5fa;">${drain.water_level_cm} cm (${drain.percentage}%)</strong>
          </div>
          <div class="popup-metric-row">
            <span>Risk Status:</span> 
            <strong style="color: ${getStatusColor(status)};">${status}</strong>
          </div>
          <div class="popup-metric-row">
            <span>Local Rainfall:</span> 
            <strong style="color: ${isHeavy ? '#f87171' : '#cbd5e1'};">
              ${drain.local_rainfall_mm_h} mm/hr ${isHeavy ? '⚠️ HEAVY' : ''}
            </strong>
          </div>
          <div class="popup-metric-row">
            <span>Nearest Station:</span> 
            <strong>${drain.nearest_station} (${drain.distance_to_station_km} km)</strong>
          </div>
          <div class="popup-metric-row">
            <span>Discharge / Silt:</span> 
            <strong>${drain.discharge_rate_m3s} m³/s • ${drain.silt_index_pct}% Silt</strong>
          </div>
          <div class="popup-metric-row">
            <span>Pumping Station:</span> 
            <strong style="color: #34d399;">${drain.pumps_running}/${drain.pumps_capacity} Active</strong>
          </div>

          ${
            drain.minutes_to_overflow !== null
              ? `<div style="margin-top: 0.45rem; padding: 0.25rem; background: rgba(239, 68, 68, 0.18); border-radius: 4px; text-align: center; font-size: 0.72rem; color: #f87171; font-weight: 700;">
                  ⚠️ Est. Overflow in ~${drain.minutes_to_overflow} minutes
                 </div>`
              : ''
          }
        </div>
      `;

      drainMarkers[markerKey].bindPopup(popupHtml);
    });
  }

  function getStatusColor(status) {
    if (status === 'CRITICAL' || status === 'OVERFLOW') return '#ef4444';
    if (status === 'HIGH') return '#f97316';
    if (status === 'WARNING') return '#f59e0b';
    return '#10b981';
  }

  // ── Render Drain Cards List ────────────────────────────────────────────────
  function renderDrainCards() {
    if (!el.drainsContainer) return;

    // Apply active filters
    let filtered = drainsData.filter((drain) => {
      // Heavy rain filter
      if (heavyRainOnlyActive && !drain.in_heavy_rain_zone) {
        return false;
      }

      // Ward filter
      if (activeWard && !drain.ward.toLowerCase().includes(activeWard.toLowerCase())) {
        return false;
      }

      // Quick filter
      if (currentFilter === 'critical') {
        if (drain.status !== 'CRITICAL' && drain.status !== 'HIGH') return false;
      } else if (currentFilter === 'subways') {
        if (!drain.name.toLowerCase().includes('subway')) return false;
      } else if (currentFilter === 'tide_locked') {
        if (!drain.name.toLowerCase().includes('outfall') && drain.id !== 'DRN-MUM-001') return false;
      }

      // Text search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchName = drain.name.toLowerCase().includes(query);
        const matchLandmark = drain.landmark.toLowerCase().includes(query);
        const matchWard = drain.ward.toLowerCase().includes(query);
        if (!matchName && !matchLandmark && !matchWard) return false;
      }

      return true;
    });

    // Update Showing text
    if (el.drainsShowingText) {
      el.drainsShowingText.textContent = `Displaying ${filtered.length} of ${drainsData.length} monitored drains ${heavyRainOnlyActive ? '(Heavy Rainfall Filter Active)' : ''}`;
    }

    if (!filtered.length) {
      el.drainsContainer.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: #94a3b8;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
          <strong>No drains match the current filter criteria</strong>
          <p style="font-size: 0.8rem; margin-top: 0.25rem;">Try clearing the search or switching wards.</p>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach((drain) => {
      const isHw = Boolean(drain.is_hardware_node || drain.assigned_device_id);
      const isHeavy = Boolean(drain.in_heavy_rain_zone);
      const status = (drain.status || 'NORMAL').toUpperCase();

      let badgeClass = 'badge-status--normal';
      if (status === 'WARNING') badgeClass = 'badge-status--warning';
      else if (status === 'HIGH') badgeClass = 'badge-status--high';
      else if (status === 'CRITICAL' || status === 'OVERFLOW') badgeClass = 'badge-status--critical';

      let cardClass = 'drain-card';
      if (isHw) cardClass += ' drain-card--hw-node';
      if (isHeavy) cardClass += ' drain-card--heavy-rain';

      let progressGrad = 'linear-gradient(90deg, #10b981, #3b82f6)';
      if (status === 'WARNING') progressGrad = 'linear-gradient(90deg, #10b981, #f59e0b)';
      else if (status === 'HIGH') progressGrad = 'linear-gradient(90deg, #f59e0b, #f97316)';
      else if (status === 'CRITICAL') progressGrad = 'linear-gradient(90deg, #f97316, #ef4444)';

      html += `
        <div class="${cardClass}" id="card-${drain.id}" onclick="window.AquaAlertMumbai.focusDrain('${drain.id}')">
          <div class="drain-card-header">
            <div>
              <div class="drain-card-title">
                ${isHw ? '<span style="color: #38bdf8; font-size: 0.78rem;">⚡ [ESP32 DEV]</span> ' : ''}${drain.name}
              </div>
              <div class="drain-card-sub">
                ${drain.landmark} • Ward: ${drain.ward}
              </div>
            </div>
            <span class="drain-status-badge ${badgeClass}">${status}</span>
          </div>

          <div class="drain-metrics-grid">
            <div class="d-metric-item">
              <span class="d-metric-lbl">Water Depth</span>
              <span class="d-metric-val" style="color: #60a5fa;">${drain.water_level_cm} cm</span>
            </div>
            <div class="d-metric-item">
              <span class="d-metric-lbl">Capacity</span>
              <span class="d-metric-val" style="color: ${getStatusColor(status)};">${drain.percentage}%</span>
            </div>
            <div class="d-metric-item">
              <span class="d-metric-lbl">Local Rain</span>
              <span class="d-metric-val" style="color: ${isHeavy ? '#f87171' : '#cbd5e1'};">
                ${drain.local_rainfall_mm_h} mm/h
              </span>
            </div>
          </div>

          <div class="drain-progress-bar">
            <div class="drain-progress-fill" style="width: ${drain.percentage}%; background: ${progressGrad};"></div>
          </div>

          <div class="drain-card-footer">
            <div>
              ${
                isHeavy
                  ? `<span class="heavy-rain-tag">⛈️ Heavy Rain (${drain.distance_to_station_km}km from ${drain.nearest_station})</span>`
                  : `<span>Basin: ${drain.basin}</span>`
              }
            </div>
            <button type="button" class="btn-track-map" onclick="event.stopPropagation(); window.AquaAlertMumbai.focusDrain('${drain.id}')">
              📍 Track on Map &rarr;
            </button>
          </div>
        </div>
      `;
    });

    el.drainsContainer.innerHTML = html;
  }

  // ── ESP32 Hardware Twin Synchronization ────────────────────────────────────
  function updateHardwareTwinUI(hw) {
    if (!hw) return;
    hardwareState = hw;

    // 1. Update 16x2 Character LCD Lines
    if (el.lcdRow1) el.lcdRow1.textContent = hw.lcd_line_1 || 'HINDMATA DRAIN  ';
    if (el.lcdRow2) el.lcdRow2.textContent = hw.lcd_line_2 || 'LVL: 77%    HIGH';

    // 2. Update 3 GPIO LEDs
    // Green LED (<50%)
    if (el.bulbGreen) {
      if (hw.led_green) el.bulbGreen.classList.add('active-glow');
      else el.bulbGreen.classList.remove('active-glow');
    }

    // Yellow LED (50-69%)
    if (el.bulbYellow) {
      if (hw.led_yellow) el.bulbYellow.classList.add('active-glow');
      else el.bulbYellow.classList.remove('active-glow');
    }

    // Red LED (>=70%)
    if (el.bulbRed) {
      if (hw.led_red) el.bulbRed.classList.add('active-glow');
      else el.bulbRed.classList.remove('active-glow');
    }

    // 3. Update Buzzer Actuator
    if (el.buzzerPill) {
      el.buzzerPill.className = 'buzzer-state-pill';
      if (hw.buzzer_mode === 'CONTINUOUS') {
        el.buzzerPill.classList.add('pill--continuous');
        el.buzzerPill.textContent = 'RAPID SIREN';
        if (el.buzzerTitle) el.buzzerTitle.textContent = 'BUZZER ACTIVE (GPIO 23) — CRITICAL';
        if (el.buzzerSub) el.buzzerSub.textContent = hw.buzzer_note || 'Continuous rapid alarm for critical water level >= 85%';
      } else if (hw.buzzer_mode === 'PULSE') {
        el.buzzerPill.classList.add('pill--pulse');
        el.buzzerPill.textContent = 'PULSING';
        if (el.buzzerTitle) el.buzzerTitle.textContent = 'BUZZER ACTIVE (GPIO 23) — HIGH ALERT';
        if (el.buzzerSub) el.buzzerSub.textContent = hw.buzzer_note || 'Warning pulse alarm sounding for High Water Level';
      } else if (hw.buzzer_mode === 'SLOW_BEEP') {
        el.buzzerPill.classList.add('pill--pulse');
        el.buzzerPill.textContent = 'CAUTION BEEP';
        if (el.buzzerTitle) el.buzzerTitle.textContent = 'BUZZER ACTIVE (GPIO 23) — WARNING';
        if (el.buzzerSub) el.buzzerSub.textContent = hw.buzzer_note || 'Caution periodic chime for 50-69% warning';
      } else {
        el.buzzerPill.classList.add('pill--silent');
        el.buzzerPill.textContent = 'SILENT';
        if (el.buzzerTitle) el.buzzerTitle.textContent = 'BUZZER INACTIVE (GPIO 23)';
        if (el.buzzerSub) el.buzzerSub.textContent = 'Water level is safe (<50%). No acoustic alarm.';
      }
    }

    // Trigger audio synth beeps if sound enabled
    updateBuzzerAudioLoop(hw.buzzer_mode);

    // 4. Update Ultrasonic Telemetry Box
    if (el.hwDistance) el.hwDistance.textContent = `${hw.distance_cm} cm`;
    if (el.hwDepth) el.hwDepth.textContent = `${hw.water_level_cm} cm`;
    if (el.hwCapacity) {
      el.hwCapacity.textContent = `${hw.percentage}%`;
      el.hwCapacity.style.color = getStatusColor(hw.status);
    }
    if (el.hwCapacityFill) {
      el.hwCapacityFill.style.width = `${hw.percentage}%`;
      if (hw.percentage >= 85) {
        el.hwCapacityFill.style.background = 'linear-gradient(90deg, #f97316, #ef4444)';
      } else if (hw.percentage >= 70) {
        el.hwCapacityFill.style.background = 'linear-gradient(90deg, #f59e0b, #f97316)';
      } else if (hw.percentage >= 50) {
        el.hwCapacityFill.style.background = 'linear-gradient(90deg, #10b981, #f59e0b)';
      } else {
        el.hwCapacityFill.style.background = 'linear-gradient(90deg, #10b981, #3b82f6)';
      }
    }
    if (el.hwStatusBadge) el.hwStatusBadge.textContent = `${hw.status} ALERT`;

    // Dropdown selection sync
    if (el.hwDrainSelect && hw.bound_drain_id) {
      el.hwDrainSelect.value = hw.bound_drain_id;
    }
  }

  // ── Tide Telemetry UI ──────────────────────────────────────────────────────
  function updateTideUI(tide) {
    if (!tide) return;
    tideData = tide;
    if (el.tideHeight) {
      el.tideHeight.innerHTML = `${tide.height_m.toFixed(2)} m ${
        tide.is_high_tide
          ? '<small style="font-size: 0.8rem; color: #f87171;">(High Tide Surge &gt; 4.5m)</small>'
          : '<small style="font-size: 0.8rem; color: #34d399;">(Normal Low Tide)</small>'
      }`;
    }
    if (el.tideLockTag) {
      el.tideLockTag.textContent = tide.floodgates_locked ? 'GATES LOCKED' : 'OUTFLOWS OPEN';
      el.tideLockTag.style.background = tide.floodgates_locked ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
      el.tideLockTag.style.color = tide.floodgates_locked ? '#f87171' : '#34d399';
    }
    if (el.tidePhase) {
      el.tidePhase.textContent = `Peak Tide: ${tide.peak_time} • Phase: ${tide.phase}`;
    }
  }

  // ── Heavy Rain Drain Locator Action ────────────────────────────────────────
  function locateDrainsInHeavyRain() {
    heavyRainOnlyActive = !heavyRainOnlyActive;

    if (el.btnLocateHeavy) {
      if (heavyRainOnlyActive) {
        el.btnLocateHeavy.classList.add('active');
        el.btnLocateHeavy.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
      } else {
        el.btnLocateHeavy.classList.remove('active');
        el.btnLocateHeavy.style.background = '#1e293b';
      }
    }

    renderDrainCards();

    // If active, fly map to bounding box of all heavy rain drains
    if (heavyRainOnlyActive && map) {
      const heavyPoints = drainsData
        .filter((d) => d.in_heavy_rain_zone)
        .map((d) => [d.lat, d.lon]);

      if (heavyPoints.length) {
        const bounds = L.latLngBounds(heavyPoints);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate: true, duration: 1.2 });
      }
    }
  }

  // ── Highlight and Focus Drain on Map & List ────────────────────────────────
  function focusDrain(drainId) {
    const drain = drainsData.find((d) => d.id === drainId);
    if (!drain) return;

    if (map) {
      map.flyTo([drain.lat, drain.lon], 14, { duration: 1.2 });
      if (drainMarkers[drainId]) {
        drainMarkers[drainId].openPopup();
      }
    }

    highlightDrainCard(drainId);
  }

  function highlightDrainCard(drainId) {
    const card = document.getElementById(`card-${drainId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.style.outline = '2px solid #38bdf8';
      setTimeout(() => {
        card.style.outline = 'none';
      }, 2000);
    }
  }

  // ── Fetch Initial Data ─────────────────────────────────────────────────────
  async function fetchAllTelemetry() {
    try {
      const [drainsRes, stationsRes, tideRes, hwRes] = await Promise.all([
        fetch('/api/mumbai/drains'),
        fetch('/api/mumbai/stations'),
        fetch('/api/mumbai/tide'),
        fetch('/api/mumbai/hardware'),
      ]);

      const [drainsJson, stationsJson, tideJson, hwJson] = await Promise.all([
        drainsRes.json(),
        stationsRes.json(),
        tideRes.json(),
        hwRes.json(),
      ]);

      if (drainsJson.success) {
        drainsData = drainsJson.drains;
      }
      if (stationsJson.success) {
        stationsData = stationsJson.stations;
      }
      if (tideJson.success) {
        updateTideUI(tideJson.tide);
      }
      if (hwJson.success) {
        updateHardwareTwinUI(hwJson.hardware);
      }

      // Update Header Stats
      const heavyCount = drainsData.filter((d) => d.in_heavy_rain_zone).length;
      if (el.heavyCountBadge) el.heavyCountBadge.textContent = `${heavyCount} Drains`;

      const critCount = drainsData.filter((d) => d.status === 'CRITICAL' || d.status === 'HIGH').length;
      if (el.statCritDrains) el.statCritDrains.textContent = `${critCount} In Critical/High Alert`;

      const maxRain = Math.max(...stationsData.map((s) => s.rainfall_mm_h || 0), 0);
      const topStn = stationsData.find((s) => s.rainfall_mm_h === maxRain);
      if (el.statMaxRain && topStn) {
        el.statMaxRain.textContent = `${maxRain.toFixed(1)} mm/h (${topStn.name.split(' ')[0]})`;
      }

      // Render Visual Components
      renderRainRadarCircles();
      renderWeatherStations();
      renderDrainMarkers();
      renderDrainCards();
    } catch (err) {
      console.error('[AquaAlert] Telemetry fetch error:', err);
    }
  }

  // ── Setup Socket.IO ────────────────────────────────────────────────────────
  function setupSocketIO() {
    if (typeof io === 'undefined') return;

    socket = io();

    socket.on('connect', () => {
      console.log('[AquaAlert] Socket connected. Live Mumbai drainage feed active.');
      if (el.globalHwBadge) {
        el.globalHwBadge.style.display = 'inline-flex';
      }
    });

    socket.on('mumbai_drainage_init', (data) => {
      if (data.drains) drainsData = data.drains;
      if (data.stations) stationsData = data.stations;
      if (data.tide) updateTideUI(data.tide);
      if (data.hardware) updateHardwareTwinUI(data.hardware);

      renderRainRadarCircles();
      renderWeatherStations();
      renderDrainMarkers();
      renderDrainCards();
    });

    socket.on('mumbai_drainage_update', (data) => {
      if (data.drains) drainsData = data.drains;
      if (data.tide) updateTideUI(data.tide);
      if (data.hardware) updateHardwareTwinUI(data.hardware);
      if (data.stations) stationsData = data.stations;

      renderRainRadarCircles();
      renderWeatherStations();
      renderDrainMarkers();
      renderDrainCards();
    });

    // Also listen to direct ESP32 sensor_update
    socket.on('sensor_update', (reading) => {
      console.log('[AquaAlert] Physical ESP32 reading received:', reading);
    });
  }

  // ── Bind ESP32 to Selected Drain ───────────────────────────────────────────
  async function handleDrainNodeReassignment(drainId) {
    try {
      const res = await fetch('/api/mumbai/assign-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drain_id: drainId, device_id: 'AQUA-001' }),
      });
      const data = await res.json();
      if (data.success) {
        updateHardwareTwinUI(data.hardware);
        focusDrain(drainId);
      }
    } catch (e) {
      console.error('[AquaAlert] Error reassigning node:', e);
    }
  }

  // ── Trigger Simulation Scenario ────────────────────────────────────────────
  async function triggerScenario(scenarioName, customRain = null) {
    try {
      const payload = { scenario: scenarioName };
      if (customRain !== null) payload.rainfall = customRain;

      const res = await fetch('/api/mumbai/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        if (el.simScenarioTag) {
          el.simScenarioTag.textContent = `Active Mode: ${scenarioName.replace('_', ' ').toUpperCase()}`;
        }
        fetchAllTelemetry();
      }
    } catch (e) {
      console.error('[AquaAlert] Simulation trigger error:', e);
    }
  }

  // ── Event Listeners Setup ──────────────────────────────────────────────────
  function setupEventListeners() {
    // 1. Locate Heavy Rain Drains Button
    if (el.btnLocateHeavy) {
      el.btnLocateHeavy.addEventListener('click', locateDrainsInHeavyRain);
    }

    // 2. Filter Chips
    const filterBtns = document.querySelectorAll('.btn-filter-chip');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderDrainCards();
      });
    });

    // 3. Ward Dropdown
    if (el.wardSelect) {
      el.wardSelect.addEventListener('change', (e) => {
        activeWard = e.target.value;
        renderDrainCards();
      });
    }

    // 4. Search Input
    if (el.searchInput) {
      el.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderDrainCards();
      });
    }

    // 5. Hardware Drain Assignment Dropdown
    if (el.hwDrainSelect) {
      el.hwDrainSelect.addEventListener('change', (e) => {
        handleDrainNodeReassignment(e.target.value);
      });
    }

    // 6. Buzzer Sound Toggle
    if (el.btnBuzzerAudio) {
      el.btnBuzzerAudio.addEventListener('click', () => {
        initAudioContext();
        buzzerAudioEnabled = !buzzerAudioEnabled;
        if (buzzerAudioEnabled) {
          el.btnBuzzerAudio.style.background = 'rgba(245, 158, 11, 0.25)';
          el.btnBuzzerAudio.style.borderColor = '#f59e0b';
          el.buzzerAudioText.textContent = 'Buzzer Sound: ON';
          el.buzzerAudioIcon.textContent = '🔊';
          playBuzzerBeep(2000, 0.15); // Confirmation chirp
          if (hardwareState.buzzer_mode) {
            updateBuzzerAudioLoop(hardwareState.buzzer_mode);
          }
        } else {
          el.btnBuzzerAudio.style.background = 'rgba(30, 41, 59, 0.8)';
          el.btnBuzzerAudio.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          el.buzzerAudioText.textContent = 'Buzzer Sound: MUTED';
          el.buzzerAudioIcon.textContent = '🔇';
          if (buzzerInterval) {
            clearInterval(buzzerInterval);
            buzzerInterval = null;
          }
        }
      });
    }

    // 7. Refresh Button
    if (el.btnRefresh) {
      el.btnRefresh.addEventListener('click', fetchAllTelemetry);
    }

    // 8. Simulation Preset Buttons
    const simBtns = document.querySelectorAll('.btn-sim-preset');
    simBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        simBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        triggerScenario(btn.dataset.scenario);
      });
    });

    // 9. Rain Slider
    if (el.rainSlider) {
      el.rainSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (el.sliderVal) {
          el.sliderVal.textContent = `${val} mm/hr ${val >= 115 ? '(Very Heavy)' : val >= 65 ? '(Heavy Rain)' : '(Moderate)'}`;
        }
      });

      let debounceTimer = null;
      el.rainSlider.addEventListener('change', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const val = parseFloat(e.target.value);
          triggerScenario('heavy_rain', val);
        }, 300);
      });
    }
  }

  // ── Global Namespace Expose ────────────────────────────────────────────────
  window.AquaAlertMumbai = {
    focusDrain: focusDrain,
    fetchAll: fetchAllTelemetry,
  };

  // ── Bootstrapping ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initLeafletMap();
    setupEventListeners();
    setupSocketIO();
    fetchAllTelemetry();

    // Fallback polling every 4 seconds
    setInterval(fetchAllTelemetry, 4000);
  });
})();
