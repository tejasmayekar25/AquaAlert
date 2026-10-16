# 🌊 AquaAlert

AquaAlert is a local, end-to-end flood-monitoring prototype built for real-time waterlogging detection. It combines an ESP32-based sensor node, a Flask backend, SQLite storage, live dashboard updates, and data-driven forecasting to help monitor drainage capacity and flood risk in a practical, low-cost way.

> Built for a local prototype workflow: ESP32 sends data to a Flask server, the server validates and stores it, the dashboard visualizes live status, and the analytics layer studies flood risk patterns using a sample India flood dataset.

---

## Why this project exists

Urban waterlogging is a recurring problem during intense rainfall. Small drainage systems can overflow quickly, causing road flooding, blocked traffic flow, and unsafe public conditions. AquaAlert was designed as a local, affordable monitoring solution that can detect rising water levels before they become critical.

This project focuses on the complete loop:

- sense water depth with an ultrasonic sensor
- interpret the reading as a percentage-based risk level
- alert locally with a buzzer and LCD
- push the reading to a Python Flask API
- save the data in SQLite
- broadcast the update live to a dashboard
- analyze historical patterns from a flood-risk dataset

---

## Core features

- Real-time water-level sensing with ESP32 + AJ-SR04M ultrasonic sensor
- On-device local alerts through LCD and buzzer
- Secure HTTP ingestion with API key validation
- Persistent SQLite storage of readings
- Live WebSocket dashboard updates using Flask-SocketIO
- Interactive flood map using geospatial India dataset points
- Seasonal analytics and forecasting based on rainfall and water-level trends
- Dark-theme dashboard with live status, charts, and map views

---

## System architecture

```text
ESP32 + AJ-SR04M sensor
        │
        ▼
  Local ultrasonic reading
        │
        ▼
   Calculate percentage + status
        │
        ├── LCD display (local indication)
        ├── Buzzer alert (NORMAL / WARNING / HIGH / CRITICAL)
        └── HTTP POST to Flask API
                      │
                      ▼
           Flask server + validation
                      │
                      ├── SQLite database
                      ├── Socket.IO live dashboard updates
                      └── analytics + forecasting
                              │
                              ▼
                     Web dashboard + chart view
                              │
                              ▼
                 Flood-risk map + trend analysis
```

---

## Hardware stack

- ESP32 Dev Module
- AJ-SR04M waterproof ultrasonic sensor
- 16x2 I2C LCD display
- Active buzzer
- USB power or battery supply
- Local Wi-Fi network

### Typical sensor logic

The sensor measures the air gap between the mounted point and the water surface:

```text
distance = ultrasonic reading in cm
waterLevel = MAX_DEPTH - distance
percentage = (waterLevel / MAX_DEPTH) * 100
```

With a prototype depth of 100 cm, the status thresholds are:

- 0–49% → NORMAL
- 50–69% → WARNING
- 70–84% → HIGH
- 85–100% → CRITICAL

---

## Software stack

- Python 3
- Flask
- Flask-SocketIO
- SQLite
- Pandas + NumPy
- scikit-learn
- Chart.js
- Plotly
- HTML / CSS / JavaScript

---

## Project structure

```text
D:\aquaalert
├── Datasets
│   └── flood_risk_dataset_india.csv
├── esp32
│   ├── aquaalert_esp32.ino
│   └── secrets.h.example
├── server
│   ├── app.py
│   ├── analytics.py
│   ├── database.py
│   ├── validation.py
│   └── aquaalert.db
├── static
│   ├── dashboard.js
│   ├── style.css
│   └── analytics.js
├── templates
│   ├── about.html
│   ├── analytics.html
│   ├── charts.html
│   └── dashboard.html
├── tests
│   └── test_aquaalert.py
├── README.md
├── test_server.py
├── .gitignore
├── .venv
└── requirements.txt
```

---

## Local setup

### 1) Create a virtual environment

```powershell
cd D:\aquaalert
python -m venv .venv
.venv\Scripts\activate
```

### 2) Install dependencies

```powershell
pip install -r requirements.txt
```

If the project is being run from the workspace in a local environment, the standard app dependencies include Flask, Flask-SocketIO, pandas, numpy, and scikit-learn.

### 3) Set environment variables

```powershell
$env:AQUAALERT_API_KEY = "your-local-api-key"
$env:AQUAALERT_SECRET_KEY = "your-local-secret-key"
$env:AQUAALERT_PORT = "5000"
```

---

## Run the app locally

```powershell
cd D:\aquaalert
.venv\Scripts\activate
python server\app.py
```

Then open:

- http://localhost:5000/
- http://localhost:5000/dashboard
- http://localhost:5000/analytics
- http://localhost:5000/about

---

## Dashboard and analytics

The app includes a real-time dashboard with:

- live water level stats
- offline/online device health
- warning banner states
- Chart.js trend graphs
- seasonal flood-risk analysis
- India flood-risk map with region-based markers
- configurable forecast horizon

The dataset in the project provides geospatial flood-risk points with columns such as:

- Latitude
- Longitude
- Rainfall (mm)
- Water Level (m)
- River Discharge (m³/s)
- Elevation (m)
- Historical Floods
- Flood Occurred

This lets the app combine live sensor monitoring with historical risk context.

---

## ESP32 integration

The firmware sends a JSON payload to the Flask API at a local endpoint such as:

```json
{
  "device_id": "AQUA-001",
  "distance": 28.5,
  "waterLevel": 71.5,
  "percentage": 72,
  "status": "HIGH"
}
```

The server validates the payload, rejects malformed or unauthorized requests, and calculates the canonical status server-side before storing the data.

---

## API overview

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/data | Receive ESP32 readings |
| GET | /api/latest | Fetch most recent reading |
| GET | /api/history | Fetch recent readings |
| GET | /api/status | Check device online/offline state |
| GET | /api/analytics/summary | Dataset summary |
| GET | /api/analytics/yearly | Year-wise summary |
| GET | /api/analytics/monthly | Seasonal trend data |
| GET | /api/analytics/prediction | Forecasted flood risk |
| GET | /api/map/points | Sampled India flood map data |

---

## Validation and test status

The project includes automated validation for threshold logic, API behavior, and sensor payload handling. The local verification suite confirms the expected status boundaries and API safety checks.

---

## Why this is a strong local prototype

AquaAlert is intentionally designed as a practical local system rather than a cloud-heavy platform. That keeps it easy to test, inexpensive to run, and fully observable in a single environment. It demonstrates the complete lifecycle of an IoT monitoring project:

- sensor capture
- local processing
- edge alerting
- API ingestion
- database persistence
- live monitoring
- historic analysis

---

## Future improvements

- add stronger sensor calibration for real drainage setups
- show more advanced flood-risk scoring on the map
- connect multiple sensor nodes to one dashboard
- add SMS or push notifications for critical events
- deploy with secure environment-based config for production use

---

## Summary

AquaAlert turns low-cost hardware and open-source software into a functional flood-monitoring prototype. It is designed to be simple to understand, easy to run locally, and valuable as both a learning project and a practical monitoring base for waterlogging conditions.

### Analytics and Prediction Page

The `/analytics` page provides a broader view of the supplied dataset, including:

- Summary cards for records, flood events, average risk, water level, and rainfall.
- Year-wise and month-wise seasonal charts and tables.
- Year × month flood-risk heatmap.
- Land-cover and soil-type risk breakdowns.
- A selectable seasonal forecast table containing only June, July, and August points.

The supplied dataset contains only June, July, and August records for 2023–2025. The forecasting engine in `server\analytics.py` filters to those three months, aggregates each year-month, and trains separate scikit-learn Linear Regression models for water level, flood risk, and rainfall. The API's `months` parameter is retained for compatibility and is converted to seasonal points: `6` produces 2 points, `12` produces 4, `18` produces 6, and `24` produces 8. Forecasts therefore contain June, July, and August of subsequent years only; no September–May values are fabricated or zero-filled.

---

## 🧭 Production Roadmap

The current prototype is suitable for local demonstration and single-device
monitoring. The following capabilities are not yet implemented and should be
added before a production deployment:

- **Data export:** Add authenticated CSV export for readings and reports. PDF
  reports can be generated from the same filtered data for stakeholders.
- **Retention and archiving:** Keep recent readings in SQLite and periodically
  move records older than 90 days to partitioned CSV or a production database.
- **Multi-device support:** The schema already stores `device_id`; add indexed
  device and timestamp queries, device filters, and per-device online state in
  the dashboard before deploying multiple ESP32 units.
- **External alerts:** Integrate an email, SMS, or push provider for
  `CRITICAL` events, with cooldowns and delivery logging to prevent alert spam.
- **Production deployment:** Use HTTPS, a reverse proxy, a strong secret API
  key per device, and a production WSGI/Socket.IO deployment configuration.

The dashboard CSS includes responsive layouts for narrow screens, but mobile
testing should be repeated with the final device count and alert workflows.

---

## 🧪 Testing Without Water

Before deploying near actual water, use your **hand** as a simulated water surface:

| Hand Distance from Sensor | Simulated Water % | Expected Status | Buzzer |
|---------------------------|-------------------|-----------------|--------|
| ~100 cm away              | 0%                | 🟢 NORMAL       | Silent |
| ~75 cm away               | ~25%              | � NORMAL       | quiet |
| ~50 cm away               | ~50%              | 🟡 WARNING      | double beep |
| ~30 cm away               | ~70%              | 🟠 HIGH         | 3 beeps |
| ~15 cm away               | ~85%              | 🔴 CRITICAL     | Continuous |

**Watch simultaneously:**
- Serial Monitor (115200 baud) — raw sensor output
- Dashboard at http://localhost:5000 — live updates

---

## 🔄 Complete Data Flow

```
 ┌──────────────────────────────────────────────────────────────┐
 │  AJ-SR04M sends echo pulse → ESP32 measures duration         │
 │  duration (µs) × 0.034 / 2 = distance (cm)                  │
 └─────────────────────────┬────────────────────────────────────┘
                           │ every 2 seconds
                           ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  ESP32 calculates:                                           │
 │    waterLevel = MAX_DEPTH(100) − distance                    │
 │    percentage = (waterLevel / 100) × 100                     │
 │    status     = NORMAL / WARNING / HIGH / CRITICAL           │
 │  ESP32 updates: LCD Line 2 + Buzzer pattern                  │
 └─────────────────────────┬────────────────────────────────────┘
                           │ HTTP POST JSON every 3 seconds
                           ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  Flask (app.py) — POST /api/data                             │
 │    1. Parse + validate JSON fields                           │
 │    2. Recalculate status server-side (single source of truth)│
 │    3. database.insert_reading() → aquaalert.db               │
 │    4. socketio.emit("sensor_update", reading)                │
 │    5. Return {"success": true, "status": "HIGH"}             │
 └─────────────────────────┬────────────────────────────────────┘
                           │ WebSocket broadcast (instant)
                           ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  Browser Dashboard (dashboard.js)                            │
 │    socket.on("sensor_update") →                              │
 │      updateStatCards(data)      — all info cards             │
 │      addLivePoint(pct, time)    — live chart point           │
 │      showAlertBanner(status)    — alert if needed            │
 │      highlightIndicator(status) — glow the active level      │
 │    fetchHistory() every 30s     — refresh month-wise data    │
 │    fetchPrediction()            — update selected forecast   │
 │    year selector                — filter seasonal data       │
 │    horizon selector             — choose 2–8 seasonal points│
 │    offlineWatchdog every 1s     — flip OFFLINE after 10s     │
 └──────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Troubleshooting

### Wi-Fi Not Connecting

| Symptom | Fix |
|---------|-----|
| Dots print forever in Serial Monitor | Check SSID/password (case-sensitive) |
| Connects then disconnects | Move ESP32 closer to router |
| Never connects | Ensure router is **2.4 GHz** (ESP32 doesn't support 5 GHz) |

---

### ESP32 → Flask: "POST failed"

| Symptom | Fix |
|---------|-----|
| `[HTTP] POST failed - connection refused` | Start Flask: `python server\app.py` |
| `[HTTP] POST failed - no route to host` | Use PC's LAN IP (`172.16.244.196`), not `localhost` |
| ESP32 and PC both connected but can't reach each other | Both must be on the **same Wi-Fi network** |
| Windows Firewall blocking | Allow Python through firewall, or allow port 5000 inbound |

**Windows Firewall (allow port 5000):**
```powershell
netsh advfirewall firewall add rule name="AquaAlert Flask" dir=in action=allow protocol=TCP localport=5000
```

---

### LCD Issues

| Symptom | Fix |
|---------|-----|
| Blank screen, backlight on | Wrong I²C address — try `0x3F` instead of `0x27` |
| No backlight at all | VCC must be **5V**, not 3.3V |
| Dim/invisible text | Adjust contrast potentiometer on I²C backpack |
| Garbage characters | Wrong I²C address or bad SDA/SCL wiring |

**I²C Scanner sketch** — upload to find your LCD's address:
```cpp
#include <Wire.h>
void setup() {
  Wire.begin(21, 22); Serial.begin(115200);
  for (byte a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0)
      Serial.printf("Found I2C device at 0x%02X\n", a);
  }
}
void loop() {}
```

---

### Ultrasonic Sensor Issues

| Symptom | Fix |
|---------|-----|
| Always reads 0 / timeout | Check TRIG→GPIO5 and ECHO→GPIO18 (not swapped) |
| Wildly fluctuating readings | Add a small delay between readings (already 2s in firmware) |
| Reads MAX or very large values | Object is out of sensor range (AJ-SR04M: 2–450 cm) |
| Correct distance but wrong water level | Adjust `MAX_DEPTH` in firmware to match actual drain depth |

---

### Buzzer Issues

| Symptom | Fix |
|---------|-----|
| Silent — active buzzer | Check GPIO23 → (+), GND → (−) |
| Silent — passive buzzer | Passive buzzers need PWM/`tone()` — use an **active** buzzer |
| Always beeping | Status is stuck at CRITICAL — check sensor readings |

---

### Dashboard Issues

| Symptom | Fix |
|---------|-----|
| "OFFLINE" shown immediately | Flask server not running, or no data sent yet |
| Charts not loading | Check browser console for CDN errors (need internet) |
| Dashboard not updating live | Check Socket.IO connection in browser console |
| `TemplateNotFound` error | Ensure `templates\dashboard.html` exists |
| `No module named flask` | Activate venv: `.venv\Scripts\activate` |

---

## ✅ Verified Test Results

The live Flask server and analytics endpoints were verified on **2026-08-29** on this machine.

Current status threshold verification:

| Percentage | Result |
|------------|--------|
| 0% | `NORMAL` |
| 25% | `NORMAL` |
| 60% | `WARNING` |
| 88% | `CRITICAL` |

The expanded `test_server.py` suite covers the current status names, API-key authentication, boundary values, invalid input, malformed JSON, and both dashboard routes. GitHub Actions runs the same suite on pushes and pull requests.

Re-run tests anytime:
```powershell
.venv\Scripts\python test_server.py
```

---

## 🌐 Quick Reference URLs

| URL | Description |
|-----|-------------|
| http://localhost:5000 | Live dashboard (from this PC) |
| http://localhost:5000/dashboard | Live and month-wise chart dashboard |
| http://localhost:5000/analytics | Analytics and prediction dashboard |
| http://172.16.244.196:5000 | Live dashboard (from any device on same Wi-Fi) |
| http://localhost:5000/api/latest | Latest sensor reading (JSON) |
| http://localhost:5000/api/history | Historical readings (JSON) |
| http://localhost:5000/api/status | ESP32 online status (JSON) |
| http://localhost:5000/api/analytics/prediction?months=12 | 4-point seasonal forecast (JSON) |

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Microcontroller | ESP32 Dev Module (Arduino framework) |
| Sensor | AJ-SR04M Waterproof Ultrasonic |
| Display | 16×2 LCD + PCF8574 I²C backpack |
| Alert | Active buzzer (GPIO digital) |
| Communication | Wi-Fi 802.11 b/g/n (2.4 GHz), HTTP POST |
| Backend | Python 3.12 + Flask 3.0.3 |
| Real-time | Flask-SocketIO 5.3.6 + eventlet 0.36.1 |
| Database | SQLite 3 (via Python `sqlite3`) |
| Frontend | HTML5 + CSS3 + Vanilla JavaScript |
| Charts | Chart.js 4.4.3 + chartjs-adapter-date-fns 3.0.0 |
| WebSocket Client | Socket.IO 4.7.4 |

---

*AquaAlert v1.0 — Built with ESP32 + Python Flask + Chart.js*
