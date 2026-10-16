/* ═══════════════════════════════════════════════════════
   AquaAlert — Home Page JS (cards only, no charts)
   ═══════════════════════════════════════════════════════ */

'use strict';

const OFFLINE_THRESHOLD = 10000;

let lastDataTime = 0;
let isOnline = false;

const el = {
  esp32Status: document.getElementById('esp32-status'),
  statusDot: document.getElementById('status-dot'),
  waterPct: document.getElementById('water-percentage'),
  waterDist: document.getElementById('water-distance'),
  waterLevelCm: document.getElementById('water-level-cm'),
  waterStatus: document.getElementById('water-status'),
  deviceId: document.getElementById('device-id'),
  lastUpdated: document.getElementById('last-updated'),
  rainAmount: document.getElementById('rain-amount'),
  rainStatusBadge: document.getElementById('rain-status-badge'),
  lastRainDatetimeText: document.getElementById('last-rain-datetime-text'),
  liveClockText: document.getElementById('live-clock-text'),
  liveDateText: document.getElementById('live-date-text'),
  lcdLine1: document.getElementById('lcd-line-1'),
  lcdLine2: document.getElementById('lcd-line-2'),
  lcdRow1: document.getElementById('lcd-row-1'),
  lcdRow2: document.getElementById('lcd-row-2'),
  lcdStatusDot: document.getElementById('lcd-status-dot'),
  lcdSyncBadge: document.getElementById('lcd-sync-badge'),
};

/* ── Helpers ────────────────────────────────────────── */
function percentToStatus(p) {
  if (p >= 85) return 'CRITICAL';
  if (p >= 70) return 'HIGH';
  if (p >= 50) return 'WARNING';
  return 'NORMAL';
}
function formatTime(d) {
  return (d instanceof Date ? d : new Date(d)).toTimeString().slice(0, 8);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render 16 discrete character matrix blocks per line on the LCD.
 */
function renderLCDCells(line1Text, line2Text) {
  const l1 = (line1Text || '').padEnd(16, ' ').slice(0, 16);
  const l2 = (line2Text || '').padEnd(16, ' ').slice(0, 16);

  if (el.lcdRow1) {
    el.lcdRow1.innerHTML = l1.split('').map(ch => {
      const isSpace = ch === ' ';
      return `<span class="lcd-cell ${isSpace ? 'empty' : 'active'}">${isSpace ? '&nbsp;' : escapeHtml(ch)}</span>`;
    }).join('');
  }
  if (el.lcdRow2) {
    el.lcdRow2.innerHTML = l2.split('').map(ch => {
      const isSpace = ch === ' ';
      return `<span class="lcd-cell ${isSpace ? 'empty' : 'active'}">${isSpace ? '&nbsp;' : escapeHtml(ch)}</span>`;
    }).join('');
  }

  if (el.lcdLine1) el.lcdLine1.textContent = l1;
  if (el.lcdLine2) el.lcdLine2.textContent = l2;
}

let lastKnownLcdWaterLevel = 55.0;
let lastKnownLcdPct = 55;
let lastKnownLcdStatus = 'WARNING';

/**
 * Synchronize virtual 16x2 I2C LCD display widget with physical ESP32 LCD.
 */
function updateVirtualLCD(waterLevel, pct, status, online = true) {
  if (waterLevel !== undefined && waterLevel !== null && !isNaN(parseFloat(waterLevel))) {
    lastKnownLcdWaterLevel = parseFloat(waterLevel);
  }
  if (pct !== undefined && pct !== null && !isNaN(parseFloat(pct))) {
    lastKnownLcdPct = Math.round(parseFloat(pct));
  }
  if (status) {
    lastKnownLcdStatus = String(status).toUpperCase();
  }

  const roundPct = Math.min(100, Math.max(0, lastKnownLcdPct));
  const roundLvl = Math.round(lastKnownLcdWaterLevel);
  const statusStr = lastKnownLcdStatus;

  const pctStr = `${String(roundPct).padStart(3, ' ')}%`;
  const line1 = `AQUAALERT   ${pctStr}`;

  const lvlStr = `${roundLvl}cm`.padEnd(8, ' ');
  const rightSide = online ? statusStr.slice(0, 7).padStart(7, ' ') : 'STANDBY';
  const line2 = `${lvlStr} ${rightSide}`;

  renderLCDCells(line1, line2);

  if (el.lcdStatusDot) el.lcdStatusDot.className = online ? 'lcd-status-dot dot--online' : 'lcd-status-dot dot--offline';
  if (el.lcdSyncBadge) el.lcdSyncBadge.textContent = online ? 'ESP32 SYNCED' : 'STANDBY';
}

/* ── Online / Offline ───────────────────────────────── */
function setOnlineState(online) {
  isOnline = online;
  if (online) {
    el.esp32Status.textContent = 'ONLINE';
    el.statusDot.className = 'status-dot dot--online';
    if (el.lcdStatusDot) el.lcdStatusDot.className = 'lcd-status-dot dot--online';
    if (el.lcdSyncBadge) el.lcdSyncBadge.textContent = 'ESP32 SYNCED';
  } else {
    el.esp32Status.textContent = 'OFFLINE';
    el.statusDot.className = 'status-dot dot--offline';
    hideAlertBanner();
    updateVirtualLCD(lastKnownLcdWaterLevel, lastKnownLcdPct, lastKnownLcdStatus, false);
  }
}

function startOfflineWatchdog() {
  setInterval(() => {
    if (lastDataTime > 0 && Date.now() - lastDataTime > OFFLINE_THRESHOLD && isOnline) {
      setOnlineState(false);
    }
  }, 1000);
}

/* ── Alert Banner ───────────────────────────────────── */
const ALERT_CFG = {
  WARNING: { cls: 'alert--warning', icon: '〜', msg: 'WARNING: Water level is elevated — monitor closely' },
  HIGH: { cls: 'alert--high', icon: '🔶', msg: 'HIGH ALERT: Water level 70–84% — inspect immediately' },
  CRITICAL: { cls: 'alert--critical', icon: '🚨', msg: 'CRITICAL ALERT: Water at or above 85% — immediate action required!' },
};

function showAlertBanner(status) {
  const c = ALERT_CFG[status];
  if (!c) { hideAlertBanner(); return; }
  el.alertBanner.classList.remove('hidden', 'alert--warning', 'alert--high', 'alert--critical');
  el.alertBanner.classList.add(c.cls);
  el.alertIcon.textContent = c.icon;
  el.alertMessage.textContent = c.msg;
}
function hideAlertBanner() {
  el.alertBanner.classList.add('hidden');
  el.alertBanner.classList.remove('alert--warning', 'alert--high', 'alert--critical');
}

/* ── Update Cards ───────────────────────────────────── */
function updateCards(data) {
  const pct = parseFloat(data.percentage ?? 0).toFixed(1);
  const dist = parseFloat(data.distance ?? 0).toFixed(1);
  const lvlCm = parseFloat(data.water_level ?? 0).toFixed(1);
  const status = (data.status ?? percentToStatus(parseFloat(pct))).toUpperCase();
  const device = data.device_id ?? 'AQUA-001';
  const sensorTs = data.timestamp ? new Date(data.timestamp) : new Date();

  el.waterPct.textContent = `${pct}%`;
  el.waterDist.textContent = `${dist} cm`;
  el.waterLevelCm.textContent = `${lvlCm} cm`;
  el.deviceId.textContent = device;

  el.waterStatus.textContent = status;
  el.waterStatus.className = `status-badge badge--${status.toLowerCase()}`;

  const progressEl = document.getElementById('water-progress-fill');
  if (progressEl) {
    const clampPct = Math.min(Math.max(parseFloat(pct) || 0, 0), 100);
    progressEl.style.width = `${clampPct}%`;
    if (clampPct >= 85) {
      progressEl.style.background = 'var(--critical-red)';
    } else if (clampPct >= 70) {
      progressEl.style.background = 'var(--high-orange)';
    } else if (clampPct >= 50) {
      progressEl.style.background = 'var(--moderate-yellow)';
    } else {
      progressEl.style.background = 'linear-gradient(90deg, var(--accent-primary), var(--normal-green))';
    }
  }

  if (['WARNING', 'HIGH', 'CRITICAL'].includes(status)) {
    showAlertBanner(status);
  } else {
    hideAlertBanner();
  }

  // Synchronize virtual LCD display
  updateVirtualLCD(lvlCm, pct, status, true);

  if (el.lastUpdated) el.lastUpdated.textContent = formatTime(sensorTs);

  if (data.rainfall !== undefined && data.rainfall !== null) {
    updateRainUI({
      rainfall_mm: data.rainfall,
      last_rain_datetime: data.last_rain_datetime || new Date().toLocaleString(),
    });
  }
}

/* ── Rain Telemetry & Clock ─────────────────────────── */
function startLiveClock() {
  function tick() {
    const now = new Date();
    if (el.liveClockText) {
      el.liveClockText.textContent = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
    if (el.liveDateText) {
      const dateStr = now.toLocaleDateString([], {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      el.liveDateText.textContent = `${dateStr} • Local Time`;
    }
  }
  tick();
  setInterval(tick, 1000);
}

async function fetchRainLatest() {
  try {
    const res = await fetch('/api/rain/latest');
    if (!res.ok) return;
    const data = await res.json();
    updateRainUI(data);
  } catch (e) {
    console.warn('[AquaAlert Home] fetchRainLatest:', e);
  }
}

function updateRainUI(data) {
  if (!data) return;
  const rf = parseFloat(data.rainfall_mm ?? 0);
  if (el.rainAmount) {
    el.rainAmount.textContent = `${rf.toFixed(1)} mm`;
  }
  if (el.rainStatusBadge) {
    if (rf >= 100) {
      el.rainStatusBadge.textContent = 'Heavy Rain';
      el.rainStatusBadge.className = 'rain-status-badge rain-status-badge--heavy';
    } else if (rf >= 5) {
      el.rainStatusBadge.textContent = 'Active Rain';
      el.rainStatusBadge.className = 'rain-status-badge rain-status-badge--active';
    } else {
      el.rainStatusBadge.textContent = 'No Rain';
      el.rainStatusBadge.className = 'rain-status-badge rain-status-badge--clear';
    }
  }
  if (el.lastRainDatetimeText && data.last_rain_datetime) {
    el.lastRainDatetimeText.textContent = data.last_rain_datetime;
  }
}

/* ── Fetch Latest on Load ───────────────────────────── */
async function fetchLatest() {
  try {
    const res = await fetch('/api/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.id) {
      lastDataTime = Date.now();
      setOnlineState(true);
      updateCards(data);
      return;
    }
  } catch (e) {
    console.warn('[AquaAlert Home] fetchLatest:', e.message);
  }

  setOnlineState(false);
  el.waterPct.textContent = '--%';
  el.waterDist.textContent = '-- cm';
  el.waterLevelCm.textContent = '-- cm';
  el.waterStatus.textContent = 'OFFLINE';
  el.waterStatus.className = 'status-badge badge--warning';
  el.lastUpdated.textContent = '--:--:--';
  hideAlertBanner();
}

/* ── Socket.IO ──────────────────────────────────────── */
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

socket.on('connect', () => {
  console.log('[AquaAlert Home] Socket connected');
  fetchLatest();
});

socket.on('reconnect', (attemptNumber) => {
  console.log('[AquaAlert Home] Socket reconnected after', attemptNumber, 'attempts');
  fetchLatest();
});

socket.on('disconnect', (reason) => {
  console.warn('[AquaAlert Home] Socket disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.warn('[AquaAlert Home] Socket connect error:', error.message);
});

socket.on('sensor_update', (data) => {
  lastDataTime = Date.now();
  setOnlineState(true);
  updateCards(data);
});

/* ── Live Weather Telemetry ─────────────────────────── */
let currentTargetArea = 'mumbai_dadar';

async function fetchWeather(params = {}, refresh = false) {
  try {
    let url = '/api/weather?';
    if (typeof params === 'string') {
      url += `area=${encodeURIComponent(params)}&city=${encodeURIComponent(params)}`;
      currentTargetArea = params;
    } else {
      const { area, city, lat, lon } = params;
      if (area) { url += `area=${encodeURIComponent(area)}&`; currentTargetArea = area; }
      if (city) url += `city=${encodeURIComponent(city)}&`;
      if (lat !== undefined && lat !== null) url += `lat=${lat}&`;
      if (lon !== undefined && lon !== null) url += `lon=${lon}&`;
    }
    if (refresh) url += 'refresh=true&';

    const res = await fetch(url);
    if (!res.ok) return;
    const body = await res.json();
    if (body.success && body.weather) {
      updateWeatherUI(body.weather);
    }
  } catch (err) {
    console.warn('[AquaAlert Home] fetchWeather error:', err);
  }
}

function updateWeatherUI(w) {
  if (!w) return;
  const iconEl = document.getElementById('weather-icon');
  const cityDisp = document.getElementById('weather-city-display');
  const zonePill = document.getElementById('weather-zone-pill');
  const basinPill = document.getElementById('weather-basin-pill');
  const badgeEl = document.getElementById('weather-source-badge');
  const condEl = document.getElementById('weather-condition');
  const tempEl = document.getElementById('weather-temp');
  const feelsEl = document.getElementById('weather-feels');
  const humEl = document.getElementById('weather-humidity');
  const rainRateEl = document.getElementById('weather-rain-rate');
  const rainCatEl = document.getElementById('weather-rain-category');
  const windEl = document.getElementById('weather-wind');
  const pressEl = document.getElementById('weather-pressure');
  const floodBanner = document.getElementById('weather-flood-alert');
  const floodRisk = document.getElementById('weather-flood-risk');
  const floodDesc = document.getElementById('weather-flood-desc');
  const hourlyStrip = document.getElementById('weather-hourly-strip');

  if (iconEl) iconEl.textContent = w.icon || '⛅';
  if (cityDisp) cityDisp.textContent = `${w.area || w.city} Weather`;
  if (zonePill) zonePill.textContent = w.zone || w.state || 'Local Micro-Catchment';
  if (basinPill) basinPill.textContent = w.basin || 'Storm Drainage Basin';

  if (badgeEl) {
    badgeEl.textContent = w.is_live_api ? 'LIVE API' : 'LOCAL MODEL';
    badgeEl.className = w.is_live_api ? 'weather-badge' : 'weather-badge badge--offline';
  }
  if (condEl) condEl.textContent = `${w.condition} • ${w.city}${w.state ? ', ' + w.state : ''}`;
  if (tempEl) tempEl.textContent = `${Number(w.temperature).toFixed(1)}°C`;
  if (feelsEl) feelsEl.textContent = `Feels like ${Number(w.feels_like).toFixed(1)}°C`;
  if (humEl) humEl.textContent = `${w.humidity}%`;
  if (rainRateEl) rainRateEl.textContent = `${Number(w.precipitation_rate_mm_h).toFixed(1)} mm/h`;
  if (windEl) windEl.textContent = `${Number(w.wind_speed_kmh).toFixed(1)} km/h`;
  if (pressEl) pressEl.textContent = `${w.surface_pressure_hpa} hPa`;

  if (w.flood_impact) {
    if (rainCatEl) rainCatEl.textContent = w.flood_impact.category;
    if (floodRisk) floodRisk.textContent = `FLOOD THREAT: ${w.flood_impact.risk_level} (${w.flood_impact.category})`;
    if (floodDesc) floodDesc.textContent = `${w.flood_impact.warning} — ${w.flood_impact.drain_impact}`;
    if (floodBanner) {
      floodBanner.className = 'weather-flood-banner';
      if (w.flood_impact.risk_level === 'CRITICAL') floodBanner.classList.add('risk--critical');
      else if (w.flood_impact.risk_level === 'HIGH') floodBanner.classList.add('risk--high');
      else if (w.flood_impact.risk_level === 'WARNING') floodBanner.classList.add('risk--warning');
    }
  }

  if (hourlyStrip && Array.isArray(w.hourly_hours)) {
    hourlyStrip.innerHTML = w.hourly_hours.map((h, i) => {
      const rain = w.hourly_rain && w.hourly_rain[i] !== undefined ? w.hourly_rain[i] : 0;
      const t = w.hourly_temp && w.hourly_temp[i] !== undefined ? w.hourly_temp[i] : '--';
      return `
        <div class="weather-hourly-item">
          <span class="hourly-time">${escapeHtml(h)}</span>
          <span class="hourly-temp">${t}°C</span>
          <span class="hourly-rain">${rain > 0 ? rain + 'mm' : '—'}</span>
        </div>
      `;
    }).join('');
  }
}

socket.on('weather_update', (data) => {
  console.log('[AquaAlert Home] Live Weather Telemetry received:', data);
  updateWeatherUI(data);
});

/* ── Init ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  fetchLatest();
  fetchRainLatest();
  fetchWeather({ area: 'mumbai_dadar' });
  startLiveClock();
  startOfflineWatchdog();

  // Area selector change
  const areaSelect = document.getElementById('weather-area-select');
  if (areaSelect) {
    areaSelect.addEventListener('change', (e) => {
      fetchWeather({ area: e.target.value });
    });
  }

  // Area custom text search
  const areaSearchInput = document.getElementById('weather-area-search');
  const btnSearchArea = document.getElementById('btn-search-area');

  function doAreaSearch() {
    if (!areaSearchInput) return;
    const query = areaSearchInput.value.trim();
    if (!query) return;
    fetchWeather({ area: query, city: query });
  }

  if (btnSearchArea) {
    btnSearchArea.addEventListener('click', doAreaSearch);
  }
  if (areaSearchInput) {
    areaSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAreaSearch();
      }
    });
  }

  // GPS Current Area Detection
  const btnGps = document.getElementById('btn-gps-area');
  if (btnGps) {
    btnGps.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }
      btnGps.textContent = '⏳ Locating...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btnGps.textContent = '📍 GPS';
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          fetchWeather({ lat, lon });
        },
        (err) => {
          btnGps.textContent = '📍 GPS';
          console.warn('[AquaAlert] Geolocation error:', err);
          alert('Could not retrieve GPS location: ' + err.message);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  // Refresh button
  const btnRefresh = document.getElementById('btn-refresh-weather');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchWeather({ area: currentTargetArea }, true);
    });
  }

  // Auto-refresh weather every 60 seconds
  setInterval(() => {
    fetchWeather({ area: currentTargetArea });
  }, 60000);

  // LCD Theme Switchers
  const btnBlue = document.getElementById('btn-theme-blue');
  const btnGreen = document.getElementById('btn-theme-green');
  const lcdMod = document.getElementById('lcd-hardware-module');

  if (btnBlue && btnGreen && lcdMod) {
    btnBlue.addEventListener('click', () => {
      lcdMod.classList.add('lcd-theme--blue');
      lcdMod.classList.remove('lcd-theme--green');
      btnBlue.classList.add('active');
      btnGreen.classList.remove('active');
    });
    btnGreen.addEventListener('click', () => {
      lcdMod.classList.add('lcd-theme--green');
      lcdMod.classList.remove('lcd-theme--blue');
      btnGreen.classList.add('active');
      btnBlue.classList.remove('active');
    });
  }

  // Gentle live wave ticker for home page when in standby
  setInterval(() => {
    if (isOnline) return;
    const wave = (Math.random() - 0.48) * 0.3;
    lastKnownLcdWaterLevel = Math.max(5, Math.min(95, lastKnownLcdWaterLevel + wave));
    lastKnownLcdPct = Math.round(lastKnownLcdWaterLevel);
    updateVirtualLCD(lastKnownLcdWaterLevel, lastKnownLcdPct, percentToStatus(lastKnownLcdPct), false);
  }, 2000);

  // Initialize Arabian Sea High / Low Tide Widget
  initSeaTideWidget();

  console.log('[AquaAlert Home] Ready');
});

/* ── Sea Tide Telemetry Controller ────────────────────────── */
function initSeaTideWidget() {
  const tideEls = {
    heightVal: document.getElementById('tide-height-val'),
    gateBadge: document.getElementById('tide-gate-badge'),
    phaseBadge: document.getElementById('tide-phase-badge'),
    phaseDesc: document.getElementById('tide-phase-desc'),
    gaugeSub: document.getElementById('tide-gauge-sub'),
    peakTime: document.getElementById('tide-peak-time'),
    peakHeight: document.getElementById('tide-peak-height'),
    nextLow: document.getElementById('tide-next-low'),
    nextLowHeight: document.getElementById('tide-next-low-height'),
    gaugeFill: document.getElementById('tide-gauge-fill'),
    gaugeNeedle: document.getElementById('tide-gauge-needle'),
    scheduleStrip: document.getElementById('tide-schedule-strip'),
    outfallsGrid: document.getElementById('tide-outfalls-grid'),
    advisoryText: document.getElementById('tide-advisory-text'),
    btnRefresh: document.getElementById('btn-refresh-tide'),
    btnSurge: document.getElementById('btn-tide-surge'),
    btnHigh: document.getElementById('btn-tide-high'),
    btnLow: document.getElementById('btn-tide-low'),
    btnNormal: document.getElementById('btn-tide-normal'),
  };

  if (!tideEls.heightVal) return;

  async function fetchTide() {
    try {
      const res = await fetch('/api/tide');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.tide) {
        renderTideUI(data.tide);
      }
    } catch (err) {
      console.warn('[AquaAlert Tide] Fetch error:', err);
    }
  }

  function renderTideUI(tide) {
    if (!tide) return;
    const h = Number(tide.height_m || 4.62);
    if (tideEls.heightVal) {
      tideEls.heightVal.textContent = h.toFixed(2);
    }
    const isLocked = Boolean(tide.floodgates_locked);
    if (tideEls.gateBadge) {
      tideEls.gateBadge.textContent = isLocked ? 'GATES LOCKED (>4.5m)' : 'GRAVITY DISCHARGE OPEN';
      tideEls.gateBadge.className = 'tide-gate-badge ' + (isLocked ? 'gate-locked' : 'gate-open');
    }
    if (tideEls.phaseBadge) {
      tideEls.phaseBadge.textContent = tide.phase || (tide.is_high_tide ? '🌊 HIGH TIDE' : '🔻 LOW TIDE');
      tideEls.phaseBadge.style.color = isLocked ? '#fca5a5' : '#7dd3fc';
      tideEls.phaseBadge.style.background = isLocked ? 'rgba(239, 68, 68, 0.18)' : 'rgba(56, 189, 248, 0.15)';
      tideEls.phaseBadge.style.borderColor = isLocked ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.3)';
    }
    if (tideEls.phaseDesc) {
      tideEls.phaseDesc.textContent = isLocked
        ? 'Gravity outfalls prevented by sea backflow'
        : 'Normal seawater drainage nominal';
    }
    if (tideEls.gaugeSub) {
      const diff = (h - 4.50).toFixed(2);
      if (h >= 4.50) {
        tideEls.gaugeSub.textContent = `Critical: +${diff}m above 4.50m Lockout`;
        tideEls.gaugeSub.style.color = '#f87171';
      } else {
        tideEls.gaugeSub.textContent = `Nominal: ${(4.50 - h).toFixed(2)}m buffer below surge lockout`;
        tideEls.gaugeSub.style.color = '#34d399';
      }
    }
    if (tideEls.peakTime && (tide.peak_high_tide || tide.peak_time)) {
      tideEls.peakTime.textContent = (tide.peak_high_tide && tide.peak_high_tide.time) || tide.peak_time || '14:48 IST';
    }
    if (tideEls.peakHeight && tide.peak_high_tide) {
      tideEls.peakHeight.textContent = `Height: ${(tide.peak_high_tide.height_m || 4.62).toFixed(2)}m (Spring Peak)`;
    }
    if (tideEls.nextLow && (tide.evening_low_tide || tide.next_low_tide)) {
      const lowObj = tide.evening_low_tide;
      tideEls.nextLow.textContent = lowObj ? lowObj.time : (tide.next_low_tide.split(' ')[0] || '20:30 IST');
    }
    if (tideEls.nextLowHeight) {
      const lowH = tide.evening_low_tide ? tide.evening_low_tide.height_m : 1.10;
      tideEls.nextLowHeight.textContent = `Height: ${Number(lowH).toFixed(2)}m (Gravity Outflow)`;
    }
    if (tideEls.gaugeFill) {
      const pct = Math.min(100, Math.max(5, (h / 5.5) * 100));
      tideEls.gaugeFill.style.width = pct + '%';
    }
    if (tideEls.gaugeNeedle) {
      tideEls.gaugeNeedle.textContent = `🌊 ${h.toFixed(2)}m`;
    }
    if (tideEls.advisoryText && tide.advisory) {
      tideEls.advisoryText.textContent = tide.advisory;
    }

    if (tideEls.scheduleStrip && Array.isArray(tide.schedule)) {
      tideEls.scheduleStrip.innerHTML = tide.schedule.map(item => {
        const isHigh = item.type.toLowerCase().includes('high');
        const icon = isHigh ? '🌊' : (item.label.toLowerCase().includes('morning') ? '🌅' : '🌙');
        const isSurge = item.status && item.status.toLowerCase().includes('surge');
        const cardClass = isSurge ? 'active-surge' : (item.status === 'Past' ? 'past' : 'upcoming');
        const statusClass = isSurge ? 'active' : (item.status === 'Past' ? 'past' : 'upcoming');
        return `
          <div class="tide-event-card ${cardClass}">
            <div class="tide-event-icon">${icon}</div>
            <div class="tide-event-info">
              <span class="tide-event-label">${escapeHtml(item.label || item.type)}</span>
              <strong class="tide-event-time">${escapeHtml(item.time)}</strong>
              <span class="tide-event-level">${item.height_m.toFixed(2)} m</span>
            </div>
            <span class="tide-event-status ${statusClass}">${escapeHtml(item.status)}</span>
          </div>
        `;
      }).join('');
    }

    if (tideEls.outfallsGrid && Array.isArray(tide.coastal_outfalls)) {
      tideEls.outfallsGrid.innerHTML = tide.coastal_outfalls.map(outfall => {
        const locked = outfall.status === 'LOCKED';
        return `
          <div class="outfall-pill ${locked ? 'locked' : 'open'}">
            <span class="outfall-name">${escapeHtml(outfall.name)}</span>
            <span class="outfall-status">${locked ? '🔒 LOCKED' : '🟢 OPEN'} • ${escapeHtml(outfall.pumps)}</span>
          </div>
        `;
      }).join('');
    }
  }

  async function simulateTide(scenario) {
    try {
      const res = await fetch('/api/tide/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.tide) {
        renderTideUI(json.tide);
      }
    } catch (e) {
      console.warn('[AquaAlert Tide] Simulation error:', e);
    }
  }

  if (tideEls.btnRefresh) {
    tideEls.btnRefresh.addEventListener('click', fetchTide);
  }
  if (tideEls.btnSurge) {
    tideEls.btnSurge.addEventListener('click', () => simulateTide('high_tide_surge'));
  }
  if (tideEls.btnHigh) {
    tideEls.btnHigh.addEventListener('click', () => simulateTide('high_tide_normal'));
  }
  if (tideEls.btnLow) {
    tideEls.btnLow.addEventListener('click', () => simulateTide('low_tide'));
  }
  if (tideEls.btnNormal) {
    tideEls.btnNormal.addEventListener('click', () => simulateTide('normal'));
  }

  fetchTide();
  setInterval(fetchTide, 15000);

  window.updateAquaAlertTide = renderTideUI;
}

