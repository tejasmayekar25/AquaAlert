/* ═══════════════════════════════════════════════════════════════════════
   AquaAlert Analytics — Interactive Charts & Prediction Dashboard
   ═══════════════════════════════════════════════════════════════════════
   Fetches data from Flask API endpoints:
     /api/analytics/summary      → stat cards
     /api/analytics/yearly       → year-wise chart + table
     /api/analytics/monthly      → month-wise chart + table
     /api/analytics/yearmonth    → heatmap
     /api/analytics/landcover    → donut chart
     /api/analytics/soiltype     → donut chart
     /api/analytics/prediction   → prediction line chart + table
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Color Palette ──────────────────────────────────────────────────── */
const COLORS = {
  teal:    '#06b6d4',
  blue:    '#3b82f6',
  orange:  '#f97316',
  amber:   '#f59e0b',
  red:     '#ef4444',
  green:   '#10b981',
  purple:  '#a855f7',
  pink:    '#ec4899',
  slate:   '#94a3b8',
  grid:    'rgba(148,163,184,0.08)',
  tooltip: '#1e293b',
};

/* ── Chart.js Global Defaults ────────────────────────────────────────── */
Chart.defaults.color       = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.08)';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";

const CHART_FONT = { size: 11, weight: '500' };

/* ── Utility ─────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function riskBadgeClass(label) {
  const norm = (label || 'normal').toLowerCase();
  return 'risk-badge badge--' + (norm === 'moderate' ? 'warning' : norm);
}

function riskColor(pct) {
  if (pct >= 85) return COLORS.red;
  if (pct >= 70) return COLORS.orange;
  if (pct >= 50) return COLORS.amber;
  return COLORS.green;
}

/* ── Chart Instance Registry (destroy before recreate) ───────────────── */
const charts = {};

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  charts[id] = new Chart(ctx, config);
  return charts[id];
}

/* ═══════════════════════════════════════════════════════════════════════
   1. SUMMARY STAT CARDS
   ═══════════════════════════════════════════════════════════════════════ */
async function loadSummary() {
  try {
    const res = await fetch('/api/analytics/summary');
    const d   = await res.json();
    document.getElementById('s-total').textContent  = d.total_records.toLocaleString();
    document.getElementById('s-floods').textContent = d.total_floods.toLocaleString();
    document.getElementById('s-risk').textContent   = d.flood_risk_pct + '%';
    document.getElementById('s-wl').textContent     = d.avg_water_level.toFixed(2);
    document.getElementById('s-rf').textContent     = d.avg_rainfall.toFixed(1);
    document.getElementById('s-years').textContent  = d.years_covered.join(', ');

    // Fetch and populate peak rain date and time
    try {
      const rainRes = await fetch('/api/rain/latest');
      if (rainRes.ok) {
        const rData = await rainRes.json();
        const peakEl = document.getElementById('s-peak-rain');
        if (peakEl && rData.summary) {
          peakEl.textContent = `${rData.summary.peak_datetime} (${rData.summary.peak_rainfall} mm)`;
        }
      }
    } catch (_) {}
  } catch (e) { console.error('Summary fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   2. YEAR-WISE CHART + TABLE
   ═══════════════════════════════════════════════════════════════════════ */
async function loadYearly() {
  try {
    const res  = await fetch('/api/analytics/yearly');
    const data = await res.json();
    const labels = data.map(d => d.Year);

    makeChart('yearly-chart', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Flood Events',
            data: data.map(d => d.flood_events),
            backgroundColor: COLORS.red + '99',
            borderColor: COLORS.red,
            borderWidth: 1,
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Avg Water Level (m)',
            data: data.map(d => d.avg_water_level),
            type: 'line',
            borderColor: COLORS.teal,
            backgroundColor: COLORS.teal + '22',
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: COLORS.teal,
            yAxisID: 'y1',
            fill: true,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: CHART_FONT, usePointStyle: true, padding: 16 } },
          tooltip: {
            backgroundColor: COLORS.tooltip, titleFont: { size: 13, weight: '700' },
            bodyFont: { size: 12 }, padding: 12, cornerRadius: 8,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: CHART_FONT } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { font: CHART_FONT },
               title: { display: true, text: 'Flood Events', font: CHART_FONT, color: COLORS.red } },
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { font: CHART_FONT },
                title: { display: true, text: 'Avg Water Level (m)', font: CHART_FONT, color: COLORS.teal } },
        },
      },
    });

    // Table
    const wrap = document.getElementById('yearly-table-wrap');
    if (wrap) {
      let html = `<table class="data-table"><thead><tr>
        <th>Year</th><th>Records</th><th>Floods</th><th>Risk %</th>
        <th>Avg WL (m)</th><th>Avg Rain (mm)</th><th>Avg Humidity</th>
        <th>Avg Discharge</th></tr></thead><tbody>`;
      data.forEach(d => {
        const riskLevel = d.flood_risk_pct >= 85 ? 'CRITICAL' : d.flood_risk_pct >= 70 ? 'HIGH' : d.flood_risk_pct >= 50 ? 'WARNING' : 'NORMAL';
        const cls = riskBadgeClass(riskLevel);
        html += `<tr>
          <td><strong>${escapeHtml(d.Year)}</strong></td>
          <td>${escapeHtml(d.total_records)}</td>
          <td>${escapeHtml(d.flood_events)}</td>
          <td><span class="badge ${cls}">${escapeHtml(d.flood_risk_pct)}%</span></td>
          <td>${escapeHtml(Number(d.avg_water_level).toFixed(2))}</td>
          <td>${escapeHtml(Number(d.avg_rainfall).toFixed(1))}</td>
          <td>${escapeHtml(Number(d.avg_humidity).toFixed(1))}%</td>
          <td>${escapeHtml(Number(d.avg_discharge).toFixed(1))}</td></tr>`;
      });
      html += '</tbody></table>';
      wrap.innerHTML = html;
    }
  } catch (e) { console.error('Yearly fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   3. MONTH-WISE CHART + TABLE
   ═══════════════════════════════════════════════════════════════════════ */
async function loadMonthly() {
  try {
    const res  = await fetch('/api/analytics/monthly');
    const data = await res.json();
    const labels = data.map(d => d.MonthName);

    makeChart('monthly-chart', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Flood Risk %',
            data: data.map(d => d.flood_risk_pct),
            backgroundColor: data.map(d => riskColor(d.flood_risk_pct) + '88'),
            borderColor: data.map(d => riskColor(d.flood_risk_pct)),
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Avg Rainfall (mm)',
            data: data.map(d => d.avg_rainfall),
            type: 'line',
            borderColor: COLORS.purple,
            backgroundColor: COLORS.purple + '18',
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: COLORS.purple,
            yAxisID: 'y1',
            fill: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: CHART_FONT, usePointStyle: true, padding: 16 } },
          tooltip: {
            backgroundColor: COLORS.tooltip, titleFont: { size: 13, weight: '700' },
            bodyFont: { size: 12 }, padding: 12, cornerRadius: 8,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: CHART_FONT } },
          y: { beginAtZero: true, max: 100, grid: { color: COLORS.grid }, ticks: { font: CHART_FONT },
               title: { display: true, text: 'Flood Risk %', font: CHART_FONT } },
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { font: CHART_FONT },
                title: { display: true, text: 'Avg Rainfall (mm)', font: CHART_FONT, color: COLORS.purple } },
        },
      },
    });

    // Table
    const wrap = document.getElementById('monthly-table-wrap');
    if (wrap) {
      let html = `<table class="data-table"><thead><tr>
        <th>Month</th><th>Records</th><th>Floods</th><th>Risk %</th>
        <th>Avg WL (m)</th><th>Avg Rain (mm)</th><th>Avg Humidity</th>
        </tr></thead><tbody>`;
      data.forEach(d => {
        const riskLevel = d.flood_risk_pct >= 85 ? 'CRITICAL' : d.flood_risk_pct >= 70 ? 'HIGH' : d.flood_risk_pct >= 50 ? 'WARNING' : 'NORMAL';
        const cls = riskBadgeClass(riskLevel);
        html += `<tr>
          <td><strong>${escapeHtml(d.MonthName)}</strong></td>
          <td>${escapeHtml(d.total_records)}</td>
          <td>${escapeHtml(d.flood_events)}</td>
          <td><span class="badge ${cls}">${escapeHtml(d.flood_risk_pct)}%</span></td>
          <td>${escapeHtml(Number(d.avg_water_level).toFixed(2))}</td>
          <td>${escapeHtml(Number(d.avg_rainfall).toFixed(1))}</td>
          <td>${escapeHtml(Number(d.avg_humidity).toFixed(1))}%</td></tr>`;
      });
      html += '</tbody></table>';
      wrap.innerHTML = html;
    }
  } catch (e) { console.error('Monthly fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   4. FLOOD RISK HEATMAP (Year × Month using Bubble Chart stand-in)
   ═══════════════════════════════════════════════════════════════════════ */
async function loadHeatmap() {
  try {
    const res  = await fetch('/api/analytics/yearmonth');
    const data = await res.json();

    const years  = [...new Set(data.map(d => d.Year))].sort();
    const months = ['Jun', 'Jul', 'Aug'];

    // Build a matrix and use a stacked bar to simulate heatmap
    const datasets = years.map((year, yi) => {
      const monthData = new Array(months.length).fill(0);
      data.filter(d => d.Year === year).forEach(d => {
        const mi = months.indexOf(d.MonthName);
        if (mi >= 0) monthData[mi] = d.flood_risk_pct;
      });
      const colors = [
        COLORS.teal, COLORS.blue, COLORS.purple,
        COLORS.amber, COLORS.orange, COLORS.red,
      ];
      return {
        label: year,
        data: monthData,
        backgroundColor: colors[yi % colors.length] + 'AA',
        borderColor: colors[yi % colors.length],
        borderWidth: 1,
        borderRadius: 3,
      };
    });

    makeChart('heatmap-chart', {
      type: 'bar',
      data: { labels: months, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: CHART_FONT, usePointStyle: true, padding: 14 } },
          tooltip: {
            backgroundColor: COLORS.tooltip, titleFont: { size: 13, weight: '700' },
            bodyFont: { size: 12 }, padding: 12, cornerRadius: 8,
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% flood risk`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: CHART_FONT } },
          y: { beginAtZero: true, max: 100, grid: { color: COLORS.grid },
               ticks: { font: CHART_FONT, callback: v => v + '%' },
               title: { display: true, text: 'Flood Risk %', font: CHART_FONT } },
        },
      },
    });
  } catch (e) { console.error('Heatmap fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   5. LAND COVER & SOIL TYPE — Donut Charts
   ═══════════════════════════════════════════════════════════════════════ */
async function loadLandCover() {
  try {
    const res  = await fetch('/api/analytics/landcover');
    const data = await res.json();
    const palette = [COLORS.teal, COLORS.blue, COLORS.purple, COLORS.amber, COLORS.orange, COLORS.red, COLORS.green, COLORS.pink];

    makeChart('landcover-chart', {
      type: 'doughnut',
      data: {
        labels: data.map(d => d['Land Cover']),
        datasets: [{
          data: data.map(d => d.floods),
          backgroundColor: data.map((_, i) => palette[i % palette.length] + 'CC'),
          borderColor: '#111827',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10, usePointStyle: true } },
          tooltip: {
            backgroundColor: COLORS.tooltip, padding: 10, cornerRadius: 8,
            callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} floods` },
          },
        },
      },
    });
  } catch (e) { console.error('Land cover fetch failed:', e); }
}

async function loadSoilType() {
  try {
    const res  = await fetch('/api/analytics/soiltype');
    const data = await res.json();
    const palette = [COLORS.orange, COLORS.amber, COLORS.teal, COLORS.purple, COLORS.blue, COLORS.red, COLORS.green, COLORS.pink];

    makeChart('soiltype-chart', {
      type: 'doughnut',
      data: {
        labels: data.map(d => d['Soil Type']),
        datasets: [{
          data: data.map(d => d.floods),
          backgroundColor: data.map((_, i) => palette[i % palette.length] + 'CC'),
          borderColor: '#111827',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10, usePointStyle: true } },
          tooltip: {
            backgroundColor: COLORS.tooltip, padding: 10, cornerRadius: 8,
            callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} floods` },
          },
        },
      },
    });
  } catch (e) { console.error('Soil type fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   6. PREDICTION — Line chart (historical + future) + Table
   ═══════════════════════════════════════════════════════════════════════ */
async function loadPrediction(months = 12) {
  try {
    const res  = await fetch(`/api/analytics/prediction?months=${months}`);
    const data = await res.json();

    const hist = data.historical;
    const pred = data.predictions;
    const info = data.model_info;

    // Combine labels
    const allLabels = hist.map(h => h.year_month).concat(pred.map(p => p.year_month));

    // Historical actual water level (null-padded for future)
    const actualWL = hist.map(h => h.actual_wl).concat(pred.map(() => null));

    // Historical fitted + predicted water level (continuous line)
    const fittedWL = hist.map(h => h.fitted_wl).concat(pred.map(p => p.predicted_wl));

    // Flood risk % (historical + predicted)
    const floodRisk = hist.map(h => h.flood_risk_pct).concat(pred.map(p => p.predicted_fr));

    // Divider index (where prediction starts)
    const dividerIdx = hist.length;

    makeChart('prediction-chart', {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          {
            label: 'Actual Water Level (m)',
            data: actualWL,
            borderColor: COLORS.teal,
            backgroundColor: COLORS.teal + '15',
            pointRadius: 2,
            pointBackgroundColor: COLORS.teal,
            tension: 0.3,
            fill: true,
            spanGaps: false,
          },
          {
            label: 'Predicted Water Level (m)',
            data: fittedWL,
            borderColor: COLORS.amber,
            borderDash: [6, 3],
            pointRadius: 0,
            tension: 0.3,
            fill: false,
          },
          {
            label: 'Flood Risk %',
            data: floodRisk,
            borderColor: COLORS.red,
            backgroundColor: COLORS.red + '12',
            pointRadius: 0,
            tension: 0.3,
            fill: true,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: COLORS.tooltip, titleFont: { size: 13, weight: '700' },
            bodyFont: { size: 12 }, padding: 14, cornerRadius: 8,
            callbacks: {
              title: ctx => ctx[0].label,
              afterBody: ctx => {
                const idx = ctx[0].dataIndex;
                if (idx >= dividerIdx) return '📌 Predicted (future)';
                return '';
              },
            },
          },
          annotation: {
            annotations: {
              divider: {
                type: 'line',
                xMin: dividerIdx - 0.5,
                xMax: dividerIdx - 0.5,
                borderColor: COLORS.slate + '66',
                borderWidth: 2,
                borderDash: [4, 4],
                label: {
                  display: true,
                  content: '← Historical | Predicted →',
                  position: 'start',
                  color: COLORS.slate,
                  font: { size: 10 },
                },
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 },
          },
          y: {
            beginAtZero: true, grid: { color: COLORS.grid }, ticks: { font: CHART_FONT },
            title: { display: true, text: 'Water Level (m)', font: CHART_FONT, color: COLORS.teal },
          },
          y1: {
            position: 'right', beginAtZero: true, max: 100,
            grid: { display: false }, ticks: { font: CHART_FONT, callback: v => v + '%' },
            title: { display: true, text: 'Flood Risk %', font: CHART_FONT, color: COLORS.red },
          },
        },
      },
    });

    // Model info bar
    const infoBar = document.getElementById('model-info-bar');
    if (infoBar && info) {
      const maeInfo = info.wl_mae !== undefined ? `<span class="model-info-item">WL MAE: <strong>${escapeHtml(info.wl_mae.toFixed(3))} m</strong></span>` : '';
      infoBar.innerHTML = `
        <span class="model-info-item">Training: <strong>${escapeHtml(info.training_months)} seasonal points</strong></span>
        <span class="model-info-item">WL R²: <strong>${escapeHtml(info.wl_r2_score.toFixed(4))}</strong></span>
        ${maeInfo}
        <span class="model-info-item">Risk R²: <strong>${escapeHtml(info.fr_r2_score.toFixed(4))}</strong></span>
        <span class="model-info-item">WL trend: <strong>${info.wl_trend_per_month > 0 ? '+' : ''}${escapeHtml(info.wl_trend_per_month.toFixed(4))} m/mo</strong></span>
      `;
    }

    // Prediction table
    const tbody = document.getElementById('prediction-tbody');
    if (tbody && Array.isArray(pred)) {
      let html = '';
      pred.forEach(p => {
        const cls = riskBadgeClass(p.risk_label);
        html += `<tr>
          <td><strong>${escapeHtml(p.month_label || p.year_month)}</strong></td>
          <td>${escapeHtml(Number(p.predicted_wl).toFixed(3))}</td>
          <td>${escapeHtml(Number(p.predicted_rf).toFixed(1))}</td>
          <td>${escapeHtml(Number(p.predicted_fr).toFixed(1))}%</td>
          <td><span class="${cls}">${escapeHtml(p.risk_label)}</span></td>
        </tr>`;
      });
      tbody.innerHTML = html;
    }
  } catch (e) { console.error('Prediction fetch failed:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
   0. ESP32 SENSOR WATER LEVEL ANALYTICS (REAL-TIME)
   ═══════════════════════════════════════════════════════════════════════ */
async function loadSensorAnalytics() {
  try {
    const res = await fetch('/api/sensor/analytics?limit=30');
    if (!res.ok) return;
    const data = await res.json();

    const latest = data.latest || {};
    const curLevel = latest.water_level !== undefined ? `${parseFloat(latest.water_level).toFixed(1)} cm` : '-- cm';
    const curPct = latest.percentage !== undefined ? `${latest.percentage}%` : '--%';
    const curStatus = (latest.status || '--').toUpperCase();

    const elCurLevel = document.getElementById('sensor-current-level');
    const elCurPct = document.getElementById('sensor-current-pct');
    const elStatusVal = document.getElementById('sensor-status-val');
    const elMin = document.getElementById('sensor-min-level');
    const elMax = document.getElementById('sensor-max-level');
    const elAvg = document.getElementById('sensor-avg-level');
    const elTotal = document.getElementById('sensor-total-count');

    if (elCurLevel) elCurLevel.textContent = curLevel;
    if (elCurPct) elCurPct.textContent = curPct;
    if (elStatusVal) {
      elStatusVal.textContent = curStatus;
      elStatusVal.className = `an-stat-card__value status-badge badge--${curStatus.toLowerCase()}`;
    }
    if (elMin) elMin.textContent = `${data.min_water_level} cm`;
    if (elMax) elMax.textContent = `${data.max_water_level} cm`;
    if (elAvg) elAvg.textContent = `${data.avg_water_level} cm`;
    if (elTotal) elTotal.textContent = Number(data.total_readings).toLocaleString();

    // Render sensor trend chart
    const history = data.history || [];
    const labels = history.map(h => {
      const ts = h.timestamp ? new Date(h.timestamp) : new Date();
      return ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });
    const wlData = history.map(h => parseFloat(h.water_level || 0));
    const pctData = history.map(h => parseFloat(h.percentage || 0));

    makeChart('sensor-trend-chart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Water Level (cm)',
            data: wlData,
            borderColor: COLORS.teal,
            backgroundColor: 'rgba(6,182,212,0.12)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            yAxisID: 'y',
          },
          {
            label: 'Water Level (%)',
            data: pctData,
            borderColor: COLORS.amber,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.35,
            pointRadius: 3,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2235',
            titleColor: '#94a3b8',
            bodyColor: '#f1f5f9',
            borderColor: '#1e293b',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.yAxisID === 'y') return ` Water Level: ${ctx.parsed.y.toFixed(1)} cm`;
                return ` Level: ${ctx.parsed.y.toFixed(1)}%`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', maxTicksLimit: 8 },
            grid: { color: 'rgba(30, 41, 59, 0.8)' }
          },
          y: {
            min: 0,
            max: 100,
            title: { display: true, text: 'Level (cm)', color: '#94a3b8', font: { size: 10 } },
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(30, 41, 59, 0.8)' }
          },
          y1: {
            position: 'right',
            min: 0,
            max: 100,
            title: { display: true, text: 'Percentage (%)', color: '#94a3b8', font: { size: 10 } },
            ticks: { color: '#94a3b8', callback: v => v + '%' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });

    // Render sensor status breakdown donut
    const breakdown = data.status_breakdown || {};
    const statusLabels = ['NORMAL', 'WARNING', 'HIGH', 'CRITICAL'];
    const statusCounts = statusLabels.map(s => breakdown[s] || 0);
    const statusColors = [COLORS.green, COLORS.amber, COLORS.orange, COLORS.red];

    makeChart('sensor-status-chart', {
      type: 'doughnut',
      data: {
        labels: statusLabels,
        datasets: [{
          data: statusCounts,
          backgroundColor: statusColors,
          borderColor: '#0a0e1a',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', usePointStyle: true, padding: 12 }
          }
        }
      }
    });

  } catch (err) {
    console.warn('loadSensorAnalytics failed:', err);
  }
}

/* ── Socket.IO Real-time Synchronization ────────────────────────────── */
if (typeof io !== 'undefined') {
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 20000,
  });

  socket.on('connect', () => {
    const badge = document.getElementById('sensor-sync-badge');
    if (badge) {
      badge.textContent = '● LIVE SYNC';
      badge.style.color = '#10b981';
      badge.style.borderColor = '#10b981';
    }
    loadSensorAnalytics();
  });

  socket.on('disconnect', () => {
    const badge = document.getElementById('sensor-sync-badge');
    if (badge) {
      badge.textContent = 'OFFLINE';
      badge.style.color = '#f59e0b';
      badge.style.borderColor = '#f59e0b';
    }
  });

  socket.on('sensor_update', () => {
    loadSensorAnalytics();
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT — Load everything on page ready
   ═══════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Get initial months selection
  const monthsSelect = document.getElementById('predict-months');
  const months = monthsSelect ? parseInt(monthsSelect.value, 10) : 12;

  // Load sensor analytics and dataset sections
  loadSensorAnalytics();
  loadSummary();
  loadYearly();
  loadMonthly();
  loadHeatmap();
  loadLandCover();
  loadSoilType();
  loadPrediction(months);
  loadRainEvents();

  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const m = parseInt(monthsSelect.value, 10);
      loadSensorAnalytics();
      loadSummary();
      loadYearly();
      loadMonthly();
      loadHeatmap();
      loadLandCover();
      loadSoilType();
      loadPrediction(m);
      loadRainEvents();
    });
  }

  // Months dropdown change
  if (monthsSelect) {
    monthsSelect.addEventListener('change', () => {
      loadPrediction(parseInt(monthsSelect.value, 10));
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   8. SIGNIFICANT RAINFALL EVENTS WITH DATE & TIME
   ═══════════════════════════════════════════════════════════════════════ */
async function loadRainEvents() {
  const tbody = document.getElementById('analytics-rain-events-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/rain/events?limit=25');
    if (!res.ok) return;
    const data = await res.json();
    const events = data.historical_events || [];

    if (!events.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">No rainfall records found.</td></tr>';
      return;
    }

    tbody.innerHTML = events
      .map((ev, i) => {
        let chipClass = 'intensity-chip--light';
        const intensity = ev.intensity || 'Light Rain';
        if (intensity.includes('Torrential')) chipClass = 'intensity-chip--torrential';
        else if (intensity.includes('Heavy')) chipClass = 'intensity-chip--heavy';
        else if (intensity.includes('Moderate')) chipClass = 'intensity-chip--moderate';

        const floodBadge = ev.flood_occurred
          ? '<span class="risk-badge badge--critical" style="font-size: 0.7rem; padding: 0.15rem 0.5rem;">FLOOD OCCURRED</span>'
          : '<span class="risk-badge badge--normal" style="font-size: 0.7rem; padding: 0.15rem 0.5rem;">CONTAINED</span>';

        return `
        <tr>
          <td style="font-weight: 600; color: var(--text-muted);">${i + 1}</td>
          <td class="td-date">${escapeHtml(ev.date_formatted || ev.date)}</td>
          <td class="td-time">${escapeHtml(ev.time_12h || ev.time)}</td>
          <td class="td-rainfall">${ev.rainfall_mm} mm</td>
          <td style="font-family: var(--font-mono);">${ev.water_level_m} m</td>
          <td><span class="intensity-chip ${chipClass}">${escapeHtml(intensity)}</span></td>
          <td>${floodBadge}</td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to load analytics rain events:', err);
  }
}

