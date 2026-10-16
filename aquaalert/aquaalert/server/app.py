"""
app.py - AquaAlert Flask + Flask-SocketIO Backend Server
=========================================================

Complete data flow:
    ESP32
      -> HTTP POST /api/data (JSON every 3 seconds)
      -> Flask validates + recalculates status
      -> SQLite stores the reading
      -> Flask-SocketIO broadcasts to all browser clients
      -> Dashboard updates in real-time (no page refresh needed)

Endpoints:
    POST /api/data     - Receive authenticated ESP32 sensor data
    GET  /api/latest   - Most recent reading
    GET  /api/history  - Last N readings (?limit=50)
    GET  /api/status   - ESP32 online/offline status (?device_id=AQUA-001)
    GET  /api/map/points - Geospatial sample of India flood dataset
    GET  /api/analytics/* - Analytics and forecasting endpoints
    GET  /             - Serve dashboard HTML
"""

import hmac
import logging
import os
from datetime import datetime, timezone
from typing import Any

import analytics
import database
import mumbai_drainage
import weather_service
from geo_resolver import resolve_nearest_city
import pandas as pd
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO
from validation import validate_sensor_payload

# ── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("aquaalert.server")

# ── Server Configuration ──────────────────────────────────────────────────────
HOST = os.getenv("AQUAALERT_HOST", "0.0.0.0")
PORT = int(os.getenv("AQUAALERT_PORT", "5000"))
OFFLINE_THRESHOLD = int(os.getenv("AQUAALERT_OFFLINE_THRESHOLD", "10"))

# ── Flask App Setup ───────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)

app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "templates"),
    static_folder=os.path.join(_ROOT, "static"),
)
app.config["SECRET_KEY"] = os.getenv("AQUAALERT_SECRET_KEY", "change-me-in-production")
app.config["API_KEY"] = os.getenv("AQUAALERT_API_KEY", "")

# Enable CORS for external or separately-hosted frontend clients
try:
    from flask_cors import CORS
    CORS(app, resources={r"/api/*": {"origins": "*"}})
except ImportError:
    pass


@app.after_request
def add_cors_headers(response):
    """Ensure CORS headers are set on API responses."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# Allow WebSocket connections from any origin
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Global State ──────────────────────────────────────────────────────────────
last_data_time: datetime | None = None  # UTC timestamp of latest ESP32 data across all devices
last_rain_time: datetime | None = None  # UTC timestamp of latest detected rainfall > 0
last_rain_amount: float = 0.0           # Latest rainfall in mm
device_last_seen: dict[str, datetime] = {}  # Per-device last-seen UTC timestamps
VALID_STATUSES = {"NORMAL", "WARNING", "HIGH", "CRITICAL"}


# ── Helper: Server-Side Status Calculation ────────────────────────────────────
def calculate_status(percentage: int) -> str:
    """
    Recalculate status from percentage (server is the single source of truth).

    Required thresholds for the prototype:
        0–49%   -> NORMAL
        50–69%  -> WARNING
        70–84%  -> HIGH
        85–100% -> CRITICAL
    """
    if percentage >= 85:
        return "CRITICAL"
    elif percentage >= 70:
        return "HIGH"
    elif percentage >= 50:
        return "WARNING"
    return "NORMAL"


def _api_key_valid() -> bool:
    """Validate incoming X-API-Key header against configured key."""
    configured_key = app.config.get("API_KEY", "")
    if not configured_key:
        return True  # If no API key configured, allow open local access
    provided_key = request.headers.get("X-API-Key", "")
    return bool(provided_key) and hmac.compare_digest(provided_key, configured_key)


# ── Page Routes ───────────────────────────────────────────────────────────────


@app.route("/")
def index():
    """Serve the live home overview page."""
    return render_template("dashboard.html")


@app.route("/dashboard")
def dashboard():
    """Serve the Dashboard page (charts + indicator row)."""
    return render_template("charts.html")


@app.route("/analytics")
def analytics_page():
    """Serve the Analytics & Prediction page."""
    return render_template("analytics.html")


@app.route("/about")
def about():
    """Serve the About page."""
    return render_template("about.html")


@app.route("/mumbai-drainage")
def mumbai_drainage_page():
    """Serve the Mumbai Monsoon Drainage & Heavy Rainfall IoT Monitoring Dashboard."""
    return render_template("mumbai_drainage.html")


# ── Analytics API Endpoints ───────────────────────────────────────────────────


@app.route("/api/analytics/summary", methods=["GET"])
def api_analytics_summary():
    try:
        return jsonify(analytics.get_summary()), 200
    except Exception as exc:
        logger.error("Failed to generate analytics summary: %s", exc)
        return jsonify({"error": "Failed to generate summary"}), 500


@app.route("/api/analytics/yearly", methods=["GET"])
def api_analytics_yearly():
    try:
        return jsonify(analytics.get_yearly()), 200
    except Exception as exc:
        logger.error("Failed to generate yearly analytics: %s", exc)
        return jsonify({"error": "Failed to generate yearly analytics"}), 500


@app.route("/api/analytics/monthly", methods=["GET"])
def api_analytics_monthly():
    try:
        return jsonify(analytics.get_monthly()), 200
    except Exception as exc:
        logger.error("Failed to generate monthly analytics: %s", exc)
        return jsonify({"error": "Failed to generate monthly analytics"}), 500


@app.route("/api/analytics/yearmonth", methods=["GET"])
def api_analytics_yearmonth():
    try:
        return jsonify(analytics.get_yearmonth()), 200
    except Exception as exc:
        logger.error("Failed to generate year-month analytics: %s", exc)
        return jsonify({"error": "Failed to generate year-month analytics"}), 500


@app.route("/api/analytics/landcover", methods=["GET"])
def api_analytics_landcover():
    try:
        return jsonify(analytics.get_land_cover()), 200
    except Exception as exc:
        logger.error("Failed to generate land cover analytics: %s", exc)
        return jsonify({"error": "Failed to generate land cover analytics"}), 500


@app.route("/api/analytics/soiltype", methods=["GET"])
def api_analytics_soiltype():
    try:
        return jsonify(analytics.get_soil_type()), 200
    except Exception as exc:
        logger.error("Failed to generate soil type analytics: %s", exc)
        return jsonify({"error": "Failed to generate soil type analytics"}), 500


@app.route("/api/analytics/prediction", methods=["GET"])
def api_analytics_prediction():
    try:
        months = int(request.args.get("months", 12))
        months = max(1, min(months, 24))
    except ValueError:
        months = 12

    try:
        return jsonify(analytics.get_prediction(months)), 200
    except Exception as exc:
        logger.error("Failed to generate prediction: %s", exc)
        return jsonify({"error": "Failed to generate prediction"}), 500


@app.route("/api/map/points", methods=["GET"])
def api_map_points():
    """Return a sampled India flood-risk dataset for the map view."""
    try:
        df = pd.read_csv(os.path.join(_ROOT, "Datasets", "flood_risk_dataset_india.csv"))
    except FileNotFoundError:
        return jsonify({"error": "Flood dataset not found", "points": []}), 404
    except Exception as exc:
        logger.error("Error reading map dataset: %s", exc)
        return jsonify({"error": "Failed to read dataset", "points": []}), 500

    needed_columns = [
        "Latitude",
        "Longitude",
        "Rainfall (mm)",
        "Water Level (m)",
        "River Discharge (m³/s)",
        "Elevation (m)",
        "Historical Floods",
        "Flood Occurred",
    ]
    missing = [col for col in needed_columns if col not in df.columns]
    if missing:
        return jsonify({"error": f"Missing required map columns: {missing}", "points": []}), 400

    df = df[needed_columns].dropna(subset=["Latitude", "Longitude"]).copy()
    df["Flood Occurred"] = pd.to_numeric(df["Flood Occurred"], errors="coerce").fillna(0).astype(int)
    df["Historical Floods"] = pd.to_numeric(df["Historical Floods"], errors="coerce").fillna(0).astype(int)

    try:
        limit = int(request.args.get("limit", 500))
        limit = max(1, min(limit, 1000))
    except ValueError:
        limit = 500

    flood_rows = df[df["Flood Occurred"] == 1].head(max(1, int(limit * 0.6)))
    no_flood_rows = df[df["Flood Occurred"] == 0]
    no_flood_sample = no_flood_rows.sample(
        n=min(len(no_flood_rows), max(0, limit - len(flood_rows))),
        random_state=42,
    )

    sampled = pd.concat([flood_rows, no_flood_sample], ignore_index=True)
    points: list[dict[str, Any]] = []
    for _, row in sampled.iterrows():
        lat = float(row["Latitude"])
        lon = float(row["Longitude"])
        points.append(
            {
                "Latitude": lat,
                "Longitude": lon,
                "City": resolve_nearest_city(lat, lon),
                "Rainfall (mm)": float(row["Rainfall (mm)"]),
                "Water Level (m)": float(row["Water Level (m)"]),
                "River Discharge (m³/s)": float(row["River Discharge (m³/s)"]),
                "Elevation (m)": float(row["Elevation (m)"]),
                "Historical Floods": int(row["Historical Floods"]),
                "Flood Occurred": int(row["Flood Occurred"]),
            }
        )

    return jsonify({"points": points}), 200


# ── Rain Telemetry & Events Endpoints ─────────────────────────────────────────


@app.route("/api/rain/latest", methods=["GET"])
def api_rain_latest():
    """
    GET /api/rain/latest
    Return current/latest rain tracking info including exact Date and Time.
    """
    try:
        db_rain = database.get_latest_rain_event()
        now = datetime.now()

        rain_ts = None
        rainfall_val = 0.0
        if db_rain and float(db_rain.get("rainfall") or 0) > 0:
            rain_ts = str(db_rain.get("timestamp"))
            rainfall_val = float(db_rain.get("rainfall", 0.0))
        elif last_rain_time:
            rain_ts = last_rain_time.strftime("%Y-%m-%d %H:%M:%S")
            rainfall_val = last_rain_amount

        summary = analytics.get_rain_summary()
        fallback_date = summary.get("latest_rain_date", now.strftime("%d %b %Y"))
        fallback_datetime = summary.get("latest_rain_datetime", f"{fallback_date}, 09:30 AM")

        # Parse date and time components
        if rain_ts and " " in rain_ts:
            parts = rain_ts.split(" ")
            d_part = parts[0]
            t_part = parts[1][:8]
            try:
                dt_obj = datetime.strptime(f"{d_part} {t_part}", "%Y-%m-%d %H:%M:%S")
                date_formatted = dt_obj.strftime("%d %b %Y")
                time_formatted = dt_obj.strftime("%I:%M:%S %p")
                full_formatted = f"{date_formatted}, {time_formatted}"
            except Exception:
                date_formatted = d_part
                time_formatted = t_part
                full_formatted = rain_ts
        else:
            date_formatted = fallback_date
            time_formatted = "09:30:00 AM"
            full_formatted = fallback_datetime

        status_text = (
            "Heavy Rain"
            if rainfall_val >= 100
            else (
                "Moderate Rain"
                if rainfall_val >= 50
                else ("Light Rain" if rainfall_val >= 5 else "No Rain Detected")
            )
        )

        return jsonify({
            "rainfall_mm": round(rainfall_val, 1),
            "rain_status": status_text,
            "last_rain_date": date_formatted,
            "last_rain_time": time_formatted,
            "last_rain_datetime": full_formatted,
            "current_observation_date": now.strftime("%d %b %Y"),
            "current_observation_time": now.strftime("%I:%M:%S %p"),
            "current_timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
            "summary": summary,
        }), 200
    except Exception as exc:
        logger.error("Error in /api/rain/latest: %s", exc)
        return jsonify({"error": "Failed to get rain data"}), 500


@app.route("/api/rain/events", methods=["GET"])
def api_rain_events():
    """
    GET /api/rain/events
    Return chronological and significant rainfall records with exact Date and Time.
    """
    try:
        limit = int(request.args.get("limit", 20))
        limit = max(1, min(limit, 100))
        db_events = database.get_recent_rain_events(limit=limit)
        dataset_events = analytics.get_rainfall_events_with_datetime(limit=limit)

        return jsonify({
            "sensor_events": db_events,
            "historical_events": dataset_events,
        }), 200
    except Exception as exc:
        logger.error("Error in /api/rain/events: %s", exc)
        return jsonify({"error": "Failed to get rain events"}), 500


# ── Live Weather Telemetry & Precipitation API Endpoints ──────────────────────


@app.route("/api/weather", methods=["GET"])
def api_weather():
    """
    GET /api/weather
    Query parameters:
        ?area=mumbai_dadar (or any locality name)
        ?city=Mumbai
        ?lat=19.076&lon=72.8777
        ?refresh=true
    Return current meteorological metrics, WMO condition, 12h forecast, and flood impact.
    """
    try:
        area = request.args.get("area")
        city = request.args.get("city", "Mumbai")
        lat_str = request.args.get("lat")
        lon_str = request.args.get("lon")
        refresh = request.args.get("refresh", "").lower() in ("true", "1", "yes")

        lat = float(lat_str) if lat_str is not None else None
        lon = float(lon_str) if lon_str is not None else None

        data = weather_service.get_weather(
            city=city,
            area=area,
            lat=lat,
            lon=lon,
            force_refresh=refresh,
        )
        return jsonify({"success": True, "weather": data}), 200
    except Exception as exc:
        logger.error("Error in /api/weather: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/weather/cities", methods=["GET"])
def api_weather_cities():
    """
    GET /api/weather/cities
    Return pre-configured Indian cities with coordinates for easy dashboard selection.
    """
    try:
        cities = weather_service.get_available_cities()
        return jsonify({"success": True, "cities": cities}), 200
    except Exception as exc:
        logger.error("Error in /api/weather/cities: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/weather/areas", methods=["GET"])
def api_weather_areas():
    """
    GET /api/weather/areas
    Return pre-configured local wards, micro-zones, and drainage catchments.
    """
    try:
        areas = weather_service.get_available_areas()
        return jsonify({"success": True, "count": len(areas), "areas": areas}), 200
    except Exception as exc:
        logger.error("Error in /api/weather/areas: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/weather/sync", methods=["POST"])
def api_weather_sync():
    """
    POST /api/weather/sync
    Force immediate refresh of weather data and broadcast to all connected WebSocket clients.
    """
    try:
        req_body = request.get_json(silent=True) or {}
        city = req_body.get("city", "Mumbai")
        area = req_body.get("area")
        lat = req_body.get("lat")
        lon = req_body.get("lon")

        data = weather_service.get_weather(
            city=city,
            area=area,
            lat=float(lat) if lat is not None else None,
            lon=float(lon) if lon is not None else None,
            force_refresh=True,
        )
        socketio.emit("weather_update", data)
        return jsonify({"success": True, "message": "Weather synchronized", "weather": data}), 200
    except Exception as exc:
        logger.error("Error in /api/weather/sync: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


# ── Mumbai Monsoon Drainage & IoT Telemetry API Endpoints ─────────────────────


@app.route("/api/mumbai/drains", methods=["GET"])
def api_mumbai_drains():
    """Return list of all Mumbai stormwater drains with live proximity metrics."""
    try:
        heavy_only = request.args.get("heavy_rain_only", "").lower() in ("true", "1", "yes")
        ward = request.args.get("ward") or None
        status = request.args.get("status") or None
        drains = mumbai_drainage.get_all_mumbai_drains(
            heavy_rain_only=heavy_only,
            ward=ward,
            status=status,
        )
        return jsonify({"success": True, "count": len(drains), "drains": drains}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_drains: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/mumbai/stations", methods=["GET"])
def api_mumbai_stations():
    """Return all automatic weather stations across Mumbai with rainfall rates."""
    try:
        stations = mumbai_drainage.get_mumbai_weather_stations()
        return jsonify({"success": True, "stations": stations}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_stations: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/tide", methods=["GET"])
@app.route("/api/mumbai/tide", methods=["GET"])
def api_mumbai_tide():
    """Return Arabian Sea live tide height, high/low cycle, and floodgate status."""
    try:
        tide = mumbai_drainage.get_tide_telemetry()
        return jsonify({"success": True, "tide": tide}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_tide: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/tide/simulate", methods=["POST"])
def api_tide_simulate():
    """Simulate high tide, low tide, or spring surge scenario."""
    try:
        payload = request.get_json(silent=True) or {}
        scenario = payload.get("scenario", "high_tide_surge")
        custom_height = payload.get("height_m")
        if custom_height is not None:
            try:
                custom_height = float(custom_height)
            except (ValueError, TypeError):
                custom_height = None

        tide = mumbai_drainage.set_tide_simulation(scenario, custom_height)
        socketio.emit("tide_update", tide)
        socketio.emit("mumbai_drainage_update", {
            "tide": tide,
            "drains": mumbai_drainage.get_all_mumbai_drains(),
            "stations": mumbai_drainage.get_mumbai_weather_stations(),
            "hardware": mumbai_drainage.get_esp32_hardware_state(),
        })
        return jsonify({"success": True, "scenario": scenario, "tide": tide}), 200
    except Exception as exc:
        logger.error("Error in api_tide_simulate: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/mumbai/hardware", methods=["GET"])
def api_mumbai_hardware():
    """Return current state of the ESP32 Hardware Digital Twin."""
    try:
        hw_state = mumbai_drainage.get_esp32_hardware_state()
        return jsonify({"success": True, "hardware": hw_state}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_hardware: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/mumbai/assign-node", methods=["POST"])
def api_mumbai_assign_node():
    """Bind the physical ESP32 device to a chosen Mumbai drain."""
    try:
        data = request.get_json(silent=True) or {}
        drain_id = data.get("drain_id")
        device_id = data.get("device_id", "AQUA-001")
        if not drain_id:
            return jsonify({"success": False, "error": "drain_id is required"}), 400

        updated_drain = mumbai_drainage.assign_hardware_node_to_drain(drain_id, device_id)
        if not updated_drain:
            return jsonify({"success": False, "error": "Drain not found"}), 404

        hw_state = mumbai_drainage.get_esp32_hardware_state()
        socketio.emit("mumbai_drainage_update", {
            "type": "node_reassigned",
            "drain_id": drain_id,
            "device_id": device_id,
            "hardware": hw_state,
            "drains": mumbai_drainage.get_all_mumbai_drains(),
        })
        return jsonify({"success": True, "drain": updated_drain, "hardware": hw_state}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_assign_node: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/mumbai/simulate", methods=["POST"])
def api_mumbai_simulate():
    """Trigger a monsoon weather scenario (cloudburst, heavy_rain, high_tide_surge, normal)."""
    try:
        data = request.get_json(silent=True) or {}
        scenario = data.get("scenario", "heavy_rain")
        rainfall = data.get("rainfall")
        if rainfall is not None:
            rainfall = float(rainfall)

        result = mumbai_drainage.set_monsoon_scenario(scenario, rainfall)
        drains = mumbai_drainage.get_all_mumbai_drains()
        socketio.emit("mumbai_drainage_update", {
            "type": "scenario_changed",
            "scenario": result["scenario"],
            "drains": drains,
            "tide": result["tide"],
            "stations": result["stations"],
            "hardware": result["hardware"],
        })
        return jsonify({"success": True, "result": result, "drains": drains}), 200
    except Exception as exc:
        logger.error("Error in api_mumbai_simulate: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


# ── Sensor Data Ingestion Endpoint ────────────────────────────────────────────


@app.route("/api/data", methods=["GET"])
def data_info():
    """
    GET /api/data
    Informational endpoint returning a clear JSON explanation for GET requests.
    """
    return jsonify({
        "error": "This endpoint only accepts POST requests with a JSON sensor payload",
        "example_payload": {
            "device_id": "AQUA-001",
            "distance": 50.0,
            "waterLevel": 50.0,
            "percentage": 50,
            "status": "WARNING"
        }
    }), 405


@app.route("/api/data", methods=["POST"])
def receive_data():
    """
    POST /api/data
    Receive sensor reading from ESP32.
    """
    global last_data_time, last_rain_time, last_rain_amount

    if not _api_key_valid():
        return jsonify(
            {"success": False, "error": "Valid X-API-Key header required"}
        ), 401

    payload = request.get_json(silent=True)
    normalized, errors = validate_sensor_payload(payload)
    if errors:
        return jsonify({"success": False, "error": "; ".join(errors)}), 400

    device_id = normalized["device_id"]
    distance = normalized["distance"]
    water_level = normalized["waterLevel"]
    percentage = normalized["percentage"]
    rainfall = float(normalized.get("rainfall", 0.0) or 0.0)

    # Recalculate status server-side (single source of truth)
    status = calculate_status(percentage)

    try:
        # 1. Store in SQLite
        row_id = database.insert_reading(
            device_id=str(device_id),
            distance=float(distance),
            water_level=float(water_level),
            percentage=int(percentage),
            status=status,
            rainfall=rainfall,
        )

        # 2. Update last-seen timestamps
        now_utc = datetime.now(timezone.utc)
        last_data_time = now_utc
        device_last_seen[str(device_id)] = now_utc

        if rainfall > 0:
            last_rain_time = now_utc
            last_rain_amount = rainfall

        rain_dt_str = (
            last_rain_time.strftime("%Y-%m-%d %H:%M:%S")
            if last_rain_time
            else None
        )

        # 3. Build broadcast payload
        reading = {
            "id": row_id,
            "device_id": str(device_id),
            "distance": float(distance),
            "water_level": float(water_level),
            "percentage": int(percentage),
            "status": status,
            "rainfall": rainfall,
            "last_rain_datetime": rain_dt_str,
            "timestamp": now_utc.strftime("%Y-%m-%d %H:%M:%S"),
        }

        # 4. Broadcast to connected WebSocket dashboard clients
        socketio.emit("sensor_update", reading)

        # 5. Update Mumbai Drainage Network & ESP32 Hardware Digital Twin
        hw_state = mumbai_drainage.ingest_esp32_telemetry({
            "device_id": str(device_id),
            "distance": float(distance),
            "waterLevel": float(water_level),
            "percentage": int(percentage),
            "status": status,
            "rainfall": rainfall,
        })
        socketio.emit("mumbai_drainage_update", {
            "type": "telemetry_tick",
            "device_id": str(device_id),
            "reading": reading,
            "hardware": hw_state,
            "drains": mumbai_drainage.get_all_mumbai_drains(),
            "tide": mumbai_drainage.get_tide_telemetry(),
        })

        logger.info(
            "[DATA] Ingested reading id=%d device=%s lvl=%.1fcm (%d%%) rf=%.1fmm status=%s",
            row_id, device_id, water_level, percentage, rainfall, status
        )

        return jsonify(
            {"success": True, "message": "Data received", "status": status}
        ), 200

    except Exception as exc:
        logger.error("Error storing reading from %s: %s", device_id, exc)
        return jsonify({"success": False, "error": "Internal server error"}), 500


@app.route("/api/latest", methods=["GET"])
def get_latest():
    """
    GET /api/latest
    Returns the most recent sensor reading.
    """
    try:
        reading = database.get_latest_reading()
        if reading is None:
            return jsonify({"message": "No data available"}), 404
        reading = dict(reading)
        reading["last_rain_datetime"] = (
            last_rain_time.strftime("%Y-%m-%d %H:%M:%S")
            if last_rain_time
            else None
        )
        return jsonify(reading), 200
    except Exception as exc:
        logger.error("Error in /api/latest: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/history", methods=["GET"])
def get_history():
    """
    GET /api/history?limit=50&order=desc|asc
    Returns recent readings, ordered newest first (desc) or oldest first (asc).
    """
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400

    order = request.args.get("order", "desc").lower()
    limit = max(1, min(limit, 500))
    try:
        if order == "asc":
            readings = database.get_history_asc(limit=limit)
        else:
            readings = database.get_history(limit=limit)
        return jsonify(readings), 200
    except Exception as exc:
        logger.error("Error in /api/history: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/sensor/analytics", methods=["GET"])
def api_sensor_analytics():
    """
    GET /api/sensor/analytics?limit=50
    Returns aggregated sensor statistics, risk status distribution,
    and chronological reading history from SQLite.
    """
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        limit = 50
    limit = max(1, min(limit, 500))
    try:
        data = database.get_sensor_analytics(limit=limit)
        return jsonify(data), 200
    except Exception as exc:
        logger.error("Error in /api/sensor/analytics: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    """
    GET /api/status?device_id=AQUA-001
    Reports whether the ESP32 is currently online.
    """
    target_device = request.args.get("device_id")
    target_time = device_last_seen.get(target_device) if target_device else last_data_time

    if target_time is None:
        return jsonify({"online": False, "last_seen": None, "device_id": target_device}), 200

    elapsed = (datetime.now(timezone.utc) - target_time).total_seconds()
    online = elapsed <= OFFLINE_THRESHOLD

    return jsonify(
        {
            "online": online,
            "last_seen": target_time.isoformat(),
            "device_id": target_device or "all",
            "elapsed_seconds": round(elapsed, 1),
        }
    ), 200


# ── SocketIO Events ───────────────────────────────────────────────────────────


@socketio.on("connect")
def on_connect():
    """Immediately push the latest reading to the newly connected browser."""
    logger.info("WebSocket client connected: %s", request.sid)
    try:
        reading = database.get_latest_reading()
        if reading:
            socketio.emit("sensor_update", reading, to=request.sid)

        # Push initial Mumbai Drainage & Hardware Twin telemetry
        socketio.emit("mumbai_drainage_init", {
            "drains": mumbai_drainage.get_all_mumbai_drains(),
            "stations": mumbai_drainage.get_mumbai_weather_stations(),
            "tide": mumbai_drainage.get_tide_telemetry(),
            "hardware": mumbai_drainage.get_esp32_hardware_state(),
        }, to=request.sid)

        # Push initial Weather API telemetry
        socketio.emit("weather_update", weather_service.get_weather("Mumbai"), to=request.sid)
    except Exception as exc:
        logger.error("Error sending initial reading to %s: %s", request.sid, exc)


@socketio.on("disconnect")
def on_disconnect():
    logger.info("WebSocket client disconnected: %s", request.sid)


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("=" * 55)
    logger.info("  AquaAlert Backend Server")
    logger.info("  Dashboard  ->  http://localhost:%d", PORT)
    logger.info("  API Data   ->  http://localhost:%d/api/data", PORT)
    logger.info("  Latest     ->  http://localhost:%d/api/latest", PORT)
    logger.info("  History    ->  http://localhost:%d/api/history", PORT)
    logger.info("=" * 55)

    database.init_db()
    socketio.run(app, host=HOST, port=PORT, debug=True, allow_unsafe_werkzeug=True)
