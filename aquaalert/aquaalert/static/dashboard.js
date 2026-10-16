/* ═══════════════════════════════════════════════════════════════════════
   AquaAlert Dashboard — Real-time JavaScript
   ═══════════════════════════════════════════════════════════════════════

   Features:
     - Socket.IO WebSocket listener for real-time ESP32 data
     - Live line chart (last 20 readings) with Chart.js
     - Historical bar chart (last 50 readings) from /api/history
     - Offline watchdog: marks ESP32 OFFLINE after 10s of silence
     - Alert banner for WARNING / HIGH / CRITICAL states
     - Status indicator row with glowing active state
     - Auto-refresh historical chart every 30 seconds
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Configuration ───────────────────────────────────────────────────── */
const OFFLINE_THRESHOLD  = 10000;   // 10 seconds in ms
const LIVE_CHART_MAX_PTS = 20;      // max points on live line chart
const HISTORY_LIMIT      = 50;      // readings to fetch from /api/history
const HISTORY_REFRESH_MS = 30000;   // refresh seasonal chart every 30s
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ── State ───────────────────────────────────────────────────────────── */
let lastDataTime = 0;    // epoch ms when last sensor_update arrived
let isOnline     = false;

/* ── DOM References ──────────────────────────────────────────────────── */
const el = {
  esp32Status:  document.getElementById('esp32-status'),
  statusDot:    document.getElementById('status-dot'),
  waterPct:     document.getElementById('water-percentage'),
  waterDist:    document.getElementById('water-distance'),
  waterLevelCm: document.getElementById('water-level-cm'),
  waterStatus:  document.getElementById('water-status'),
  deviceId:     document.getElementById('device-id'),
  alertBanner:  document.getElementById('alert-banner'),
  alertIcon:    document.getElementById('alert-icon'),
  alertMessage: document.getElementById('alert-message'),
  lastUpdated:  document.getElementById('last-updated'),
  indNormal:    document.getElementById('status-normal'),
  indWarning:   document.getElementById('status-warning'),
  indHigh:      document.getElementById('status-high'),
  indCritical:  document.getElementById('status-critical'),
  hwLedGreen:           document.getElementById('hw-led-green'),
  hwLedYellow:          document.getElementById('hw-led-yellow'),
  hwLedRed:             document.getElementById('hw-led-red'),
  quickMin:             document.getElementById('quick-min'),
  quickMax:             document.getElementById('quick-max'),
  quickAvg:             document.getElementById('quick-avg'),
  quickTrend:           document.getElementById('quick-trend'),
  rainAmount:           document.getElementById('rain-amount'),
  rainStatusBadge:      document.getElementById('rain-status-badge'),
  lastRainDatetimeText: document.getElementById('last-rain-datetime-text'),
  liveClockText:        document.getElementById('live-clock-text'),
  liveDateText:         document.getElementById('live-date-text'),
  rainEventsTbody:      document.getElementById('dashboard-rain-events-tbody'),
  lcdLine1:             document.getElementById('lcd-line-1'),
  lcdLine2:             document.getElementById('lcd-line-2'),
  lcdRow1:              document.getElementById('lcd-row-1'),
  lcdRow2:              document.getElementById('lcd-row-2'),
  lcdStatusDot:         document.getElementById('lcd-status-dot'),
  lcdSyncBadge:         document.getElementById('lcd-sync-badge'),
  simSourceTag:         document.getElementById('sim-source-tag'),
  buzzerIcon:           document.getElementById('buzzer-icon'),
  buzzerInfoText:       document.getElementById('buzzer-info-text'),
  lcdSubtext:           document.getElementById('lcd-subtext'),
};

/* ── Helper Functions ────────────────────────────────────────────────── */

/**
 * Sanitize untrusted strings to prevent XSS injection.
 * @param {*} str
 * @returns {string}
 */
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
 * Returns the hex color associated with a status string.
 * @param {string} status - NORMAL | WARNING | HIGH | CRITICAL
 * @returns {string} Hex color code
 */
function getStatusColor(status) {
  const colors = {
    NORMAL:   '#10b981',
    WARNING:  '#f59e0b',
    HIGH:     '#f97316',
    CRITICAL: '#ef4444',
  };
  return colors[status] || '#94a3b8';
}

/**
 * Returns a semi-transparent rgba color for a given status.
 * @param {string} status
 * @param {number} alpha - 0 to 1
 */
function getStatusColorAlpha(status, alpha = 0.5) {
  const hex = getStatusColor(status).replace('#', '');
  const r   = parseInt(hex.slice(0, 2), 16);
  const g   = parseInt(hex.slice(2, 4), 16);
  const b   = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Map water level percentage to status string.
 * Mirrors the server-side calculate_status() function.
 * @param {number} pct - 0 to 100
 */
function percentToStatus(pct) {
  if (pct >= 85) return 'CRITICAL';
  if (pct >= 70) return 'HIGH';
  if (pct >= 50) return 'WARNING';
  return 'NORMAL';
}

/**
 * Format a Date or ISO string as HH:MM:SS.
 * @param {Date|string} d
 */
function formatTime(d) {
  return (d instanceof Date ? d : new Date(d)).toTimeString().slice(0, 8);
}

/* ── Online / Offline State ──────────────────────────────────────────── */

/**
 * Update the ESP32 online/offline indicator in the UI.
 * @param {boolean} online
 */
function setOnlineState(online) {
  isOnline = online;
  if (online) {
    if (el.esp32Status) el.esp32Status.textContent = 'ONLINE';
    if (el.statusDot) el.statusDot.className = 'status-dot dot--online';
    if (el.lcdStatusDot) el.lcdStatusDot.className = 'lcd-status-dot dot--online';
    if (el.lcdSyncBadge) el.lcdSyncBadge.textContent = 'ESP32 SYNCED';
  } else {
    if (el.esp32Status) el.esp32Status.textContent = 'OFFLINE';
    if (el.statusDot) el.statusDot.className = 'status-dot dot--offline';
    hideAlertBanner();
    updateHardwareLeds('OFFLINE', false);
    updateVirtualLCD(0, 0, 'OFFLINE', false);
  }
}

/**
 * Start a 1-second interval that flips the device to OFFLINE
 * if no data has arrived within OFFLINE_THRESHOLD ms.
 */
function startOfflineWatchdog() {
  setInterval(() => {
    if (lastDataTime > 0 && Date.now() - lastDataTime > OFFLINE_THRESHOLD && isOnline) {
      setOnlineState(false);
    }
  }, 1000);
}

/* ── Alert Banner ────────────────────────────────────────────────────── */

const ALERT_CONFIG = {
  WARNING: {
    cls: 'alert--warning',
    icon: '〜',
    msg: 'WARNING: Water level is elevated — monitor closely',
  },
  HIGH:     {
    cls: 'alert--high',
    icon: '🔶',
    msg: 'HIGH ALERT: Water level is high (70–84%) — inspect immediately',
  },
  CRITICAL: {
    cls: 'alert--critical',
    icon: '🚨',
    msg: 'CRITICAL ALERT: Water level at or above 85% — immediate action required!',
  },
};

/**
 * Show the alert banner styled for the given status.
 * Hides banner if status is NORMAL.
 * @param {string} status
 */
function showAlertBanner(status) {
  const cfg = ALERT_CONFIG[status];
  if (!cfg) { hideAlertBanner(); return; }
  if (!el.alertBanner) return;

  el.alertBanner.classList.remove('hidden', 'alert--warning', 'alert--high', 'alert--critical');
  el.alertBanner.classList.add(cfg.cls);
  if (el.alertIcon) el.alertIcon.textContent = cfg.icon;
  if (el.alertMessage) el.alertMessage.textContent = cfg.msg;
}

function hideAlertBanner() {
  if (!el.alertBanner) return;
  el.alertBanner.classList.add('hidden');
  el.alertBanner.classList.remove('alert--warning', 'alert--high', 'alert--critical');
}

/* ── Status Indicator Row ────────────────────────────────────────────── */

const INDICATOR_MAP = {
  NORMAL:   { el: el.indNormal,  cls: 'active--normal'  },
  WARNING:  { el: el.indWarning, cls: 'active--warning' },
  HIGH:     { el: el.indHigh,    cls: 'active--high'    },
  CRITICAL: { el: el.indCritical, cls: 'active--critical' },
};

/**
 * Highlight the status indicator box that matches the current status.
 * Removes highlight from all others.
 * @param {string} status
 */
function highlightIndicator(status) {
  // Remove active class from all boxes
  Object.values(INDICATOR_MAP).forEach(({ el: box, cls }) => {
    if (box) box.classList.remove(cls);
  });
  // Add to matching box
  const match = INDICATOR_MAP[status];
  if (match && match.el) match.el.classList.add(match.cls);
}

/**
 * Synchronize virtual LED lamps on dashboard with ESP32 GPIO indicators:
 *   GREEN  -> GPIO 27 -> NORMAL (< 50%)
 *   YELLOW -> GPIO 26 -> WARNING (50 - 69%)
 *   RED    -> GPIO 25 -> HIGH / CRITICAL (>= 70%)
 */
function updateHardwareLeds(status, online = true) {
  if (el.hwLedGreen) el.hwLedGreen.classList.remove('active--green');
  if (el.hwLedYellow) el.hwLedYellow.classList.remove('active--yellow');
  if (el.hwLedRed) el.hwLedRed.classList.remove('active--red');

  if (!online) return;

  if (status === 'NORMAL' && el.hwLedGreen) {
    el.hwLedGreen.classList.add('active--green');
  } else if (status === 'WARNING' && el.hwLedYellow) {
    el.hwLedYellow.classList.add('active--yellow');
  } else if ((status === 'HIGH' || status === 'CRITICAL') && el.hwLedRed) {
    el.hwLedRed.classList.add('active--red');
  }
}

/**
 * Render 16 discrete character matrix blocks per line on the LCD.
 * Each cell has individual styling, active character illumination,
 * and unlit ghost pixel patterns.
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

  // Backward compatibility for direct text readers & tests
  if (el.lcdLine1) el.lcdLine1.textContent = l1;
  if (el.lcdLine2) el.lcdLine2.textContent = l2;
}

let lastKnownLcdWaterLevel = 55.0;
let lastKnownLcdPct = 55;
let lastKnownLcdStatus = 'WARNING';

/**
 * Synchronize virtual 16x2 I2C LCD display widget with physical ESP32 LCD:
 *   Line 1 (16 chars): "AQUAALERT   %3d%%" (e.g. "AQUAALERT   55%")
 *   Line 2 (16 chars): "%-8s %7s"         (e.g. "55cm     WARNING")
 *   Matches void updateLCD(...) in esp32/aquaalert_esp32.ino lines 626-657.
 */
function updateVirtualLCD(waterLevel, pct, status, online = true, source = 'stream') {
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

  // Line 1: Exactly 16 chars: "AQUAALERT   " (12 chars) + 3d% (4 chars)
  const pctStr = `${String(roundPct).padStart(3, ' ')}%`;
  const line1 = `AQUAALERT   ${pctStr}`;

  // Line 2: Exactly 16 chars: left-aligned "XXcm" (8 chars) + 1 space + right-aligned status (7 chars)
  const lvlStr = `${roundLvl}cm`.padEnd(8, ' ');
  let rightSide = statusStr.slice(0, 7).padStart(7, ' ');
  if (!online && !isLiveSimActive) {
    rightSide = 'STANDBY';
  }
  const line2 = `${lvlStr} ${rightSide}`;

  renderLCDCells(line1, line2);

  if (el.lcdStatusDot) {
    el.lcdStatusDot.className = (online || isLiveSimActive) ? 'lcd-status-dot dot--online' : 'lcd-status-dot dot--offline';
  }
  if (el.lcdSyncBadge) {
    if (source === 'esp32_hardware') {
      el.lcdSyncBadge.textContent = 'ESP32 BROADCAST';
    } else if (isLiveSimActive) {
      el.lcdSyncBadge.textContent = 'LIVE STREAM';
    } else {
      el.lcdSyncBadge.textContent = 'OFFLINE';
    }
  }

  // Synchronize Buzzer status display matching esp32/aquaalert_esp32.ino
  if (el.buzzerInfoText && el.buzzerIcon) {
    if (roundPct >= 85) {
      el.buzzerIcon.textContent = '🚨';
      el.buzzerInfoText.innerHTML = 'Passive Piezo Buzzer • <strong>GPIO 32: CONTINUOUS ALARM</strong> (Flood Risk ≥ 85%!)';
    } else if (roundPct >= 70) {
      el.buzzerIcon.textContent = '⚠️';
      el.buzzerInfoText.innerHTML = 'Passive Piezo Buzzer • <strong>GPIO 32: PULSED BEEP</strong> (High Warning 70–84%)';
    } else {
      el.buzzerIcon.textContent = '🔊';
      el.buzzerInfoText.innerHTML = 'Passive Piezo Buzzer • <strong>GPIO 32: SILENT</strong> (Normal / Standby &lt; 70%)';
    }
  }
}

/* ── Stat Card Updater ───────────────────────────────────────────────── */

/**
 * Update all dashboard stat cards with new sensor data.
 * Accepts both snake_case (from DB/REST) and camelCase (raw ESP32) keys.
 *
 * @param {Object} data - Sensor payload from backend or Socket.IO event
 */
function updateStatCards(data) {
  const pct    = parseFloat(data.percentage   ?? data.water_level_pct ?? 0).toFixed(1);
  const dist   = parseFloat(data.distance     ?? data.distance_cm     ?? 0).toFixed(1);
  const lvlCm  = parseFloat(data.water_level  ?? data.water_level_cm  ?? 0).toFixed(1);
  const status = (data.status ?? percentToStatus(parseFloat(pct))).toUpperCase();
  const device = data.device_id ?? 'AQUA-001';
  const sensorTs = data.timestamp ? new Date(data.timestamp) : new Date();

  if (el.waterPct) el.waterPct.textContent = `${pct}%`;
  if (el.waterDist) el.waterDist.textContent = `${dist} cm`;
  if (el.waterLevelCm) el.waterLevelCm.textContent = `${lvlCm} cm`;
  if (el.deviceId) el.deviceId.textContent = device;

  if (el.waterStatus) el.waterStatus.textContent = status;
  if (el.waterStatus) el.waterStatus.className = `status-badge badge--${status.toLowerCase()}`;

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

  highlightIndicator(status);

  // Synchronize virtual physical hardware indicators (LEDs & 16x2 LCD)
  updateHardwareLeds(status, true);
  updateVirtualLCD(lvlCm, pct, status, true);

  if (el.lastUpdated) el.lastUpdated.textContent = formatTime(sensorTs);

  // Update rain status if rainfall telemetry is provided
  if (data.rainfall !== undefined && data.rainfall !== null) {
    updateRainUI({
      rainfall_mm: data.rainfall,
      last_rain_datetime: data.last_rain_datetime || new Date().toLocaleString(),
    });
  }
}


/* ── Live Chart (Dual-Axis Water Level & Rainfall Correlation) ──────── */

let liveDataHistory = []; // Buffer of recent readings for velocity & slope
let isLivePaused = false;
let isRainBarsVisible = true;

/**
 * Custom Chart.js plugin: draws subtle background status zones
 * behind the data points.
 */
const backgroundZonePlugin = {
  id: 'backgroundZones',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;

    const { top, bottom, left, right } = chartArea;
    const yScale = scales.y;

    const zones = [
      { from: 0,  to: 50,  color: 'rgba(16, 185, 129, 0.05)' },  // NORMAL green
      { from: 50, to: 70,  color: 'rgba(245, 158,  11, 0.07)' },  // WARNING yellow
      { from: 70, to: 85,  color: 'rgba(249, 115,  22, 0.10)' },  // HIGH orange
      { from: 85, to: 100, color: 'rgba(239, 68,   68, 0.14)' },  // CRITICAL red
    ];

    ctx.save();
    zones.forEach(({ from, to, color }) => {
      const yFrom = yScale.getPixelForValue(to);
      const yTo   = yScale.getPixelForValue(from);
      ctx.fillStyle = color;
      ctx.fillRect(left, yFrom, right - left, yTo - yFrom);
    });
    ctx.restore();
  },
};

/**
 * Custom Chart.js plugin: draws crisp, dashed alarm threshold lines
 * with glowing micro-badge chips across the live timeline.
 */
const thresholdAlarmLinesPlugin = {
  id: 'thresholdAlarmLines',
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const { left, right } = chartArea;
    const yScale = scales.y;

    const thresholds = [
      { val: 50, color: '#f59e0b', label: '50% WARN' },
      { val: 70, color: '#f97316', label: '70% HIGH' },
      { val: 85, color: '#ef4444', label: '85% CRIT' },
    ];

    ctx.save();
    thresholds.forEach(({ val, color, label }) => {
      const yPos = yScale.getPixelForValue(val);
      if (yPos < chartArea.top || yPos > chartArea.bottom) return;

      // Dashed alarm threshold line
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = color;
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.stroke();

      // Right-side badge chip
      ctx.setLineDash([]);
      ctx.font = '600 9px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(label).width;
      const badgeW = textWidth + 8;
      const badgeH = 14;
      const badgeX = right - badgeW - 4;
      const badgeY = yPos - badgeH / 2;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + badgeW / 2, yPos);
    });
    ctx.restore();
  },
};

let liveChart;

/**
 * Calculate rate of rise (cm/min) based on recent readings.
 */
function calculateRateOfRise(currentLvlCm, currentTs) {
  if (liveDataHistory.length < 2) return 0;
  const oldest = liveDataHistory[0];
  const deltaCm = currentLvlCm - oldest.cm;
  const deltaMin = (currentTs.getTime() - oldest.ts.getTime()) / 60000;
  if (deltaMin <= 0) return 0;
  return deltaCm / deltaMin;
}

/**
 * Update the Live Surge Velocity meter badge in the chart header.
 */
function updateSurgeMeter(currentLvlCm, currentPct, ts) {
  const now = (ts instanceof Date) ? ts : new Date(ts);
  liveDataHistory.push({ cm: currentLvlCm, pct: currentPct, ts: now });
  if (liveDataHistory.length > 8) liveDataHistory.shift();

  const rate = calculateRateOfRise(currentLvlCm, now);
  const surgeEl = document.getElementById('live-surge-rate');
  const iconEl  = document.getElementById('surge-icon');
  const textEl  = document.getElementById('surge-text');
  const valEl   = document.getElementById('live-current-val');

  if (valEl) {
    valEl.textContent = `${currentPct.toFixed(1)}% (${currentLvlCm.toFixed(1)} cm)`;
  }

  if (!surgeEl || !textEl || !iconEl) return;

  if (rate >= 1.5) {
    surgeEl.className = 'surge-rate-badge surge-rate--rising';
    iconEl.textContent = '▲';
    textEl.textContent = `Surge: +${rate.toFixed(1)} cm/min (Rapid Rise)`;
  } else if (rate >= 0.3) {
    surgeEl.className = 'surge-rate-badge surge-rate--rising';
    iconEl.textContent = '▲';
    textEl.textContent = `Rate: +${rate.toFixed(1)} cm/min (Rising)`;
  } else if (rate <= -0.3) {
    surgeEl.className = 'surge-rate-badge surge-rate--falling';
    iconEl.textContent = '▼';
    textEl.textContent = `Rate: ${rate.toFixed(1)} cm/min (Receding)`;
  } else {
    surgeEl.className = 'surge-rate-badge surge-rate--stable';
    iconEl.textContent = '━';
    textEl.textContent = `Rate: 0.0 cm/min (Stable)`;
  }
}

/**
 * Initialize the dual-axis live chart with rainfall correlation & threshold alarms.
 */
function initLiveChart() {
  const ctx = document.getElementById('live-chart').getContext('2d');

  liveChart = new Chart(ctx, {
    data: {
      datasets: [
        {
          type: 'bar',
          label: 'Rainfall (mm)',
          data: [],
          backgroundColor: 'rgba(56, 189, 248, 0.45)',
          borderColor: '#38bdf8',
          borderWidth: 1,
          borderRadius: 3,
          barPercentage: 0.45,
          yAxisID: 'yRain',
          order: 2,
        },
        {
          type: 'line',
          label: 'Water Level (%)',
          data: [],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.14)',
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#0a0e1a',
          pointRadius: 4,
          pointHoverRadius: 7,
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
          order: 1,
        },
      ],
    },
    plugins: [backgroundZonePlugin, thresholdAlarmLinesPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300, easing: 'easeInOutQuart' },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          borderColor: 'rgba(56, 189, 248, 0.3)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (item) => {
              if (item.dataset.label.includes('Rainfall')) {
                return ` 🌧️ Rainfall: ${parseFloat(item.parsed.y || 0).toFixed(1)} mm`;
              }
              const p = parseFloat(item.parsed.y || 0).toFixed(1);
              return ` 🌊 Water Level: ${p}% (${percentToStatus(parseFloat(p))})`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'second',
            displayFormats: { second: 'HH:mm:ss' },
            tooltipFormat: 'HH:mm:ss',
          },
          ticks: { color: '#94a3b8', maxTicksLimit: 6, maxRotation: 0 },
          grid: { color: 'rgba(30, 41, 59, 0.7)' },
        },
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'Water Level (%)',
            color: '#94a3b8',
            font: { size: 11, weight: '600' },
          },
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          grid: { color: 'rgba(30, 41, 59, 0.7)' },
        },
        yRain: {
          position: 'right',
          min: 0,
          suggestedMax: 60,
          title: {
            display: true,
            text: 'Rainfall (mm)',
            color: '#38bdf8',
            font: { size: 11, weight: '600' },
          },
          ticks: { color: '#38bdf8', callback: (v) => v + ' mm' },
          grid: { display: false },
        },
      },
    },
  });
}

/**
 * Append a synchronized telemetry point to the live chart and update rate meter.
 */
function addLivePoint(pct, time, rainfall = 0, waterLevelCm = null) {
  const ts = (time instanceof Date) ? time : new Date(time);
  const p  = parseFloat(pct || 0);
  const rf = parseFloat(rainfall || 0);
  const cm = waterLevelCm !== null ? parseFloat(waterLevelCm) : p;

  updateSurgeMeter(cm, p, ts);

  if (isLivePaused || !liveChart) return;

  const rainDataset  = liveChart.data.datasets[0];
  const waterDataset = liveChart.data.datasets[1];

  rainDataset.data.push({ x: ts, y: rf });
  waterDataset.data.push({ x: ts, y: p });

  if (waterDataset.data.length > LIVE_CHART_MAX_PTS) {
    waterDataset.data.shift();
    rainDataset.data.shift();
  }

  // Dynamic status color reacting on water level
  if (p >= 85) {
    waterDataset.borderColor = '#ef4444';
    waterDataset.backgroundColor = 'rgba(239, 68, 68, 0.28)';
    waterDataset.pointBackgroundColor = '#ef4444';
  } else if (p >= 70) {
    waterDataset.borderColor = '#f97316';
    waterDataset.backgroundColor = 'rgba(249, 115, 22, 0.22)';
    waterDataset.pointBackgroundColor = '#f97316';
  } else if (p >= 50) {
    waterDataset.borderColor = '#f59e0b';
    waterDataset.backgroundColor = 'rgba(245, 158, 11, 0.18)';
    waterDataset.pointBackgroundColor = '#f59e0b';
  } else {
    waterDataset.borderColor = '#10b981';
    waterDataset.backgroundColor = 'rgba(16, 185, 129, 0.14)';
    waterDataset.pointBackgroundColor = '#10b981';
  }

  liveChart.update('active');
}

/* ── Month-wise seasonal trend chart ─────────────────────────────────── */

let historyChart;
let yearMonthData = [];
let predictionData = [];

/**
 * Initialize the month-wise trend chart on the history-chart canvas.
 * It shows average water level by month and flood risk trend by month.
 */
function initHistoryChart() {
  const ctx = document.getElementById('history-chart').getContext('2d');

  historyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          type: 'bar',
          label: 'Avg Water Level (m)',
          data: [],
          backgroundColor: 'rgba(6, 182, 212, 0.65)',
          borderColor: '#06b6d4',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Flood Risk %',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          pointBackgroundColor: '#ef4444',
          pointRadius: 4,
          borderWidth: 2,
          tension: 0.35,
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: 'Forecast Water Level (m)',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          pointBackgroundColor: '#f59e0b',
          pointRadius: 3,
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'Forecast Flood Risk %',
          data: [],
          borderColor: '#f97316',
          backgroundColor: 'transparent',
          pointBackgroundColor: '#f97316',
          pointRadius: 3,
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.35,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8', usePointStyle: true, padding: 14 } },
        tooltip: {
          backgroundColor: '#1a2235',
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          borderColor: '#1e293b',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label;
              if (label.includes('Water Level')) return ` ${ctx.parsed.y.toFixed(2)} m`;
              return ` ${ctx.parsed.y.toFixed(1)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxRotation: 0 },
          grid: { color: 'rgba(30, 41, 59, 0.8)' },
        },
        y: {
          beginAtZero: false,
          title: {
            display: true,
            text: 'Avg Water Level (m)',
            color: '#94a3b8',
            font: { size: 11 },
          },
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(30, 41, 59, 0.8)' },
        },
        y1: {
          position: 'right',
          beginAtZero: false,
          max: 100,
          title: {
            display: true,
            text: 'Flood Risk %',
            color: '#94a3b8',
            font: { size: 11 },
          },
          ticks: { color: '#94a3b8', callback: v => v + '%' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

/**
 * Replace the month-wise chart with the aggregated monthly dataset.
 * @param {Array} monthlyData - Result from /api/analytics/yearmonth
 */
function getMonthSortKey(monthValue) {
  const raw = String(monthValue ?? '').trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;

  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) return numeric;

  const monthIndex = MONTH_NAMES.indexOf(raw.slice(0, 3));
  return monthIndex >= 0 ? monthIndex + 1 : Number.MAX_SAFE_INTEGER;
}

function populateHistoryChart(monthlyData) {
  const selectedYear = document.getElementById('dashboard-year')?.value ?? 'all';
  const filtered = selectedYear === 'all'
    ? monthlyData
    : monthlyData.filter(d => String(d.Year ?? d.year) === selectedYear);

  const orderedMonthly = [...filtered].sort((a, b) => {
    const yearDiff = Number(String(a.Year ?? a.year ?? 0)) - Number(String(b.Year ?? b.year ?? 0));
    if (yearDiff !== 0) return yearDiff;
    return getMonthSortKey(a.Month ?? a.month) - getMonthSortKey(b.Month ?? b.month);
  });

  const labels = orderedMonthly.map(d => d.MonthName || d.month_name || MONTH_NAMES[Number(d.Month ?? d.month) - 1]);
  const waterLevels = orderedMonthly.map(d => parseFloat(d.avg_water_level ?? 0));
  const floodRisk = orderedMonthly.map(d => parseFloat(d.flood_risk_pct ?? 0));

  const orderedForecast = [...(predictionData || [])].sort((a, b) => {
    const aKey = String(a.year_month || a.month_label || '').slice(5, 7);
    const bKey = String(b.year_month || b.month_label || '').slice(5, 7);
    return getMonthSortKey(aKey) - getMonthSortKey(bKey);
  });

  const forecastLabels = orderedForecast.map(d => d.month_label || d.year_month);
  const allLabels = [...labels, ...forecastLabels];

  historyChart.data.labels = allLabels;
  historyChart.data.datasets[0].data = [...waterLevels, ...forecastLabels.map(() => null)];
  historyChart.data.datasets[1].data = [...floodRisk, ...forecastLabels.map(() => null)];
  historyChart.data.datasets[2].data = [...labels.map(() => null), ...orderedForecast.map(d => d.predicted_wl)];
  historyChart.data.datasets[3].data = [...labels.map(() => null), ...orderedForecast.map(d => d.predicted_fr)];

  historyChart.update();
}

/* ── REST API Fetches ────────────────────────────────────────────────── */

/**
 * Fetch the latest sensor reading from /api/latest and populate the UI.
 * Called on page load to seed the dashboard before Socket.IO data arrives.
 */
async function fetchLatest() {
  try {
    const res  = await fetch('/api/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data && data.id) {
      lastDataTime = Date.now();
      setOnlineState(true);
      updateStatCards(data);
      addLivePoint(
        data.percentage ?? 0,
        data.timestamp ?? new Date(),
        data.rainfall ?? 0,
        data.water_level ?? null
      );
      return;
    }
  } catch (err) {
    console.warn('[AquaAlert] fetchLatest failed:', err.message);
  }

  setOnlineState(false);
  if (el.waterPct) el.waterPct.textContent = '--%';
  if (el.waterDist) el.waterDist.textContent = '-- cm';
  if (el.waterLevelCm) el.waterLevelCm.textContent = '-- cm';
  if (el.waterStatus) {
    el.waterStatus.textContent = 'OFFLINE';
    el.waterStatus.className = 'status-badge badge--warning';
  }
  if (el.lastUpdated) el.lastUpdated.textContent = '--:--:--';
  hideAlertBanner();
}

/**
 * Seed the live line chart with the last N recorded water level points
 * from SQLite on page load so the graph is immediately populated.
 */
async function seedLiveChartHistory() {
  try {
    const res = await fetch('/api/history?limit=20&order=asc');
    if (!res.ok) return;
    const items = await res.json();
    if (Array.isArray(items) && items.length > 0 && liveChart) {
      const rainDataset  = liveChart.data.datasets[0];
      const waterDataset = liveChart.data.datasets[1];

      rainDataset.data = items.map((r) => ({
        x: r.timestamp ? new Date(r.timestamp) : new Date(),
        y: parseFloat(r.rainfall ?? 0),
      }));

      waterDataset.data = items.map((r) => ({
        x: r.timestamp ? new Date(r.timestamp) : new Date(),
        y: parseFloat(r.percentage ?? 0),
      }));

      const latest = items[items.length - 1];
      if (latest) {
        updateSurgeMeter(
          parseFloat(latest.water_level ?? latest.percentage ?? 0),
          parseFloat(latest.percentage ?? 0),
          latest.timestamp ? new Date(latest.timestamp) : new Date()
        );
      }
      liveChart.update('none');
    }
  } catch (err) {
    console.warn('[AquaAlert] seedLiveChartHistory error:', err.message);
  }
}

/**
 * Fetch aggregated sensor statistics and status trend.
 */
async function fetchSensorAnalytics() {
  try {
    const res = await fetch('/api/sensor/analytics');
    if (!res.ok) return;
    const data = await res.json();
    if (el.quickMin) el.quickMin.textContent = `${data.min_water_level} cm`;
    if (el.quickMax) el.quickMax.textContent = `${data.max_water_level} cm`;
    if (el.quickAvg) el.quickAvg.textContent = `${data.avg_water_level} cm`;
    if (el.quickTrend) {
      el.quickTrend.textContent = data.trend;
      if (data.trend === 'RISING') el.quickTrend.style.color = '#ef4444';
      else if (data.trend === 'FALLING') el.quickTrend.style.color = '#10b981';
      else el.quickTrend.style.color = '#06b6d4';
    }
  } catch (err) {
    console.warn('[AquaAlert] fetchSensorAnalytics error:', err.message);
  }
}


/**
 * Fetch monthly aggregated data and populate the month-wise chart.
 * Called on page load and then every HISTORY_REFRESH_MS.
 */
async function fetchHistory() {
  try {
    const res  = await fetch('/api/analytics/yearmonth');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    yearMonthData = Array.isArray(data) ? data : [];
    populateYearSelector(yearMonthData);
    populateHistoryChart(yearMonthData);

  } catch (err) {
    console.warn('[AquaAlert] fetchHistory failed:', err.message);
  }
}

function populateYearSelector(data) {
  const selector = document.getElementById('dashboard-year');
  if (!selector) return;
  const current = selector.value;
  const years = [...new Set(data.map(d => String(d.Year ?? d.year)).filter(Boolean))].sort();
  selector.innerHTML = '<option value="all">All years</option>';
  years.forEach(year => selector.add(new Option(year, year)));
  selector.value = years.includes(current) || current === 'all' ? current : 'all';
}

async function fetchPrediction() {
  try {
    const horizon = document.getElementById('dashboard-horizon')?.value ?? '12';
    const res = await fetch(`/api/analytics/prediction?months=${horizon}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    predictionData = data.predictions ?? [];
    populateHistoryChart(yearMonthData);
  } catch (err) {
    console.warn('[AquaAlert] fetchPrediction failed:', err.message);
  }
}

/* ── Flood Risk Map & Multi-Region Hotspots ─────────────────────────── */

let floodMapData = [];
let currentMapMode = 'scatter';
let activeRegionKey = 'all';

const REGIONAL_DATA = {
  all: {
    name: 'All India National Overview',
    icon: '🇮🇳',
    badge: 'NATIONWIDE',
    center: { lat: 22.5, lon: 78.9 },
    zoom: 4,
    desc: 'Displaying 500+ geospatial sensor survey records across India. Select any city or region to inspect high-risk heavy rainfall and chronic waterlogging hotspots.',
    basin: 'Multi-River Catchments',
    rain: '50–350 mm/day',
    hotspots: [],
  },
  mumbai: {
    name: 'Mumbai Metropolitan Region (MMR)',
    icon: '🌊',
    badge: 'KONKAN COASTAL BASIN',
    center: { lat: 19.0760, lon: 72.8777 },
    zoom: 11,
    desc: 'Mithi river floodplain, saucer depressions (Hindmata, Sion), and deep railway underpasses prone to severe waterlogging during Arabian Sea high tides (>4.5m).',
    basin: 'Mithi River & Mahim Creek',
    rain: '200–350 mm/day',
    hotspots: [
      { name: 'Hindmata (Dadar / Parel)', lat: 19.0178, lon: 72.8478, rain: '280–350 mm/day', risk: 'CRITICAL', desc: 'Natural saucer depression; chronic waterlogging basin' },
      { name: 'Kurla (Bail Bazaar & Kamani)', lat: 19.0726, lon: 72.8845, rain: '260–320 mm/day', risk: 'CRITICAL', desc: 'Direct Mithi River floodplain; high risk of residential flooding' },
      { name: 'Gandhi Market / King\'s Circle (Sion)', lat: 19.0345, lon: 72.8596, rain: '250–310 mm/day', risk: 'CRITICAL', desc: 'Low-lying road & railway tracks inundate in heavy rain' },
      { name: 'Milan Subway (Santacruz)', lat: 19.0831, lon: 72.8427, rain: '220–280 mm/day', risk: 'HIGH', desc: 'Deep rail underpass; vehicle submergence zone' },
      { name: 'Andheri Subway (SV Road)', lat: 19.1197, lon: 72.8464, rain: '240–300 mm/day', risk: 'CRITICAL', desc: 'Major east-west underpass; closes repeatedly during monsoon' },
      { name: 'Sakinaka Junction (Andheri East)', lat: 19.1066, lon: 72.8876, rain: '200–260 mm/day', risk: 'HIGH', desc: 'Hill runoff convergence from Powai; flash road waterlogging' },
      { name: 'Chembur (Postal Colony & Shell Colony)', lat: 19.0622, lon: 72.9023, rain: '210–270 mm/day', risk: 'HIGH', desc: 'Tidal backflow via Mahul creek; low elevation drainage' },
      { name: 'Dharavi / Chunabhatti', lat: 19.0435, lon: 72.8631, rain: '230–290 mm/day', risk: 'CRITICAL', desc: 'Mouth of Mithi river drainage; sea-level elevation' },
      { name: 'Bandra (National College / SV Road)', lat: 19.0607, lon: 72.8362, rain: '190–240 mm/day', risk: 'HIGH', desc: 'Gazdarbandh pumping station catchment; high-tide backflow' },
      { name: 'Malad Subway & Goregaon SV Road', lat: 19.1860, lon: 72.8485, rain: '220–275 mm/day', risk: 'HIGH', desc: 'Subway water accumulation; traffic diversion required' },
      { name: 'Dahisar River Basin & Toll Naka', lat: 19.2578, lon: 72.8595, rain: '250–320 mm/day', risk: 'HIGH', desc: 'Dahisar river flash overflow from National Park catchment' },
      { name: 'Vidyavihar Station (LBS Marg)', lat: 19.0798, lon: 72.8974, rain: '210–260 mm/day', risk: 'HIGH', desc: 'Storm drain discharge delays; tracks inundation' },
    ],
  },
  delhi: {
    name: 'Delhi NCR (National Capital Region)',
    icon: '🏛️',
    badge: 'YAMUNA FLOODPLAIN',
    center: { lat: 28.6448, lon: 77.2167 },
    zoom: 11,
    desc: 'Yamuna river overflow upon Hathnikund barrage release, low railway underpasses, and stormwater backpressure into arterial roads and transit rings.',
    basin: 'Yamuna River & Najafgarh Drain',
    rain: '120–220 mm/day',
    hotspots: [
      { name: 'Yamuna Bazar & Kashmere Gate', lat: 28.6667, lon: 77.2333, rain: '160–220 mm/day', risk: 'CRITICAL', desc: 'Direct Yamuna floodplain breach; ISBT road submergence' },
      { name: 'ITO & Vikas Marg Ring Road', lat: 28.6289, lon: 77.2415, rain: '140–190 mm/day', risk: 'CRITICAL', desc: 'Drain No. 12 backflow & regulator breach during high river stage' },
      { name: 'Minto Bridge Underpass', lat: 28.6347, lon: 77.2241, rain: '100–160 mm/day', risk: 'CRITICAL', desc: 'Historic deep railway underpass; rapid stormwater catchment funnel' },
      { name: 'Pragati Maidan Tunnel & Mathura Rd', lat: 28.6180, lon: 77.2435, rain: '130–180 mm/day', risk: 'HIGH', desc: 'Drainage pump overload adjacent to Yamuna canal slopes' },
      { name: 'Pul Prahladpur Railway Underpass', lat: 28.5132, lon: 77.2917, rain: '120–170 mm/day', risk: 'HIGH', desc: 'Deep railway underpass; chronic vehicular traffic stoppage' },
      { name: 'Zakhira Underpass (Rohtak Road)', lat: 28.6675, lon: 77.1601, rain: '110–150 mm/day', risk: 'HIGH', desc: 'Najafgarh trunk drain overflow and railway line depression' },
      { name: 'Dhaula Kuan Underpass', lat: 28.5921, lon: 77.1610, rain: '100–140 mm/day', risk: 'HIGH', desc: 'High-velocity storm runoff descending from Southern Ridge' },
    ],
  },
  bengaluru: {
    name: 'Bengaluru (Greater Bangalore)',
    icon: '🏙️',
    badge: 'INTERCONNECTED LAKES',
    center: { lat: 12.9716, lon: 77.5946 },
    zoom: 11,
    desc: 'Encroached primary stormwater canals (Raja Kaluves), chain lake overflows (Bellandur-Varthur-Hebbal), and valley-bed tech corridor inundation.',
    basin: 'Koramangala-Challaghatta & Hebbal Valley',
    rain: '90–180 mm/day',
    hotspots: [
      { name: 'Silk Board Junction & HSR Layout', lat: 12.9176, lon: 77.6238, rain: '120–170 mm/day', risk: 'CRITICAL', desc: 'Madiwala lake overflow canal constriction; traffic bottleneck' },
      { name: 'Bellandur & Varthur Lake Corridors', lat: 12.9360, lon: 77.6780, rain: '130–190 mm/day', risk: 'CRITICAL', desc: 'Wetland catchment encroachment; backwater breaches into tech corridors' },
      { name: 'Ecospace & Outer Ring Road (ORR)', lat: 12.9260, lon: 77.6830, rain: '110–160 mm/day', risk: 'CRITICAL', desc: 'Valley depression across primary drainage channel' },
      { name: 'Manyata Tech Park (Nagawara)', lat: 13.0489, lon: 77.6200, rain: '100–150 mm/day', risk: 'HIGH', desc: 'Hebbal lake downstream overflow; severe parking lot submergence' },
      { name: 'Rainbow Drive Layout (Sarjapur Rd)', lat: 12.9130, lon: 77.6970, rain: '120–180 mm/day', risk: 'CRITICAL', desc: 'Natural valley bottom; rapid rainwater accumulation from surrounding plateaus' },
      { name: 'Bommanahalli & Bilekahalli', lat: 12.9015, lon: 77.6186, rain: '90–140 mm/day', risk: 'HIGH', desc: 'Stormwater drain siltation; arterial road flooding' },
      { name: 'Majestic / Okalipuram Underpass', lat: 12.9778, lon: 77.5714, rain: '80–130 mm/day', risk: 'HIGH', desc: 'Railway underpass low-point flooding' },
    ],
  },
  chennai: {
    name: 'Chennai (Madras Coastal Plains)',
    icon: '🌴',
    badge: 'COASTAL & DELTA BASIN',
    center: { lat: 13.0827, lon: 80.2707 },
    zoom: 11,
    desc: 'Extremely flat coastal terrain, Northeast Monsoon cloudbursts, overflow of the Adyar and Cooum rivers, and tidal locking of Buckingham Canal.',
    basin: 'Adyar, Cooum & Buckingham Canal',
    rain: '180–320 mm/day',
    hotspots: [
      { name: 'Velachery & Madipakkam', lat: 12.9759, lon: 80.2207, rain: '220–310 mm/day', risk: 'CRITICAL', desc: 'Adjacent to Pallikaranai marshland; runoff pooling from lake surplus' },
      { name: 'Mudichur & Tambaram West', lat: 12.9189, lon: 80.0880, rain: '240–330 mm/day', risk: 'CRITICAL', desc: 'Upstream Adyar River floodplain; high risk of residential submersion' },
      { name: 'T. Nagar (Usman Road & G.N. Chetty)', lat: 13.0418, lon: 80.2341, rain: '180–250 mm/day', risk: 'CRITICAL', desc: 'Mambalam canal backwater choke point; low commercial bowl' },
      { name: 'Manapakkam & Ramapuram', lat: 13.0189, lon: 80.1780, rain: '200–280 mm/day', risk: 'HIGH', desc: 'Adyar river bend backwater inundation' },
      { name: 'Korattur & Ambattur Estate', lat: 13.1118, lon: 80.1700, rain: '170–240 mm/day', risk: 'HIGH', desc: 'Industrial estate low basin; surplus from Korattur Lake' },
      { name: 'Pulianthope & Vyasarpadi', lat: 13.1018, lon: 80.2600, rain: '190–260 mm/day', risk: 'HIGH', desc: 'Otteri Nullah overflow; sub-sea-level street levels' },
      { name: 'Sholinganallur & OMR IT Corridor', lat: 12.9010, lon: 80.2279, rain: '180–250 mm/day', risk: 'HIGH', desc: 'Buckingham canal high tide backflow' },
    ],
  },
  kolkata: {
    name: 'Kolkata (Calcutta Delta)',
    icon: '⚓',
    badge: 'HOOGHLY TIDAL ESTUARY',
    center: { lat: 22.5726, lon: 88.3639 },
    zoom: 11,
    desc: 'Ganga/Hooghly delta low topography, colonial-era brick drainage locks during high tides in the Bay of Bengal, and silted drainage canals.',
    basin: 'Hooghly Estuary & Circular Canal',
    rain: '160–280 mm/day',
    hotspots: [
      { name: 'Thanthania & College Street', lat: 22.5815, lon: 88.3650, rain: '200–290 mm/day', risk: 'CRITICAL', desc: 'Historic saucer depression in North Kolkata; submerged during 60+ mm rains' },
      { name: 'Behala & Taratala (Diamond Harbour Rd)', lat: 22.4988, lon: 88.3186, rain: '190–270 mm/day', risk: 'CRITICAL', desc: 'Keorapukur & Adi Ganga canal stagnation; poor gravity discharge' },
      { name: 'Park Circus & Topsia', lat: 22.5435, lon: 88.3750, rain: '170–240 mm/day', risk: 'HIGH', desc: 'Low-lying eastern bypass fringe; stormwater lock during river high tide' },
      { name: 'Ultadanga Underpass & VIP Road', lat: 22.5930, lon: 88.3880, rain: '180–250 mm/day', risk: 'HIGH', desc: 'Kestopur canal surplus & railway underpass pooling' },
      { name: 'Central Avenue (Chittaranjan Ave)', lat: 22.5750, lon: 88.3600, rain: '160–230 mm/day', risk: 'HIGH', desc: 'Trunk sewer capacity saturation under intense showers' },
    ],
  },
  hyderabad: {
    name: 'Hyderabad (Deccan Plateau)',
    icon: '🏰',
    badge: 'MUSI RIVER BASIN',
    center: { lat: 17.3850, lon: 78.4867 },
    zoom: 11,
    desc: 'Flash floods caused by steep rocky gradient runoff, Hussainsagar surplus nala bottlenecks, and Musi River floodplain inundation.',
    basin: 'Musi River & Hussainsagar Nalas',
    rain: '110–210 mm/day',
    hotspots: [
      { name: 'Moosarambagh & Chaderghat (Musi River)', lat: 17.3712, lon: 78.5080, rain: '150–220 mm/day', risk: 'CRITICAL', desc: 'Musi river causeway submergence during reservoir gate openings' },
      { name: 'Nadeem Colony & Tolichowki', lat: 17.3970, lon: 78.4120, rain: '140–200 mm/day', risk: 'CRITICAL', desc: 'Shah Hatim Talab bed encroachment; chronic residential basin flooding' },
      { name: 'Alwal & Begumpet (Balanagar Nala)', lat: 17.4435, lon: 78.4710, rain: '130–180 mm/day', risk: 'HIGH', desc: 'Hussainsagar surplus nala overflow; airport perimeter impact' },
      { name: 'Shaikpet & Manikonda Drains', lat: 17.4090, lon: 78.3840, rain: '110–160 mm/day', risk: 'HIGH', desc: 'Steep hillock cascade stormwater flash flooding' },
      { name: 'Amberpet & Malakpet', lat: 17.3830, lon: 78.5130, rain: '120–170 mm/day', risk: 'HIGH', desc: 'Narrowed stormwater drains and railway bridge bottlenecks' },
    ],
  },
  pune: {
    name: 'Pune (Mula-Mutha Basin)',
    icon: '⛰️',
    badge: 'DAM CATCHMENT BASIN',
    center: { lat: 18.5204, lon: 73.8567 },
    zoom: 11,
    desc: 'Surge releases from upstream Khadakwasla, Panshet, and Mulshi dams combined with Sahyadri cloudbursts leading to Mula-Mutha riverbed flooding.',
    basin: 'Mula & Mutha Rivers',
    rain: '120–220 mm/day',
    hotspots: [
      { name: 'Sinhagad Road (Ekta Nagari)', lat: 18.4720, lon: 73.8230, rain: '160–240 mm/day', risk: 'CRITICAL', desc: 'Direct Mutha riverbed floodplain; floods upon 30,000+ cusecs dam discharge' },
      { name: 'Pulachi Wadi & Deccan Gymkhana', lat: 18.5170, lon: 73.8430, rain: '140–200 mm/day', risk: 'CRITICAL', desc: 'Bhide bridge causeway submerges under river surge' },
      { name: 'Sangamwadi & Yerwada Confluence', lat: 18.5420, lon: 73.8760, rain: '130–190 mm/day', risk: 'HIGH', desc: 'Mula-Mutha confluence backflow into low settlements' },
      { name: 'Katraj & Ambegaon Nallahs', lat: 18.4550, lon: 73.8560, rain: '110–170 mm/day', risk: 'HIGH', desc: 'Southern hill slope runoff breach into highways' },
    ],
  },
  ahmedabad: {
    name: 'Ahmedabad (Sabarmati Basin)',
    icon: '🏛️',
    badge: 'SABARMATI & UNDERPASSES',
    center: { lat: 23.0225, lon: 72.5714 },
    zoom: 11,
    desc: 'High-intensity convective cloudbursts causing severe subways submergence and Sabarmati river floodgate backwater.',
    basin: 'Sabarmati River Basin',
    rain: '110–200 mm/day',
    hotspots: [
      { name: 'Akhbarnagar Underpass (Nava Vadaj)', lat: 23.0640, lon: 72.5650, rain: '130–190 mm/day', risk: 'CRITICAL', desc: 'Low railway underpass; closed first in heavy rain' },
      { name: 'Mithakhali Underpass (Navrangpura)', lat: 23.0270, lon: 72.5600, rain: '120–180 mm/day', risk: 'CRITICAL', desc: 'Major city subway inundated under 40+ mm rain' },
      { name: 'Bapunagar & Gomtipur', lat: 23.0330, lon: 72.6320, rain: '100–160 mm/day', risk: 'HIGH', desc: 'East Ahmedabad low-elevation stormwater backflow' },
      { name: 'Vasna Barrage & Paldi', lat: 23.0010, lon: 72.5530, rain: '120–170 mm/day', risk: 'HIGH', desc: 'Sabarmati high-stage discharge backup' },
    ],
  },
  kochi: {
    name: 'Kochi (Kerala Backwaters)',
    icon: '⛵',
    badge: 'PERIYAR & TIDAL CANALS',
    center: { lat: 9.9312, lon: 76.2673 },
    zoom: 11,
    desc: 'Periyar River monsoon dam discharges, tidal sea locks in Vembanad Lake, and choked arterial drainage canals.',
    basin: 'Periyar River & Vembanad Lake',
    rain: '180–320 mm/day',
    hotspots: [
      { name: 'Aluva (Periyar River Banks)', lat: 10.1076, lon: 76.3516, rain: '240–340 mm/day', risk: 'CRITICAL', desc: 'Periyar river surge inundating Shiva temple & residential banks' },
      { name: 'Kalamassery & Edappally Toll', lat: 10.0261, lon: 76.3125, rain: '190–270 mm/day', risk: 'HIGH', desc: 'Edappally canal overflow onto NH-66' },
      { name: 'MG Road & Kaloor (Ernakulam Central)', lat: 9.9880, lon: 76.2910, rain: '170–250 mm/day', risk: 'HIGH', desc: 'Commercial corridor street flooding during high tide' },
      { name: 'Thevara & Panampilly Nagar', lat: 9.9570, lon: 76.2980, rain: '180–260 mm/day', risk: 'HIGH', desc: 'Backwater tidal surge through Mullassery canal' },
    ],
  },
  patna: {
    name: 'Patna (Gangetic Plains)',
    icon: '🌊',
    badge: 'GANGA-PUNPUN CONFLUENCE',
    center: { lat: 25.5941, lon: 85.1376 },
    zoom: 11,
    desc: 'A bowl-shaped city situated lower than the high flood levels of the surrounding Ganga, Punpun, and Son rivers, requiring high-capacity pumping.',
    basin: 'Ganga & Punpun Catchment',
    rain: '140–260 mm/day',
    hotspots: [
      { name: 'Rajendra Nagar & Kankarbagh', lat: 25.6020, lon: 85.1580, rain: '180–280 mm/day', risk: 'CRITICAL', desc: 'Natural saucer basin; famous for prolonged multi-week waterlogging' },
      { name: 'Saidpur Nullah & Bazar Samiti', lat: 25.6120, lon: 85.1760, rain: '160–240 mm/day', risk: 'CRITICAL', desc: 'Open drainage canal overflow; severe residential inundation' },
      { name: 'Patliputra Colony', lat: 25.6320, lon: 85.1150, rain: '140–210 mm/day', risk: 'HIGH', desc: 'Sluice gate closure during Ganga high stage' },
    ],
  },
  guwahati: {
    name: 'Guwahati (Brahmaputra Valley)',
    icon: '🦏',
    badge: 'BRAHMAPUTRA & HILL BASIN',
    center: { lat: 26.1445, lon: 91.7362 },
    zoom: 11,
    desc: 'Surrounded by 18 hills whose heavy runoff rushes down into flat city wetlands, combined with Brahmaputra backflow into the Bharalu River.',
    basin: 'Brahmaputra & Bharalu River',
    rain: '160–290 mm/day',
    hotspots: [
      { name: 'Anil Nagar & Nabin Nagar', lat: 26.1720, lon: 91.7760, rain: '200–300 mm/day', risk: 'CRITICAL', desc: 'Bharalu river backflow; severe chest-deep residential flooding' },
      { name: 'Rukminigaon & Down Town (GS Road)', lat: 26.1360, lon: 91.7980, rain: '180–260 mm/day', risk: 'CRITICAL', desc: 'Bahini river flash overflow across the main highway' },
      { name: 'Zoo Road (RG Baruah Road)', lat: 26.1680, lon: 91.7820, rain: '160–230 mm/day', risk: 'HIGH', desc: 'Steep hill slopes runoff inundation' },
      { name: 'Hatigaon & Sijubari', lat: 26.1280, lon: 91.7850, rain: '150–220 mm/day', risk: 'HIGH', desc: 'Low-lying wetland saucer basin' },
    ],
  },
};

async function fetchFloodMapData() {
  try {
    const res = await fetch('/api/map/points?limit=500');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    floodMapData = Array.isArray(payload.points) ? payload.points : [];
    renderFloodMap();
  } catch (err) {
    console.warn('[AquaAlert] map fetch failed:', err.message);
    floodMapData = [];
    const container = document.getElementById('india-flood-map');
    if (container) Plotly.purge(container);
  }
}

function updateRegionUI(key) {
  activeRegionKey = key;
  const reg = REGIONAL_DATA[key] || REGIONAL_DATA.all;

  // Update banner elements
  const elIcon  = document.getElementById('rib-icon');
  const elTitle = document.getElementById('rib-title');
  const elBadge = document.getElementById('rib-badge');
  const elDesc  = document.getElementById('rib-desc');
  const elArea  = document.getElementById('rib-stat-area');
  const elBasin = document.getElementById('rib-stat-basin');
  const elRain  = document.getElementById('rib-stat-rain');
  const elCount = document.getElementById('rib-stat-count');

  if (elIcon)  elIcon.textContent  = reg.icon;
  if (elTitle) elTitle.textContent = reg.name;
  if (elBadge) elBadge.textContent = reg.badge;
  if (elDesc)  elDesc.textContent  = reg.desc;
  if (elArea)  elArea.textContent  = reg.name.split(' (')[0];
  if (elBasin) elBasin.textContent = reg.basin;
  if (elRain)  elRain.textContent  = reg.rain;
  if (elCount) elCount.textContent = key === 'all' ? '500+ Survey Points' : `${reg.hotspots.length} Monitored Hotspots`;

  // Update dropdown selection if not triggered by it
  const select = document.getElementById('map-region-select');
  if (select && select.value !== key) select.value = key;

  // Update quick pills active state
  document.querySelectorAll('.btn-city-pill').forEach((btn) => {
    if (btn.dataset.city === key) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderFloodMap();
}

/* ── Client-side Indian City Geocoder (Instant Hover Fallback) ─────── */
const CLIENT_INDIAN_CITIES = [
  // Delhi NCR & Northern Plains
  ['New Delhi', 'Delhi NCR', 28.6139, 77.2090],
  ['Noida', 'Delhi NCR (UP)', 28.5355, 77.3910],
  ['Ghaziabad', 'Delhi NCR (UP)', 28.6692, 77.4538],
  ['Gurugram', 'Delhi NCR (HR)', 28.4595, 77.0266],
  ['Faridabad', 'Delhi NCR (HR)', 28.4089, 77.3178],
  ['Ambala', 'Haryana', 30.3782, 76.7767],
  ['Rohtak', 'Haryana', 28.8955, 76.6066],
  ['Hisar', 'Haryana', 29.1492, 75.7217],
  ['Panipat', 'Haryana', 29.3909, 76.9635],
  ['Karnal', 'Haryana', 29.6857, 76.9905],

  // Uttar Pradesh
  ['Bareilly', 'Uttar Pradesh', 28.3670, 79.4304],
  ['Lucknow', 'Uttar Pradesh', 26.8467, 80.9462],
  ['Kanpur', 'Uttar Pradesh', 26.4499, 80.3319],
  ['Agra', 'Uttar Pradesh', 27.1767, 78.0081],
  ['Varanasi', 'Uttar Pradesh', 25.3176, 82.9739],
  ['Prayagraj', 'Uttar Pradesh', 25.4358, 81.8463],
  ['Meerut', 'Uttar Pradesh', 28.9845, 77.7064],
  ['Aligarh', 'Uttar Pradesh', 27.8974, 78.0880],
  ['Moradabad', 'Uttar Pradesh', 28.8386, 78.7733],
  ['Saharanpur', 'Uttar Pradesh', 29.9640, 77.5460],
  ['Gorakhpur', 'Uttar Pradesh', 26.7606, 83.3732],
  ['Jhansi', 'Uttar Pradesh', 25.4484, 78.5685],
  ['Mathura', 'Uttar Pradesh', 27.4924, 77.6737],
  ['Ayodhya', 'Uttar Pradesh', 26.7922, 82.1998],
  ['Shahjahanpur', 'Uttar Pradesh', 27.8804, 79.9149],
  ['Budaun', 'Uttar Pradesh', 28.0334, 79.1235],
  ['Rampur', 'Uttar Pradesh', 28.8154, 79.0257],
  ['Pilibhit', 'Uttar Pradesh', 28.6310, 79.8055],
  ['Sitapur', 'Uttar Pradesh', 27.5684, 80.6829],
  ['Lakhimpur', 'Uttar Pradesh', 27.9462, 80.7788],
  ['Hardoi', 'Uttar Pradesh', 27.3948, 80.1293],
  ['Muzaffarnagar', 'Uttar Pradesh', 29.4727, 77.7085],
  ['Firozabad', 'Uttar Pradesh', 27.1591, 78.3957],
  ['Basti', 'Uttar Pradesh', 26.8058, 82.7629],
  ['Gonda', 'Uttar Pradesh', 27.1332, 81.9619],
  ['Bahraich', 'Uttar Pradesh', 27.5744, 81.5976],
  ['Azamgarh', 'Uttar Pradesh', 26.0683, 83.1837],
  ['Jaunpur', 'Uttar Pradesh', 25.7464, 82.6837],
  ['Mirzapur', 'Uttar Pradesh', 25.1460, 82.5685],
  ['Sonbhadra', 'Uttar Pradesh', 24.6850, 83.0650],

  // Uttarakhand & Himachal Pradesh
  ['Dehradun', 'Uttarakhand', 30.3165, 78.0322],
  ['Haridwar', 'Uttarakhand', 29.9457, 78.1642],
  ['Rishikesh', 'Uttarakhand', 30.0869, 78.2676],
  ['Nainital', 'Uttarakhand', 29.3919, 79.4542],
  ['Haldwani', 'Uttarakhand', 29.2183, 79.5130],
  ['Roorkee', 'Uttarakhand', 29.8543, 77.8880],
  ['Shimla', 'Himachal Pradesh', 31.1048, 77.1734],
  ['Dharamshala', 'Himachal Pradesh', 32.2190, 76.3234],
  ['Manali', 'Himachal Pradesh', 32.2432, 77.1892],
  ['Kullu', 'Himachal Pradesh', 31.9579, 77.1095],

  // Punjab & Chandigarh
  ['Chandigarh', 'Chandigarh', 30.7333, 76.7794],
  ['Ludhiana', 'Punjab', 30.9010, 75.8573],
  ['Amritsar', 'Punjab', 31.6340, 74.8723],
  ['Jalandhar', 'Punjab', 31.3260, 75.5762],
  ['Patiala', 'Punjab', 30.3398, 76.3869],
  ['Bathinda', 'Punjab', 30.2110, 74.9455],

  // Jammu & Kashmir & Ladakh
  ['Srinagar', 'Jammu & Kashmir', 34.0837, 74.7973],
  ['Jammu', 'Jammu & Kashmir', 32.7266, 74.8570],
  ['Leh', 'Ladakh', 34.1526, 77.5771],
  ['Kargil', 'Ladakh', 34.5539, 76.1349],

  // Rajasthan
  ['Jaipur', 'Rajasthan', 26.9124, 75.7873],
  ['Jodhpur', 'Rajasthan', 26.2389, 73.0243],
  ['Udaipur', 'Rajasthan', 24.5854, 73.7125],
  ['Kota', 'Rajasthan', 25.2138, 75.8648],
  ['Bikaner', 'Rajasthan', 28.0229, 73.3119],
  ['Ajmer', 'Rajasthan', 26.4499, 74.6399],
  ['Alwar', 'Rajasthan', 27.5530, 76.6346],
  ['Bharatpur', 'Rajasthan', 27.2152, 77.5030],
  ['Sri Ganganagar', 'Rajasthan', 29.9038, 73.8772],
  ['Barmer', 'Rajasthan', 25.7532, 71.3967],
  ['Jaisalmer', 'Rajasthan', 26.9157, 70.9083],

  // Madhya Pradesh
  ['Bhopal', 'Madhya Pradesh', 23.2599, 77.4126],
  ['Indore', 'Madhya Pradesh', 22.7196, 75.8577],
  ['Jabalpur', 'Madhya Pradesh', 23.1815, 79.9864],
  ['Gwalior', 'Madhya Pradesh', 26.2183, 78.1828],
  ['Ujjain', 'Madhya Pradesh', 23.1765, 75.7885],
  ['Sagar', 'Madhya Pradesh', 23.8388, 78.7378],
  ['Satna', 'Madhya Pradesh', 24.6005, 80.8322],
  ['Rewa', 'Madhya Pradesh', 24.5362, 81.3037],
  ['Ratlam', 'Madhya Pradesh', 23.3315, 75.0367],
  ['Chhindwara', 'Madhya Pradesh', 22.0574, 78.9382],

  // Gujarat
  ['Ahmedabad', 'Gujarat', 23.0225, 72.5714],
  ['Surat', 'Gujarat', 21.1702, 72.8311],
  ['Vadodara', 'Gujarat', 22.3072, 73.1812],
  ['Rajkot', 'Gujarat', 22.3039, 70.8022],
  ['Bhavnagar', 'Gujarat', 21.7645, 72.1519],
  ['Jamnagar', 'Gujarat', 22.4707, 70.0577],
  ['Gandhinagar', 'Gujarat', 23.2156, 72.6369],
  ['Junagadh', 'Gujarat', 21.5222, 70.4579],
  ['Bhuj', 'Gujarat', 23.2420, 69.6669],
  ['Porbandar', 'Gujarat', 21.6417, 69.6293],

  // Maharashtra & Goa
  ['Mumbai', 'Maharashtra', 19.0760, 72.8777],
  ['Pune', 'Maharashtra', 18.5204, 73.8567],
  ['Nagpur', 'Maharashtra', 21.1458, 79.0882],
  ['Thane', 'Maharashtra', 19.2183, 72.9781],
  ['Nashik', 'Maharashtra', 19.9975, 73.7898],
  ['Kalyan-Dombivli', 'Maharashtra', 19.2403, 73.1305],
  ['Chhatrapati Sambhajinagar', 'Maharashtra', 19.8762, 75.3433],
  ['Solapur', 'Maharashtra', 17.6599, 75.9064],
  ['Amravati', 'Maharashtra', 20.9320, 77.7523],
  ['Kolhapur', 'Maharashtra', 16.7050, 74.2433],
  ['Nanded', 'Maharashtra', 19.1383, 77.3210],
  ['Jalgaon', 'Maharashtra', 21.0077, 75.5626],
  ['Akola', 'Maharashtra', 20.7002, 77.0082],
  ['Ratnagiri', 'Maharashtra', 16.9902, 73.3120],
  ['Panaji', 'Goa', 15.4909, 73.8278],
  ['Margao', 'Goa', 15.2832, 73.9862],

  // Bihar & Jharkhand
  ['Patna', 'Bihar', 25.5941, 85.1376],
  ['Gaya', 'Bihar', 24.7914, 85.0002],
  ['Bhagalpur', 'Bihar', 25.2425, 86.9842],
  ['Muzaffarpur', 'Bihar', 26.1209, 85.3647],
  ['Purnia', 'Bihar', 25.7771, 87.4753],
  ['Darbhanga', 'Bihar', 26.1542, 85.8918],
  ['Ranchi', 'Jharkhand', 23.3441, 85.3096],
  ['Jamshedpur', 'Jharkhand', 22.8046, 86.2029],
  ['Dhanbad', 'Jharkhand', 23.7957, 86.4304],
  ['Bokaro', 'Jharkhand', 23.6693, 86.1511],

  // West Bengal & Odisha
  ['Kolkata', 'West Bengal', 22.5726, 88.3639],
  ['Howrah', 'West Bengal', 22.5958, 88.2636],
  ['Asansol', 'West Bengal', 23.6739, 86.9524],
  ['Siliguri', 'West Bengal', 26.7271, 88.3953],
  ['Durgapur', 'West Bengal', 23.5204, 87.3119],
  ['Darjeeling', 'West Bengal', 27.0410, 88.2663],
  ['Malda', 'West Bengal', 25.0108, 88.1411],
  ['Bhubaneswar', 'Odisha', 20.2961, 85.8245],
  ['Cuttack', 'Odisha', 20.4625, 85.8828],
  ['Rourkela', 'Odisha', 22.2604, 84.8536],
  ['Puri', 'Odisha', 19.8135, 85.8312],
  ['Sambalpur', 'Odisha', 21.4669, 83.9812],
  ['Berhampur', 'Odisha', 19.3149, 84.7941],
  ['Balasore', 'Odisha', 21.4934, 86.9135],

  // Chhattisgarh
  ['Raipur', 'Chhattisgarh', 21.2514, 81.6296],
  ['Bilaspur', 'Chhattisgarh', 22.0797, 82.1409],
  ['Durg-Bhilai', 'Chhattisgarh', 21.2167, 81.4333],
  ['Jagdalpur', 'Chhattisgarh', 19.0730, 82.0196],

  // Northeast
  ['Guwahati', 'Assam', 26.1445, 91.7362],
  ['Silchar', 'Assam', 24.8333, 92.7789],
  ['Dibrugarh', 'Assam', 27.4728, 94.9120],
  ['Jorhat', 'Assam', 26.7509, 94.2037],
  ['Tezpur', 'Assam', 26.6528, 92.7926],
  ['Agartala', 'Tripura', 23.8315, 91.2868],
  ['Shillong', 'Meghalaya', 25.5788, 91.8933],
  ['Imphal', 'Manipur', 24.8170, 93.9368],
  ['Aizawl', 'Mizoram', 23.7271, 92.7176],
  ['Kohima', 'Nagaland', 25.6751, 94.1086],
  ['Itanagar', 'Arunachal Pradesh', 27.0844, 93.6053],
  ['Gangtok', 'Sikkim', 27.3389, 88.6065],

  // Karnataka
  ['Bengaluru', 'Karnataka', 12.9716, 77.5946],
  ['Mysuru', 'Karnataka', 12.2958, 76.6394],
  ['Mangaluru', 'Karnataka', 12.9141, 74.8560],
  ['Hubballi', 'Karnataka', 15.3647, 75.1240],
  ['Belagavi', 'Karnataka', 15.8497, 74.4977],
  ['Kalaburagi', 'Karnataka', 17.3297, 76.8343],
  ['Shivamogga', 'Karnataka', 13.9299, 75.5681],

  // Telangana & Andhra Pradesh
  ['Hyderabad', 'Telangana', 17.3850, 78.4867],
  ['Warangal', 'Telangana', 17.9689, 79.5941],
  ['Nizamabad', 'Telangana', 18.6725, 78.0941],
  ['Karimnagar', 'Telangana', 18.4386, 79.1288],
  ['Visakhapatnam', 'Andhra Pradesh', 17.6868, 83.2185],
  ['Vijayawada', 'Andhra Pradesh', 16.5062, 80.6480],
  ['Guntur', 'Andhra Pradesh', 16.3067, 80.4365],
  ['Nellore', 'Andhra Pradesh', 14.4426, 79.9865],
  ['Kurnool', 'Andhra Pradesh', 15.8281, 78.0373],
  ['Tirupati', 'Andhra Pradesh', 13.6288, 79.4192],
  ['Rajahmundry', 'Andhra Pradesh', 17.0005, 81.8040],

  // Tamil Nadu & Kerala
  ['Chennai', 'Tamil Nadu', 13.0827, 80.2707],
  ['Coimbatore', 'Tamil Nadu', 11.0168, 76.9558],
  ['Madurai', 'Tamil Nadu', 9.9252, 78.1198],
  ['Tiruchirappalli', 'Tamil Nadu', 10.7905, 78.7047],
  ['Salem', 'Tamil Nadu', 11.6643, 78.1460],
  ['Tirunelveli', 'Tamil Nadu', 8.7139, 77.7567],
  ['Vellore', 'Tamil Nadu', 12.9165, 79.1325],
  ['Thanjavur', 'Tamil Nadu', 10.7870, 79.1378],
  ['Puducherry', 'Puducherry', 11.9416, 79.8083],
  ['Thiruvananthapuram', 'Kerala', 8.5241, 76.9366],
  ['Kochi', 'Kerala', 9.9312, 76.2673],
  ['Kozhikode', 'Kerala', 11.2588, 75.7804],
  ['Thrissur', 'Kerala', 10.5276, 76.2144],
  ['Alappuzha', 'Kerala', 9.4981, 76.3388],
  ['Kannur', 'Kerala', 11.8745, 75.3704],

  // Islands & Border Basins
  ['Port Blair', 'Andaman & Nicobar', 11.6234, 92.7265],
  ['Kavaratti', 'Lakshadweep', 10.5667, 72.6417],
  ['Dhangadhi', 'Nepal Border Basin', 28.6944, 80.5967],
  ['Nepalganj', 'Nepal Border Basin', 28.0500, 81.6167],
  ['Birgunj', 'Nepal Border Basin', 27.0167, 84.8667],
  ['Biratnagar', 'Nepal Border Basin', 26.4525, 87.2718],
];

function resolveNearestCityClient(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return 'Survey Station';

  if (lon < 72.0 && lat < 18.5 && lat > 8.0) return 'Arabian Sea (Offshore Basin)';
  if (lon > 85.5 && lat < 18.0 && lat > 10.0) return 'Bay of Bengal (Offshore Basin)';

  let bestCity = CLIENT_INDIAN_CITIES[0];
  let bestDist = Infinity;
  const toRad = Math.PI / 180;
  const latR = lat * toRad;
  const cosLat = Math.cos(latR);

  for (let i = 0; i < CLIENT_INDIAN_CITIES.length; i++) {
    const c = CLIENT_INDIAN_CITIES[i];
    const dlat = (c[2] - lat) * 111.0;
    const dlon = (c[3] - lon) * 111.0 * cosLat;
    const d = Math.hypot(dlat, dlon);
    if (d < bestDist) {
      bestDist = d;
      bestCity = c;
    }
  }

  if (bestDist <= 25) {
    return `${bestCity[0]}, ${bestCity[1]}`;
  } else if (bestDist <= 80) {
    return `Near ${bestCity[0]}, ${bestCity[1]} (~${Math.round(bestDist)} km)`;
  } else if (bestDist <= 160) {
    return `${bestCity[0]} Basin, ${bestCity[1]}`;
  } else {
    return `${bestCity[0]} Region, ${bestCity[1]}`;
  }
}

function renderFloodMap() {
  const container = document.getElementById('india-flood-map');
  if (!container) return;

  if (!floodMapData.length) {
    Plotly.purge(container);
    return;
  }

  const reg = REGIONAL_DATA[activeRegionKey] || REGIONAL_DATA.all;
  const isCitySelected = activeRegionKey !== 'all';

  const baseLayout = {
    mapbox: {
      style: 'open-street-map',
      center: reg.center,
      zoom: reg.zoom,
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paper_bgcolor: '#0a0e1a',
    plot_bgcolor: '#0a0e1a',
    font: { color: '#f1f5f9' },
    showlegend: isCitySelected,
    legend: {
      x: 0.02,
      y: 0.98,
      bgcolor: 'rgba(15, 23, 42, 0.85)',
      bordercolor: 'rgba(239, 68, 68, 0.4)',
      borderwidth: 1,
      font: { size: 11, color: '#f1f5f9' },
    },
  };

  if (currentMapMode === 'density') {
    const trace = {
      type: 'densitymapbox',
      lat: floodMapData.map((p) => p.Latitude),
      lon: floodMapData.map((p) => p.Longitude),
      z: floodMapData.map((p) => Number(p['Flood Occurred'])),
      radius: isCitySelected ? 35 : 22,
      opacity: 0.7,
      colorscale: [
        [0, '#38bdf8'],
        [0.5, '#f59e0b'],
        [1, '#ef4444'],
      ],
      showscale: false,
      hoverinfo: 'skip',
    };

    Plotly.react(container, [trace], baseLayout, { responsive: true });
    return;
  }

  const scatterTrace = {
    type: 'scattermapbox',
    mode: 'markers',
    lat: floodMapData.map((p) => p.Latitude),
    lon: floodMapData.map((p) => p.Longitude),
    name: 'National Survey Points',
    marker: {
      size: isCitySelected ? 9 : 10,
      color: floodMapData.map((p) => (p['Flood Occurred'] ? '#ef4444' : '#3b82f6')),
      opacity: isCitySelected ? 0.35 : 0.9,
    },
    hoverlabel: {
      bgcolor: 'rgba(15, 23, 42, 0.94)',
      bordercolor: '#38bdf8',
      font: {
        family: 'Inter, system-ui, -apple-system, sans-serif',
        size: 12,
        color: '#f8fafc',
      },
    },
    customdata: floodMapData.map((p) => {
      const city = p.City || resolveNearestCityClient(p.Latitude, p.Longitude);
      const isFlood = Boolean(p['Flood Occurred']);
      return [
        p['Rainfall (mm)'],
        p['Water Level (m)'],
        p['River Discharge (m³/s)'],
        p['Elevation (m)'],
        p['Historical Floods'],
        isFlood,
        city,
        isFlood ? 'Flood Occurred' : 'No Flood',
      ];
    }),
    hovertemplate:
      '<b>📍 %{customdata[6]}</b><br>' +
      '<b>Status:</b> %{customdata[7]}<br>' +
      'Rainfall: %{customdata[0]:.1f} mm<br>' +
      'Water Level: %{customdata[1]:.1f} m<br>' +
      'River Discharge: %{customdata[2]:.1f} m³/s<br>' +
      'Elevation: %{customdata[3]:.1f} m<br>' +
      'Historical Floods: %{customdata[4]}<br>' +
      '<extra></extra>',
    text: floodMapData.map((p) => (p['Flood Occurred'] ? 'Flood Occurred' : 'No Flood')),
  };

  const traces = [scatterTrace];

  // If a specific city is selected, overlay its high-risk chronic hotspots
  if (isCitySelected && reg.hotspots && reg.hotspots.length > 0) {
    const cityHotspotsTrace = {
      type: 'scattermapbox',
      mode: 'markers+text',
      lat: reg.hotspots.map((h) => h.lat),
      lon: reg.hotspots.map((h) => h.lon),
      name: `⚠️ ${reg.name.split(' (')[0]} Hotspots`,
      text: reg.hotspots.map((h) => h.name.split(' (')[0]),
      textposition: 'top right',
      textfont: { color: '#fca5a5', size: 10, weight: 700 },
      marker: {
        size: 15,
        color: reg.hotspots.map((h) => (h.risk === 'CRITICAL' ? '#ef4444' : '#f59e0b')),
        opacity: 0.95,
      },
      customdata: reg.hotspots.map((h) => [h.name, h.risk, h.rain, h.desc]),
      hovertemplate:
        '<b>📍 %{customdata[0]}</b><br>' +
        'Risk Level: <b>%{customdata[1]}</b><br>' +
        'Monsoon Rain: %{customdata[2]}<br>' +
        'Vulnerability: %{customdata[3]}<br>' +
        '<extra></extra>',
    };
    traces.push(cityHotspotsTrace);
  }

  Plotly.react(container, traces, baseLayout, { responsive: true });
}

/* ── Socket.IO — Real-time Updates ──────────────────────────────────── */

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

socket.on('connect', () => {
  console.log('[AquaAlert] WebSocket connected:', socket.id);
  // Synchronize state immediately upon connection / reconnection
  fetchLatest();
});

socket.on('reconnect', (attemptNumber) => {
  console.log('[AquaAlert] WebSocket reconnected after', attemptNumber, 'attempts');
  fetchLatest();
  fetchHistory();
});

socket.on('disconnect', (reason) => {
  console.warn('[AquaAlert] WebSocket disconnected:', reason);
  // Watchdog will handle the offline transition after OFFLINE_THRESHOLD ms
});

socket.on('connect_error', (error) => {
  console.warn('[AquaAlert] WebSocket connect error:', error.message);
});

/**
 * Main real-time handler.
 * Fired by the Flask server whenever the ESP32 sends a new reading.
 */
socket.on('sensor_update', (data) => {
  console.debug('[AquaAlert] sensor_update received:', data);

  // Mark device as alive
  lastDataTime = Date.now();
  setOnlineState(true);

  // Update all dashboard sections
  updateStatCards(data);

  // Append new point to live chart (dual-metric & velocity)
  addLivePoint(
    data.percentage ?? 0,
    data.timestamp ?? new Date(),
    data.rainfall ?? 0,
    data.water_level ?? null
  );

  // Refresh quick telemetry stats
  fetchSensorAnalytics();
});

/* ── Rain Telemetry & Clock Helpers ──────────────────────────────────── */

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
      el.liveDateText.textContent = `${dateStr} • Local Synchronized Time`;
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
  } catch (err) {
    console.error('Failed to fetch rain latest:', err);
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

async function fetchRainEvents() {
  if (!el.rainEventsTbody) return;
  try {
    const res = await fetch('/api/rain/events?limit=15');
    if (!res.ok) return;
    const data = await res.json();
    const events = data.historical_events || [];
    if (!events.length) {
      el.rainEventsTbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">No rain events recorded.</td></tr>';
      return;
    }

    el.rainEventsTbody.innerHTML = events
      .map((ev, i) => {
        let chipClass = 'intensity-chip--light';
        const intensity = ev.intensity || 'Light Rain';
        if (intensity.includes('Torrential')) chipClass = 'intensity-chip--torrential';
        else if (intensity.includes('Heavy')) chipClass = 'intensity-chip--heavy';
        else if (intensity.includes('Moderate')) chipClass = 'intensity-chip--moderate';

        const floodBadge = ev.flood_occurred
          ? '<span class="status-badge badge--critical" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">FLOOD OCCURRED</span>'
          : '<span class="status-badge badge--normal" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">NORMAL</span>';

        return `
        <tr>
          <td style="font-weight: 600; color: var(--text-muted);">${i + 1}</td>
          <td class="td-date">${escapeHtml(ev.date_formatted || ev.date)}</td>
          <td class="td-time">${escapeHtml(ev.time_12h || ev.time)}</td>
          <td class="td-rainfall">${ev.rainfall_mm} mm</td>
          <td><span class="intensity-chip ${chipClass}">${escapeHtml(intensity)}</span></td>
          <td style="font-family: var(--font-mono);">${ev.water_level_m} m</td>
          <td>${floodBadge}</td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.warn('[AquaAlert] fetchRainEvents failed:', err.message);
  }
}

/* ── Live Weather Telemetry ─────────────────────────────────────────── */
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
    console.warn('[AquaAlert] fetchWeather error:', err);
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
  console.log('[AquaAlert] Weather telemetry push received:', data);
  updateWeatherUI(data);
});

/* ── Live Telemetry Stream Engine (Active Hardware Simulation) ────────── */

let isLiveSimActive = true;
let currentSimLvl = 55.0;
let simDirection = 1;
let liveSimInterval = null;

function startLiveTelemetryEngine() {
  if (liveSimInterval) clearInterval(liveSimInterval);

  liveSimInterval = setInterval(() => {
    if (!isLiveSimActive || isLivePaused) return;

    // Simulate subtle natural wave motion (+/- 0.2 to 0.4 cm wave ripple)
    const waveJitter = (Math.random() - 0.48) * 0.35;
    currentSimLvl += (simDirection * 0.15) + waveJitter;

    // Boundary bounce
    if (currentSimLvl >= 92) simDirection = -1;
    if (currentSimLvl <= 15) simDirection = 1;

    currentSimLvl = Math.max(5, Math.min(98, currentSimLvl));
    const pct = Math.round(currentSimLvl);
    const dist = Math.max(2, 100 - currentSimLvl);
    const status = percentToStatus(pct);
    const now = new Date();

    // Update stat cards and virtual actuators
    updateStatCards({
      percentage: pct,
      distance: dist,
      water_level: currentSimLvl,
      status: status,
      device_id: 'AQUA-001',
      timestamp: now,
    });

    // Append to live chart and update surge velocity meter
    addLivePoint(pct, now, isRainBarsVisible ? (pct > 65 ? (pct - 60) * 0.8 : 0) : 0, currentSimLvl);

    // Sync slider display if user is not actively dragging it
    const slider = document.getElementById('sim-water-slider');
    const sliderVal = document.getElementById('sim-slider-val');
    if (slider && !slider.matches(':active')) {
      slider.value = pct;
      if (sliderVal) sliderVal.textContent = `${pct}% (${Math.round(currentSimLvl)} cm)`;
    }
  }, 1500);
}

/* ── Page Initialization ─────────────────────────────────────────────── */

let mapResizeTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  console.log('[AquaAlert] Dashboard initialising...');

  // Build both Chart.js charts
  initLiveChart();
  initHistoryChart();

  // Seed the UI with current data and history from the REST API
  seedLiveChartHistory();
  fetchLatest();
  fetchSensorAnalytics();
  fetchHistory();
  fetchPrediction();
  fetchRainLatest();
  fetchRainEvents();
  fetchWeather({ area: 'mumbai_dadar' });
  startLiveClock();

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
  fetchRainEvents();
  startLiveClock();

  // LCD Backlight Theme Switchers (Blue / Green)
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

  // Live Stream Toggle Button
  const btnToggleSim = document.getElementById('btn-toggle-live-sim');
  const streamText = document.getElementById('stream-btn-text');
  if (btnToggleSim) {
    btnToggleSim.addEventListener('click', () => {
      isLiveSimActive = !isLiveSimActive;
      btnToggleSim.classList.toggle('active', isLiveSimActive);
      btnToggleSim.classList.toggle('paused', !isLiveSimActive);
      if (streamText) {
        streamText.textContent = isLiveSimActive
          ? '📡 Live Telemetry Stream: ACTIVE (1.5s)'
          : '⏸️ Live Stream: PAUSED (Click to Resume)';
      }
      if (el.simSourceTag) {
        el.simSourceTag.textContent = isLiveSimActive ? 'Source: Auto Stream' : 'Source: Paused';
      }
      updateVirtualLCD(currentSimLvl, currentSimLvl, percentToStatus(currentSimLvl), isLiveSimActive);
    });
  }

  // Live Water Level Test Slider
  const simSlider = document.getElementById('sim-water-slider');
  const simSliderVal = document.getElementById('sim-slider-val');
  if (simSlider) {
    const handleSliderChange = () => {
      const val = parseFloat(simSlider.value);
      currentSimLvl = val;
      const status = percentToStatus(val);
      if (simSliderVal) simSliderVal.textContent = `${Math.round(val)}% (${Math.round(val)} cm)`;
      if (el.simSourceTag) el.simSourceTag.textContent = 'Source: Manual Test';

      updateStatCards({
        percentage: val,
        distance: Math.max(2, 100 - val),
        water_level: val,
        status: status,
        device_id: 'AQUA-001',
        timestamp: new Date(),
      });
      addLivePoint(val, new Date(), 0, val);
    };
    simSlider.addEventListener('input', handleSliderChange);
    simSlider.addEventListener('change', handleSliderChange);
  }

  // Preset Buttons (Normal, Warning, High, Critical)
  document.querySelectorAll('.btn-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.val || 50);
      if (simSlider) simSlider.value = val;
      const status = percentToStatus(val);
      currentSimLvl = val;
      if (simSliderVal) simSliderVal.textContent = `${Math.round(val)}% (${Math.round(val)} cm)`;
      if (el.simSourceTag) el.simSourceTag.textContent = `Source: Preset (${val}%)`;

      updateStatCards({
        percentage: val,
        distance: Math.max(2, 100 - val),
        water_level: val,
        status: status,
        device_id: 'AQUA-001',
        timestamp: new Date(),
      });
      addLivePoint(val, new Date(), 0, val);
    });
  });

  // Start Live Telemetry Engine
  startLiveTelemetryEngine();

  document.getElementById('dashboard-year')?.addEventListener('change', () => {
    populateHistoryChart(yearMonthData);
  });
  document.getElementById('dashboard-horizon')?.addEventListener('change', fetchPrediction);
  const mapMode = document.getElementById('map-mode');
  if (mapMode) {
    mapMode.addEventListener('change', (event) => {
      currentMapMode = event.target.value;
      renderFloodMap();
    });
  }

  const regionSelect = document.getElementById('map-region-select');
  if (regionSelect) {
    regionSelect.addEventListener('change', (event) => {
      updateRegionUI(event.target.value);
    });
  }

  document.querySelectorAll('.btn-city-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const city = btn.dataset.city || 'all';
      updateRegionUI(city);
    });
  });

  // Wire live chart toolbar controls
  const btnToggleRain = document.getElementById('btn-toggle-rain-bars');
  if (btnToggleRain) {
    btnToggleRain.addEventListener('click', () => {
      isRainBarsVisible = !isRainBarsVisible;
      if (liveChart && liveChart.data.datasets[0]) {
        liveChart.data.datasets[0].hidden = !isRainBarsVisible;
        liveChart.update();
      }
      btnToggleRain.classList.toggle('active', isRainBarsVisible);
      btnToggleRain.textContent = isRainBarsVisible ? '🌧️ Rain Bars: ON' : '🌧️ Rain Bars: OFF';
    });
  }

  const btnPauseLive = document.getElementById('btn-pause-live');
  if (btnPauseLive) {
    btnPauseLive.addEventListener('click', () => {
      isLivePaused = !isLivePaused;
      btnPauseLive.classList.toggle('paused', isLivePaused);
      btnPauseLive.textContent = isLivePaused ? '▶️ Resume' : '⏸️ Pause';
    });
  }

  fetchFloodMapData();

  // Debounced resize listener to avoid blocking main thread
  window.addEventListener('resize', () => {
    if (mapResizeTimer) clearTimeout(mapResizeTimer);
    mapResizeTimer = setTimeout(() => {
      const plotNode = document.getElementById('india-flood-map');
      if (plotNode && typeof Plotly !== 'undefined') {
        Plotly.Plots.resize(plotNode);
      }
    }, 150);
  });

  // Periodically refresh the seasonal trend chart
  setInterval(fetchHistory, HISTORY_REFRESH_MS);

  // Initialize Arabian Sea High / Low Tide Widget
  initSeaTideWidget();

  console.log('[AquaAlert] Dashboard ready ✓');
});

/* ── Arabian Sea High / Low Tide Telemetry Controller ──────── */
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

