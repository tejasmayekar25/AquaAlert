"""
mumbai_drainage.py - AquaAlert Mumbai Monsoon Drainage & IoT Hardware Twin Engine
==================================================================================
Manages:
  - 16+ key Mumbai stormwater drains, underpasses, nullahs, and coastal outfalls
  - Mumbai Automatic Weather Stations (AWS) network & rainfall tracking
  - Heavy rainfall proximity correlation (IMD >= 65 mm/h threshold)
  - Arabian Sea tide levels & coastal floodgate telemetry
  - ESP32 Hardware Digital Twin (AJ-SR04M ultrasonic, 16x2 LCD, 3 LEDs, Buzzer)
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── Haversine Distance Helper ────────────────────────────────────────────────
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in kilometers between two GPS coordinates."""
    r = 6371.0  # Earth radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(max(0.0, min(1.0, a))))


# ── Mumbai Automatic Weather Stations (AWS) ──────────────────────────────────
DEFAULT_WEATHER_STATIONS: Dict[str, Dict[str, Any]] = {
    "AWS-SCZ": {
        "id": "AWS-SCZ",
        "name": "Santacruz Observatory (IMD)",
        "zone": "Western Suburbs",
        "lat": 19.0886,
        "lon": 72.8679,
        "rainfall_mm_h": 82.5,  # Heavy rain
        "condition": "Heavy Downpour",
        "wind_kmh": 34.0,
        "humidity_pct": 94,
    },
    "AWS-COL": {
        "id": "AWS-COL",
        "name": "Colaba Observatory (IMD)",
        "zone": "South Mumbai",
        "lat": 18.9067,
        "lon": 72.8147,
        "rainfall_mm_h": 42.0,  # Moderate
        "condition": "Steady Showers",
        "wind_kmh": 28.0,
        "humidity_pct": 89,
    },
    "AWS-DAD": {
        "id": "AWS-DAD",
        "name": "Dadar Fire Station AWS (BMC)",
        "zone": "Central Mumbai",
        "lat": 19.0178,
        "lon": 72.8478,
        "rainfall_mm_h": 88.0,  # Heavy rain
        "condition": "Intense Rain Cell",
        "wind_kmh": 32.0,
        "humidity_pct": 95,
    },
    "AWS-KURLA": {
        "id": "AWS-KURLA",
        "name": "Kurla L-Ward AWS (BMC)",
        "zone": "Central Suburbs",
        "lat": 19.0726,
        "lon": 72.8845,
        "rainfall_mm_h": 94.0,  # Heavy rain
        "condition": "Heavy Monsoon Cloudburst",
        "wind_kmh": 36.0,
        "humidity_pct": 96,
    },
    "AWS-ANDH": {
        "id": "AWS-ANDH",
        "name": "Andheri West AWS (BMC)",
        "zone": "Western Suburbs North",
        "lat": 19.1197,
        "lon": 72.8464,
        "rainfall_mm_h": 76.5,  # Heavy rain
        "condition": "Heavy Rain Squall",
        "wind_kmh": 30.0,
        "humidity_pct": 92,
    },
    "AWS-CHEM": {
        "id": "AWS-CHEM",
        "name": "Chembur Trombay AWS (BMC)",
        "zone": "Eastern Suburbs",
        "lat": 19.0622,
        "lon": 72.9023,
        "rainfall_mm_h": 54.0,  # Moderate
        "condition": "Moderate Monsoon Rain",
        "wind_kmh": 24.0,
        "humidity_pct": 91,
    },
    "AWS-BOR": {
        "id": "AWS-BOR",
        "name": "Borivali National Park AWS (BMC)",
        "zone": "Northern Suburbs",
        "lat": 19.2288,
        "lon": 72.8541,
        "rainfall_mm_h": 38.0,  # Moderate
        "condition": "Light to Moderate Showers",
        "wind_kmh": 20.0,
        "humidity_pct": 88,
    },
    "AWS-POW": {
        "id": "AWS-POW",
        "name": "Powai Lake Basin AWS",
        "zone": "Central Hills",
        "lat": 19.1257,
        "lon": 72.9051,
        "rainfall_mm_h": 69.0,  # Heavy rain
        "condition": "Heavy Hill Catchment Runoff",
        "wind_kmh": 26.0,
        "humidity_pct": 93,
    },
}

weather_stations: Dict[str, Dict[str, Any]] = {k: dict(v) for k, v in DEFAULT_WEATHER_STATIONS.items()}


# ── Mumbai Stormwater Drainage Network ───────────────────────────────────────
DEFAULT_MUMBAI_DRAINS: List[Dict[str, Any]] = [
    {
        "id": "DRN-MUM-001",
        "name": "Hindmata Britannia Basin Drain",
        "landmark": "Hindmata Flyover & Parel TT",
        "ward": "F/South & F/North",
        "basin": "Mahim Creek & Britannia Outfall",
        "lat": 19.0178,
        "lon": 72.8478,
        "max_depth_cm": 150.0,
        "water_level_cm": 115.5,
        "percentage": 77,
        "status": "HIGH",
        "silt_index_pct": 32,
        "discharge_rate_m3s": 18.5,
        "pumping_station": "Britannia Pumping Station (Reay Road)",
        "pumps_running": 4,
        "pumps_capacity": 6,
        "gate_status": "LOCKED_HIGH_TIDE",
        "assigned_device_id": "AQUA-001",  # Physical ESP32 bound here by default
        "is_hardware_node": True,
    },
    {
        "id": "DRN-MUM-002",
        "name": "Milan Subway Stormwater Sump",
        "landmark": "Milan Subway Underpass, Santacruz West",
        "ward": "H/West",
        "basin": "Irla Nullah / Arabian Sea",
        "lat": 19.0831,
        "lon": 72.8427,
        "max_depth_cm": 200.0,
        "water_level_cm": 164.0,
        "percentage": 82,
        "status": "HIGH",
        "silt_index_pct": 45,
        "discharge_rate_m3s": 24.0,
        "pumping_station": "Irla Stormwater Pumping Station",
        "pumps_running": 5,
        "pumps_capacity": 8,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-003",
        "name": "Kurla Kranti Nagar Mithi Confluence",
        "landmark": "Bail Bazaar & Kranti Nagar, Kurla West",
        "ward": "L Ward",
        "basin": "Mithi River Main Channel",
        "lat": 19.0726,
        "lon": 72.8845,
        "max_depth_cm": 250.0,
        "water_level_cm": 222.5,
        "percentage": 89,
        "status": "CRITICAL",
        "silt_index_pct": 58,
        "discharge_rate_m3s": 42.0,
        "pumping_station": "Mithi River Sluice Gate Control",
        "pumps_running": 2,
        "pumps_capacity": 4,
        "gate_status": "PARTIAL_BACKFLOW",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-004",
        "name": "Andheri Subway Mogra Nullah Culvert",
        "landmark": "SV Road & Andheri Railway Subway",
        "ward": "K/West & K/East",
        "basin": "Mogra Nullah Basin",
        "lat": 19.1197,
        "lon": 72.8464,
        "max_depth_cm": 180.0,
        "water_level_cm": 140.4,
        "percentage": 78,
        "status": "HIGH",
        "silt_index_pct": 41,
        "discharge_rate_m3s": 19.2,
        "pumping_station": "Mogra Pumping Station",
        "pumps_running": 3,
        "pumps_capacity": 4,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-005",
        "name": "Gandhi Market / King's Circle Drain",
        "landmark": "Sion Circle & Gandhi Market Low Point",
        "ward": "F/North",
        "basin": "Mahim Bay / Sion Nullah",
        "lat": 19.0345,
        "lon": 72.8596,
        "max_depth_cm": 140.0,
        "water_level_cm": 121.8,
        "percentage": 87,
        "status": "CRITICAL",
        "silt_index_pct": 52,
        "discharge_rate_m3s": 15.0,
        "pumping_station": "Gandhi Market Holding Pond & Pumps",
        "pumps_running": 4,
        "pumps_capacity": 4,
        "gate_status": "PUMPS_MAX_LOAD",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-006",
        "name": "Dharavi Mahim Creek Tidal Outfall",
        "landmark": "Kala Killa & 90-Feet Road, Dharavi",
        "ward": "G/North",
        "basin": "Mahim Creek Tidal Estuary",
        "lat": 19.0435,
        "lon": 72.8631,
        "max_depth_cm": 220.0,
        "water_level_cm": 180.4,
        "percentage": 82,
        "status": "HIGH",
        "silt_index_pct": 60,
        "discharge_rate_m3s": 35.0,
        "pumping_station": "Mahim Causeway Tidal Sluice Gates",
        "pumps_running": 2,
        "pumps_capacity": 6,
        "gate_status": "HIGH_TIDE_RESTRICTED",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-007",
        "name": "Chembur Shell Colony Drain",
        "landmark": "Postal Colony & Shell Colony Road",
        "ward": "M/West",
        "basin": "Mahul Creek Channel",
        "lat": 19.0622,
        "lon": 72.9023,
        "max_depth_cm": 130.0,
        "water_level_cm": 75.4,
        "percentage": 58,
        "status": "WARNING",
        "silt_index_pct": 28,
        "discharge_rate_m3s": 12.0,
        "pumping_station": "Mahul Stormwater Sump",
        "pumps_running": 2,
        "pumps_capacity": 3,
        "gate_status": "NORMAL_DISCHARGE",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-008",
        "name": "Bandra Gazdarbandh Nullah Outfall",
        "landmark": "SV Road & Gazdarbandh Slums, Khar/Bandra",
        "ward": "H/West",
        "basin": "Gazdarbandh Basin / Arabian Sea",
        "lat": 19.0607,
        "lon": 72.8362,
        "max_depth_cm": 190.0,
        "water_level_cm": 129.2,
        "percentage": 68,
        "status": "WARNING",
        "silt_index_pct": 36,
        "discharge_rate_m3s": 28.0,
        "pumping_station": "Gazdarbandh Pumping Station",
        "pumps_running": 3,
        "pumps_capacity": 6,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-009",
        "name": "Sakinaka Powai Runoff Culvert",
        "landmark": "Sakinaka Metro Junction & 90-Feet Rd",
        "ward": "L Ward",
        "basin": "Powai Lake Overflow Basin",
        "lat": 19.1066,
        "lon": 72.8876,
        "max_depth_cm": 160.0,
        "water_level_cm": 118.4,
        "percentage": 74,
        "status": "HIGH",
        "silt_index_pct": 39,
        "discharge_rate_m3s": 22.5,
        "pumping_station": "Sakinaka High-Velocity Sump",
        "pumps_running": 2,
        "pumps_capacity": 3,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-010",
        "name": "Malad Subway & SV Road Drain",
        "landmark": "Malad Subway & Marve Road Underpass",
        "ward": "P/North",
        "basin": "Poinsur River / Marve Creek",
        "lat": 19.1860,
        "lon": 72.8485,
        "max_depth_cm": 170.0,
        "water_level_cm": 110.5,
        "percentage": 65,
        "status": "WARNING",
        "silt_index_pct": 31,
        "discharge_rate_m3s": 16.0,
        "pumping_station": "Malad Subway Dewatering Station",
        "pumps_running": 2,
        "pumps_capacity": 4,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-011",
        "name": "Haji Ali Love Grove Outfall",
        "landmark": "Haji Ali Bay & Dr E Moses Road, Worli",
        "ward": "G/South",
        "basin": "Love Grove Outfall / Arabian Sea",
        "lat": 18.9772,
        "lon": 72.8155,
        "max_depth_cm": 240.0,
        "water_level_cm": 110.4,
        "percentage": 46,
        "status": "NORMAL",
        "silt_index_pct": 22,
        "discharge_rate_m3s": 55.0,
        "pumping_station": "Love Grove Pumping Station (Worli)",
        "pumps_running": 3,
        "pumps_capacity": 8,
        "gate_status": "GRAVITY_DISCHARGE",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-012",
        "name": "Cleveland Bunder Worli Outfall",
        "landmark": "Worli Dairy / Cleveland Bunder",
        "ward": "G/South",
        "basin": "Cleveland Bunder Catchment",
        "lat": 19.0064,
        "lon": 72.8188,
        "max_depth_cm": 200.0,
        "water_level_cm": 92.0,
        "percentage": 46,
        "status": "NORMAL",
        "silt_index_pct": 20,
        "discharge_rate_m3s": 40.0,
        "pumping_station": "Cleveland Bunder Pumping Station",
        "pumps_running": 2,
        "pumps_capacity": 7,
        "gate_status": "GRAVITY_DISCHARGE",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-013",
        "name": "Dahisar River Basin & Toll Naka Drain",
        "landmark": "WEH & Dahisar River Bridge",
        "ward": "R/North",
        "basin": "Dahisar River Catchment",
        "lat": 19.2578,
        "lon": 72.8595,
        "max_depth_cm": 180.0,
        "water_level_cm": 81.0,
        "percentage": 45,
        "status": "NORMAL",
        "silt_index_pct": 25,
        "discharge_rate_m3s": 26.0,
        "pumping_station": "Dahisar River Flow Regulator",
        "pumps_running": 1,
        "pumps_capacity": 3,
        "gate_status": "OPEN",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-014",
        "name": "Vidyavihar Station LBS Trunk Drain",
        "landmark": "LBS Marg & Vidyavihar Railway Culvert",
        "ward": "N Ward",
        "basin": "Ghatkopar Nullah / Thane Creek",
        "lat": 19.0798,
        "lon": 72.8974,
        "max_depth_cm": 150.0,
        "water_level_cm": 105.0,
        "percentage": 70,
        "status": "HIGH",
        "silt_index_pct": 37,
        "discharge_rate_m3s": 14.5,
        "pumping_station": "Vidyavihar Railway Sump",
        "pumps_running": 2,
        "pumps_capacity": 3,
        "gate_status": "DISCHARGING",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-015",
        "name": "Colaba Sasoon Dock Drainage Culvert",
        "landmark": "Sasoon Dock & Strand Road, Colaba",
        "ward": "A Ward",
        "basin": "Mumbai Harbour Catchment",
        "lat": 18.9175,
        "lon": 72.8252,
        "max_depth_cm": 160.0,
        "water_level_cm": 56.0,
        "percentage": 35,
        "status": "NORMAL",
        "silt_index_pct": 18,
        "discharge_rate_m3s": 18.0,
        "pumping_station": "Colaba Marine Sluice Gate",
        "pumps_running": 1,
        "pumps_capacity": 4,
        "gate_status": "GRAVITY_DISCHARGE",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
    {
        "id": "DRN-MUM-016",
        "name": "Bhandup Sonapur LBS Drain",
        "landmark": "Sonapur Junction & Bhandup Industrial Area",
        "ward": "S Ward",
        "basin": "Thane Creek Estuary Basin",
        "lat": 19.1450,
        "lon": 72.9320,
        "max_depth_cm": 150.0,
        "water_level_cm": 72.0,
        "percentage": 48,
        "status": "NORMAL",
        "silt_index_pct": 24,
        "discharge_rate_m3s": 16.0,
        "pumping_station": "Bhandup East Dewatering Pump",
        "pumps_running": 1,
        "pumps_capacity": 3,
        "gate_status": "OPEN",
        "assigned_device_id": None,
        "is_hardware_node": False,
    },
]

mumbai_drains: List[Dict[str, Any]] = [dict(d) for d in DEFAULT_MUMBAI_DRAINS]


# ── Arabian Sea Tide Status ──────────────────────────────────────────────────
current_tide: Dict[str, Any] = {
    "coast": "Arabian Sea (Mumbai Coastal Basin)",
    "height_m": 4.62,
    "spring_tide_threshold_m": 4.50,
    "is_high_tide": True,
    "phase": "HIGH TIDE (SPRING SURGE)",
    "phase_code": "high_surge",
    "peak_time": "14:48 IST",
    "next_low_tide": "20:30 IST (1.10m)",
    "peak_high_tide": {"time": "14:48 IST", "height_m": 4.62, "type": "High Tide (Spring Peak)"},
    "evening_low_tide": {"time": "20:30 IST", "height_m": 1.10, "type": "Low Tide (Ebb)"},
    "morning_low_tide": {"time": "08:20 IST", "height_m": 1.35, "type": "Morning Low Tide"},
    "next_high_tide": {"time": "03:15 IST", "height_m": 3.92, "type": "Secondary High Tide"},
    "floodgates_locked": True,
    "lock_status_text": "LOCKED - BACKFLOW PREVENTION",
    "advisory": "Arabian Sea high tide exceeds 4.50m spring threshold. All 45 coastal gravity outfalls locked by sea surge. BMC dewatering pumping stations (Britannia, Love Grove, Cleveland Bunder, Haji Ali, Gazdarbandh) operating at 100% capacity.",
    "gauge_pct": 84,
    "schedule": [
        {"label": "Morning Low", "time": "08:20 IST", "height_m": 1.35, "type": "Low Tide", "status": "Past"},
        {"label": "Spring Peak", "time": "14:48 IST", "height_m": 4.62, "type": "High Tide", "status": "Active Peak"},
        {"label": "Evening Low", "time": "20:30 IST", "height_m": 1.10, "type": "Low Tide", "status": "Upcoming"},
        {"label": "Night High", "time": "03:15 IST", "height_m": 3.92, "type": "High Tide", "status": "Upcoming"},
    ],
    "coastal_outfalls": [
        {"name": "Britannia Outfall", "basin": "Hindmata / Reay Road", "status": "LOCKED", "pumps": "ACTIVE (100%)", "risk": "CRITICAL"},
        {"name": "Love Grove Outfall", "basin": "Worli / Lower Parel", "status": "LOCKED", "pumps": "ACTIVE (100%)", "risk": "HIGH"},
        {"name": "Cleveland Bunder", "basin": "Worli Seaface / Dadar", "status": "LOCKED", "pumps": "ACTIVE (95%)", "risk": "HIGH"},
        {"name": "Haji Ali Outfall", "basin": "Tardeo / Mahalaxmi", "status": "LOCKED", "pumps": "ACTIVE (90%)", "risk": "HIGH"},
        {"name": "Gazdarbandh Pumping", "basin": "Khar / Bandra West", "status": "LOCKED", "pumps": "ACTIVE (100%)", "risk": "CRITICAL"},
        {"name": "Mahim Causeway Sluice", "basin": "Mithi River Estuary", "status": "LOCKED", "pumps": "ACTIVE (100%)", "risk": "CRITICAL"},
    ],
    "last_updated": datetime.now(timezone.utc).isoformat(),
}


# ── Physical ESP32 Hardware Digital Twin State ────────────────────────────────
# Tracks the real-world hardware:
#   - AJ-SR04M Waterproof Ultrasonic Sensor (Distance cm)
#   - 16x2 Character LCD (Line 1, Line 2)
#   - 3 GPIO LEDs (Green, Yellow, Red)
#   - Buzzer (GPIO 23/32)
esp32_hardware_state: Dict[str, Any] = {
    "device_id": "AQUA-001",
    "bound_drain_id": "DRN-MUM-001",
    "bound_drain_name": "Hindmata Britannia Basin Drain",
    "is_online": True,
    "last_seen": datetime.now(timezone.utc).isoformat(),
    "wifi_rssi_dbm": -62,
    # Sensor Readings
    "distance_cm": 34.5,
    "water_level_cm": 115.5,
    "percentage": 77,
    "status": "HIGH",
    "rainfall_mm": 88.0,
    # 16x2 Character LCD Digital Twin (16 chars each)
    "lcd_line_1": "HINDMATA DRAIN  ",
    "lcd_line_2": "LVL: 77%    HIGH",
    # GPIO Actuators
    "led_green": False,   # GPIO 27 (<50%)
    "led_yellow": False,  # GPIO 26 (50-69%)
    "led_red": True,      # GPIO 25 (>=70%)
    # Buzzer
    "buzzer_active": True,
    "buzzer_mode": "PULSE",       # "SILENT", "PULSE", "CONTINUOUS"
    "buzzer_pin": 23,
    "buzzer_note": "Acoustic alarm pulsing (Water Level >= 70% HIGH)",
}


# ── Correlation & Proximity Engine ───────────────────────────────────────────
HEAVY_RAIN_THRESHOLD_MM_H = 65.0  # IMD Heavy Rain criterion: >= 65 mm/hr


def recalculate_drain_proximity(drain: Dict[str, Any]) -> Dict[str, Any]:
    """
    Correlate drain location with nearest weather station and check for heavy rainfall.
    """
    d_lat = drain["lat"]
    d_lon = drain["lon"]

    closest_station = None
    min_dist = 9999.0

    for stn in weather_stations.values():
        dist = haversine_km(d_lat, d_lon, stn["lat"], stn["lon"])
        if dist < min_dist:
            min_dist = dist
            closest_station = stn

    # Check if drain itself is experiencing heavy rain or is within 4 km of a heavy rain cell
    nearest_heavy_station = None
    min_heavy_dist = 9999.0

    for stn in weather_stations.values():
        if stn["rainfall_mm_h"] >= HEAVY_RAIN_THRESHOLD_MM_H:
            dist = haversine_km(d_lat, d_lon, stn["lat"], stn["lon"])
            if dist < min_heavy_dist:
                min_heavy_dist = dist
                nearest_heavy_station = stn

    in_heavy_rain = bool(
        (closest_station and closest_station["rainfall_mm_h"] >= HEAVY_RAIN_THRESHOLD_MM_H)
        or min_heavy_dist <= 3.8
    )

    drain["nearest_station"] = closest_station["name"] if closest_station else "Unknown"
    drain["nearest_station_id"] = closest_station["id"] if closest_station else ""
    drain["distance_to_station_km"] = round(min_dist, 2)
    drain["local_rainfall_mm_h"] = closest_station["rainfall_mm_h"] if closest_station else 0.0
    drain["in_heavy_rain_zone"] = in_heavy_rain
    drain["heavy_rain_station"] = nearest_heavy_station["name"] if nearest_heavy_station else None
    drain["distance_to_heavy_rain_km"] = round(min_heavy_dist, 2) if nearest_heavy_station else None

    # Calculate overflow countdown minutes (heuristic based on % and rain rate)
    pct = drain["percentage"]
    if pct >= 100:
        drain["minutes_to_overflow"] = 0
    elif pct >= 85:
        drain["minutes_to_overflow"] = max(5, int((100 - pct) * 1.5))
    elif pct >= 70:
        drain["minutes_to_overflow"] = max(15, int((100 - pct) * 2.5))
    elif pct >= 50:
        drain["minutes_to_overflow"] = max(45, int((100 - pct) * 4.0))
    else:
        drain["minutes_to_overflow"] = None

    return drain


def get_all_mumbai_drains(
    heavy_rain_only: bool = False,
    ward: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return all Mumbai drains with updated real-time proximity and metrics."""
    results = []
    for drain in mumbai_drains:
        updated = recalculate_drain_proximity(drain)
        if heavy_rain_only and not updated["in_heavy_rain_zone"]:
            continue
        if ward and ward.lower() not in updated["ward"].lower():
            continue
        if status and updated["status"].upper() != status.upper():
            continue
        results.append(updated)

    # Sort drains so that critical / heavy rain drains appear at the top
    status_order = {"OVERFLOW": 0, "CRITICAL": 1, "HIGH": 2, "WARNING": 3, "NORMAL": 4}
    results.sort(
        key=lambda d: (
            0 if d["in_heavy_rain_zone"] else 1,
            status_order.get(d["status"], 5),
            -d["percentage"],
        )
    )
    return results


def get_mumbai_weather_stations() -> List[Dict[str, Any]]:
    """Return list of all Mumbai automatic weather stations."""
    return list(weather_stations.values())


def get_tide_telemetry() -> Dict[str, Any]:
    """Return current Arabian Sea tide telemetry."""
    return current_tide


def set_tide_simulation(scenario: str, custom_height: Optional[float] = None) -> Dict[str, Any]:
    """
    Simulate ocean tide level changes (e.g. spring high tide surge, ebb low tide, normal).
    Updates current_tide parameters, gauge percentage, and outfall gates lock status.
    """
    sc = (scenario or "normal").lower().strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    if sc in ("high_tide_surge", "spring_high_tide", "spring_surge"):
        height = round(custom_height if custom_height is not None else 4.88, 2)
        current_tide["height_m"] = height
        current_tide["is_high_tide"] = True
        current_tide["phase"] = f"SPRING HIGH TIDE ({height:.2f}m)"
        current_tide["phase_code"] = "high_surge"
        current_tide["floodgates_locked"] = True
        current_tide["lock_status_text"] = "LOCKED - BACKFLOW PREVENTION"
        current_tide["advisory"] = (
            f"Tidal lock in effect: Arabian Sea high tide at {height:.2f} meters exceeds 4.50m spring surge threshold. "
            "Sea surge preventing gravity discharge. All 45 coastal sluice gates locked. BMC dewatering pumps operating at 100% capacity."
        )
        current_tide["gauge_pct"] = min(100, int((height / 5.5) * 100))
        for gate in current_tide.get("coastal_outfalls", []):
            gate["status"] = "LOCKED"
            gate["pumps"] = "ACTIVE (100%)"
            gate["risk"] = "CRITICAL"
        if len(current_tide.get("schedule", [])) > 1:
            current_tide["schedule"][1]["status"] = "Active Surge"

    elif sc in ("high_tide_normal", "high_tide", "high"):
        height = round(custom_height if custom_height is not None else 4.25, 2)
        current_tide["height_m"] = height
        current_tide["is_high_tide"] = True
        current_tide["phase"] = f"HIGH TIDE ({height:.2f}m)"
        current_tide["phase_code"] = "high"
        current_tide["floodgates_locked"] = height >= 4.50
        current_tide["lock_status_text"] = "LOCKED - HIGH TIDE" if height >= 4.50 else "MONITORED GRAVITY DISCHARGE"
        current_tide["advisory"] = (
            f"Arabian Sea high tide at {height:.2f}m. Level is below 4.50m spring surge lock threshold. "
            "Gravity outfalls monitored; automated dewatering pumps primed."
        )
        current_tide["gauge_pct"] = min(100, int((height / 5.5) * 100))
        for gate in current_tide.get("coastal_outfalls", []):
            gate["status"] = "LOCKED" if height >= 4.50 else "MONITORED"
            gate["pumps"] = "STANDBY (60%)"
            gate["risk"] = "MODERATE"

    elif sc in ("low_tide", "low", "ebb"):
        height = round(custom_height if custom_height is not None else 1.15, 2)
        current_tide["height_m"] = height
        current_tide["is_high_tide"] = False
        current_tide["phase"] = f"LOW TIDE (EBB - {height:.2f}m)"
        current_tide["phase_code"] = "low"
        current_tide["floodgates_locked"] = False
        current_tide["lock_status_text"] = "OPEN - GRAVITY DRAINAGE ACTIVE"
        current_tide["advisory"] = (
            f"Low tide in Arabian Sea ({height:.2f}m). All coastal gravity outfalls wide open for rapid stormwater discharge. "
            "Zero backflow risk. Dewatering pumps on minimum standby cycle."
        )
        current_tide["gauge_pct"] = min(100, int((height / 5.5) * 100))
        for gate in current_tide.get("coastal_outfalls", []):
            gate["status"] = "OPEN"
            gate["pumps"] = "STANDBY (0%)"
            gate["risk"] = "LOW"
        if len(current_tide.get("schedule", [])) > 2:
            current_tide["schedule"][2]["status"] = "Active Low"

    elif sc in ("normal", "falling_ebb", "rising"):
        height = round(custom_height if custom_height is not None else 2.50, 2)
        current_tide["height_m"] = height
        current_tide["is_high_tide"] = False
        current_tide["phase"] = f"MEAN SEA LEVEL ({height:.2f}m)"
        current_tide["phase_code"] = "normal"
        current_tide["floodgates_locked"] = False
        current_tide["lock_status_text"] = "OPEN - GRAVITY DRAINAGE ACTIVE"
        current_tide["advisory"] = "Normal tidal conditions. All coastal gravity outfalls operational."
        current_tide["gauge_pct"] = min(100, int((height / 5.5) * 100))
        for gate in current_tide.get("coastal_outfalls", []):
            gate["status"] = "OPEN"
            gate["pumps"] = "STANDBY (15%)"
            gate["risk"] = "NORMAL"

    else:
        height = round(custom_height if custom_height is not None else 3.50, 2)
        is_high = height >= 3.80
        locked = height >= 4.50
        current_tide["height_m"] = height
        current_tide["is_high_tide"] = is_high
        current_tide["phase"] = f"{'HIGH TIDE' if is_high else 'EBB / TIDE'} ({height:.2f}m)"
        current_tide["phase_code"] = "high_surge" if locked else ("high" if is_high else "low")
        current_tide["floodgates_locked"] = locked
        current_tide["lock_status_text"] = "LOCKED - SPRING SURGE" if locked else "OPEN - GRAVITY DISCHARGE"
        current_tide["advisory"] = f"Tide level set to {height:.2f}m. Floodgates: {current_tide['lock_status_text']}."
        current_tide["gauge_pct"] = min(100, int((height / 5.5) * 100))

    current_tide["last_updated"] = now_iso
    return current_tide


def get_esp32_hardware_state() -> Dict[str, Any]:
    """Return full state of the ESP32 Hardware Digital Twin."""
    return esp32_hardware_state


# ── Update Hardware State from ESP32 POST /api/data ──────────────────────────
def ingest_esp32_telemetry(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ingest live telemetry from the physical ESP32 module:
      - Ultrasonic distance (cm)
      - Water level (cm) & percentage
      - Status (NORMAL, WARNING, HIGH, CRITICAL)
      - Rainfall reading (mm)
    Updates the bound drain and the hardware twin (LCD, LEDs, Buzzer).
    """
    device_id = str(payload.get("device_id", "AQUA-001"))
    distance = float(payload.get("distance", 35.0))
    water_level = float(payload.get("waterLevel", 115.0))
    percentage = int(payload.get("percentage", 75))
    status = str(payload.get("status", "HIGH")).upper()
    rainfall = float(payload.get("rainfall", 0.0) or 0.0)

    # 1. Update Hardware Twin State
    esp32_hardware_state["device_id"] = device_id
    esp32_hardware_state["is_online"] = True
    esp32_hardware_state["last_seen"] = datetime.now(timezone.utc).isoformat()
    esp32_hardware_state["distance_cm"] = round(distance, 1)
    esp32_hardware_state["water_level_cm"] = round(water_level, 1)
    esp32_hardware_state["percentage"] = percentage
    esp32_hardware_state["status"] = status
    if rainfall > 0:
        esp32_hardware_state["rainfall_mm"] = round(rainfall, 1)

    # 2. Update GPIO Status LEDs (Exact hardware match)
    # Green LED  (GPIO 27): < 50%
    # Yellow LED (GPIO 26): 50–69%
    # Red LED    (GPIO 25): >= 70%
    esp32_hardware_state["led_green"] = percentage < 50
    esp32_hardware_state["led_yellow"] = 50 <= percentage < 70
    esp32_hardware_state["led_red"] = percentage >= 70

    # 3. Update Buzzer State (Exact hardware match)
    if percentage >= 85:
        esp32_hardware_state["buzzer_active"] = True
        esp32_hardware_state["buzzer_mode"] = "CONTINUOUS"
        esp32_hardware_state["buzzer_note"] = "RAPID ALARM: Critical Water Level >= 85%"
    elif percentage >= 70:
        esp32_hardware_state["buzzer_active"] = True
        esp32_hardware_state["buzzer_mode"] = "PULSE"
        esp32_hardware_state["buzzer_note"] = "WARNING PULSE: High Water Level >= 70%"
    elif percentage >= 50:
        esp32_hardware_state["buzzer_active"] = True
        esp32_hardware_state["buzzer_mode"] = "SLOW_BEEP"
        esp32_hardware_state["buzzer_note"] = "CAUTION CHIME: Water Level Warning 50–69%"
    else:
        esp32_hardware_state["buzzer_active"] = False
        esp32_hardware_state["buzzer_mode"] = "SILENT"
        esp32_hardware_state["buzzer_note"] = "Buzzer Inactive (Normal Level < 50%)"

    # 4. Format 16x2 Character LCD Lines (Max 16 characters per line)
    # Line 1: Drain Name or ID (e.g. "HINDMATA DRAIN  ")
    # Line 2: Level % and Status (e.g. "LVL: 77%    HIGH")
    bound_id = esp32_hardware_state["bound_drain_id"]
    bound_drain = next((d for d in mumbai_drains if d["id"] == bound_id), None)
    drain_title = bound_drain["name"][:14].upper() if bound_drain else "AQUAALERT MUMBAI"
    line1 = f"{drain_title:<16}"[:16]

    status_str = f"{status[:8]}"
    line2 = f"LVL:{percentage:2d}% {status_str}"[:16]

    esp32_hardware_state["lcd_line_1"] = line1
    esp32_hardware_state["lcd_line_2"] = line2

    # 5. Update the Bound Mumbai Drain
    if bound_drain:
        bound_drain["water_level_cm"] = round(water_level, 1)
        bound_drain["percentage"] = percentage
        bound_drain["status"] = status
        if rainfall > 0:
            bound_drain["local_rainfall_mm_h"] = round(rainfall, 1)
        recalculate_drain_proximity(bound_drain)

    return esp32_hardware_state


def assign_hardware_node_to_drain(drain_id: str, device_id: str = "AQUA-001") -> Optional[Dict[str, Any]]:
    """
    Bind the physical ESP32 device node to a specific Mumbai drain.
    """
    target = None
    for drain in mumbai_drains:
        if drain["id"] == drain_id:
            drain["assigned_device_id"] = device_id
            drain["is_hardware_node"] = True
            target = drain
        elif drain.get("assigned_device_id") == device_id:
            drain["assigned_device_id"] = None
            drain["is_hardware_node"] = False

    if target:
        esp32_hardware_state["bound_drain_id"] = target["id"]
        esp32_hardware_state["bound_drain_name"] = target["name"]
        # Refresh LCD line 1
        drain_title = target["name"][:14].upper()
        esp32_hardware_state["lcd_line_1"] = f"{drain_title:<16}"[:16]

    return target


def set_monsoon_scenario(scenario_name: str, custom_rainfall: Optional[float] = None) -> Dict[str, Any]:
    """
    Set predefined monsoon weather scenarios:
      - 'normal': Light drizzle, low risk, low tide
      - 'heavy_rain': Heavy downpour over Dadar/Santacruz/Kurla
      - 'cloudburst_santacruz': 140 mm/hr cloudburst, Milan Subway & Mithi River critical
      - 'high_tide_surge': 4.85m spring tide with coastal sluice gate lock
    """
    scenario = scenario_name.lower()

    if scenario == "normal":
        for stn in weather_stations.values():
            stn["rainfall_mm_h"] = round(custom_rainfall or 12.0, 1)
            stn["condition"] = "Light Monsoon Showers"
        set_tide_simulation("low_tide", 1.20)

        # Reset drains to normal baseline
        for d in mumbai_drains:
            d["percentage"] = min(d["percentage"], 44)
            d["status"] = "NORMAL"
            d["water_level_cm"] = round(d["max_depth_cm"] * 0.40, 1)
            d["gate_status"] = "GRAVITY_DISCHARGE"

    elif scenario == "heavy_rain":
        weather_stations["AWS-SCZ"]["rainfall_mm_h"] = custom_rainfall or 85.0
        weather_stations["AWS-DAD"]["rainfall_mm_h"] = custom_rainfall or 92.0
        weather_stations["AWS-KURLA"]["rainfall_mm_h"] = custom_rainfall or 98.0
        weather_stations["AWS-ANDH"]["rainfall_mm_h"] = custom_rainfall or 78.0
        set_tide_simulation("high_tide_normal", 4.25)

        for d in mumbai_drains:
            if d["id"] in ("DRN-MUM-001", "DRN-MUM-002", "DRN-MUM-003", "DRN-MUM-004", "DRN-MUM-005"):
                d["percentage"] = min(95, max(d["percentage"], 82))
                d["status"] = "CRITICAL" if d["percentage"] >= 85 else "HIGH"
                d["water_level_cm"] = round(d["max_depth_cm"] * (d["percentage"] / 100), 1)

    elif scenario == "cloudburst_santacruz":
        weather_stations["AWS-SCZ"]["rainfall_mm_h"] = custom_rainfall or 145.0
        weather_stations["AWS-KURLA"]["rainfall_mm_h"] = custom_rainfall or 138.0
        weather_stations["AWS-ANDH"]["rainfall_mm_h"] = custom_rainfall or 115.0
        weather_stations["AWS-DAD"]["rainfall_mm_h"] = custom_rainfall or 105.0
        set_tide_simulation("high_tide_surge", 4.70)

        for d in mumbai_drains:
            if d["id"] in ("DRN-MUM-002", "DRN-MUM-003", "DRN-MUM-004", "DRN-MUM-005"):
                d["percentage"] = 96
                d["status"] = "CRITICAL"
                d["water_level_cm"] = round(d["max_depth_cm"] * 0.96, 1)
                d["gate_status"] = "OVERFLOW_EMERGENCY"

    elif scenario == "high_tide_surge":
        set_tide_simulation("high_tide_surge", 4.88)

        for d in mumbai_drains:
            if "Outfall" in d["name"] or d["id"] in ("DRN-MUM-001", "DRN-MUM-006", "DRN-MUM-008"):
                d["percentage"] = 88
                d["status"] = "CRITICAL"
                d["water_level_cm"] = round(d["max_depth_cm"] * 0.88, 1)
                d["gate_status"] = "TIDAL_BACKFLOW_LOCKED"

    # Re-sync hardware twin to bound drain
    bound_id = esp32_hardware_state["bound_drain_id"]
    bound = next((d for d in mumbai_drains if d["id"] == bound_id), None)
    if bound:
        ingest_esp32_telemetry({
            "device_id": esp32_hardware_state["device_id"],
            "distance": round(bound["max_depth_cm"] - bound["water_level_cm"], 1),
            "waterLevel": bound["water_level_cm"],
            "percentage": bound["percentage"],
            "status": bound["status"],
            "rainfall": bound.get("local_rainfall_mm_h", 80.0),
        })

    return {
        "scenario": scenario,
        "tide": current_tide,
        "stations": list(weather_stations.values()),
        "hardware": esp32_hardware_state,
    }
