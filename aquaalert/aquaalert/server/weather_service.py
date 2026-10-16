"""
weather_service.py - Real-Time Weather & Precipitation Telemetry Service
=======================================================================
Integrates live weather API (Open-Meteo) with resilient offline fallback
for flood monitoring and drainage correlation across Indian cities and local areas/wards.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("aquaalert.weather")

# ── Major Indian Metro Cities ────────────────────────────────────────────────
WEATHER_CITIES: Dict[str, Dict[str, Any]] = {
    "Mumbai": {
        "id": "city_mumbai",
        "name": "Mumbai",
        "state": "Maharashtra",
        "lat": 19.0760,
        "lon": 72.8777,
        "elevation_m": 14,
        "basin": "Mithi River & Arabian Sea Coast",
    },
    "Pune": {
        "id": "city_pune",
        "name": "Pune",
        "state": "Maharashtra",
        "lat": 18.5204,
        "lon": 73.8567,
        "elevation_m": 560,
        "basin": "Mula-Mutha River Basin",
    },
    "New Delhi": {
        "id": "city_new_delhi",
        "name": "New Delhi",
        "state": "Delhi NCR",
        "lat": 28.6139,
        "lon": 77.2090,
        "elevation_m": 216,
        "basin": "Yamuna River Floodplain",
    },
    "Bengaluru": {
        "id": "city_bengaluru",
        "name": "Bengaluru",
        "state": "Karnataka",
        "lat": 12.9716,
        "lon": 77.5946,
        "elevation_m": 920,
        "basin": "Koramangala-Challaghatta Valley",
    },
    "Chennai": {
        "id": "city_chennai",
        "name": "Chennai",
        "state": "Tamil Nadu",
        "lat": 13.0827,
        "lon": 80.2707,
        "elevation_m": 7,
        "basin": "Adyar & Cooum River Estuary",
    },
    "Kolkata": {
        "id": "city_kolkata",
        "name": "Kolkata",
        "state": "West Bengal",
        "lat": 22.5726,
        "lon": 88.3639,
        "elevation_m": 9,
        "basin": "Hooghly River & Ganges Delta",
    },
    "Hyderabad": {
        "id": "city_hyderabad",
        "name": "Hyderabad",
        "state": "Telangana",
        "lat": 17.3850,
        "lon": 78.4867,
        "elevation_m": 542,
        "basin": "Musi River Catchment",
    },
    "Ahmedabad": {
        "id": "city_ahmedabad",
        "name": "Ahmedabad",
        "state": "Gujarat",
        "lat": 23.0225,
        "lon": 72.5714,
        "elevation_m": 53,
        "basin": "Sabarmati River Basin",
    },
}

# ── Local Areas, Wards & Micro-Drainage Catchments ────────────────────────────
WEATHER_AREAS: Dict[str, Dict[str, Any]] = {
    # ── Mumbai Local Areas & Wards ────────────────────────────────────────────
    "mumbai_dadar": {
        "id": "mumbai_dadar",
        "name": "Dadar (Hindmata / TT Circle)",
        "city": "Mumbai",
        "zone": "F-North Ward (Central Mumbai)",
        "state": "Maharashtra",
        "lat": 19.0178,
        "lon": 72.8478,
        "elevation_m": 8,
        "basin": "Pramod Mahajan Sump & Britannia Outfall",
        "flood_risk_level": "CRITICAL",
    },
    "mumbai_kurla": {
        "id": "mumbai_kurla",
        "name": "Kurla (Kamani / LBS Marg)",
        "city": "Mumbai",
        "zone": "L-Ward (Central Suburbs)",
        "state": "Maharashtra",
        "lat": 19.0726,
        "lon": 72.8845,
        "elevation_m": 10,
        "basin": "Mithi River Low-Lying Floodplain",
        "flood_risk_level": "CRITICAL",
    },
    "mumbai_andheri": {
        "id": "mumbai_andheri",
        "name": "Andheri (Subway / SV Road)",
        "city": "Mumbai",
        "zone": "K-West Ward (Western Suburbs)",
        "state": "Maharashtra",
        "lat": 19.1197,
        "lon": 72.8464,
        "elevation_m": 12,
        "basin": "Mogra Nalla Stormwater Canal",
        "flood_risk_level": "CRITICAL",
    },
    "mumbai_bandra": {
        "id": "mumbai_bandra",
        "name": "Bandra (Milan Subway / SV Road)",
        "city": "Mumbai",
        "zone": "H-West Ward",
        "state": "Maharashtra",
        "lat": 19.0596,
        "lon": 72.8295,
        "elevation_m": 9,
        "basin": "Gazdarband Outfall & Sea Sluice",
        "flood_risk_level": "HIGH",
    },
    "mumbai_santacruz": {
        "id": "mumbai_santacruz",
        "name": "Santacruz (Airport AWS / Vakola)",
        "city": "Mumbai",
        "zone": "H-East Ward (IMD AWS Station)",
        "state": "Maharashtra",
        "lat": 19.0886,
        "lon": 72.8679,
        "elevation_m": 11,
        "basin": "Vakola Nalla & Mithi Confluence",
        "flood_risk_level": "HIGH",
    },
    "mumbai_colaba": {
        "id": "mumbai_colaba",
        "name": "Colaba (Cuffe Parade & Fort)",
        "city": "Mumbai",
        "zone": "A-Ward (South Mumbai Coastal)",
        "state": "Maharashtra",
        "lat": 18.9067,
        "lon": 72.8147,
        "elevation_m": 6,
        "basin": "Arabian Sea Tidal Shoreline",
        "flood_risk_level": "WARNING",
    },
    "mumbai_chembur": {
        "id": "mumbai_chembur",
        "name": "Chembur (Postal Colony / Shell)",
        "city": "Mumbai",
        "zone": "M-West Ward (Eastern Suburbs)",
        "state": "Maharashtra",
        "lat": 19.0622,
        "lon": 72.9023,
        "elevation_m": 14,
        "basin": "Mahul Creek & Trombay Channel",
        "flood_risk_level": "WARNING",
    },
    "mumbai_sion": {
        "id": "mumbai_sion",
        "name": "Sion (King's Circle / Gandhi Market)",
        "city": "Mumbai",
        "zone": "F-North Ward",
        "state": "Maharashtra",
        "lat": 19.0390,
        "lon": 72.8619,
        "elevation_m": 8,
        "basin": "Sion Railway Low-Point Catchment",
        "flood_risk_level": "CRITICAL",
    },
    "mumbai_powai": {
        "id": "mumbai_powai",
        "name": "Powai (Lake Basin / Hiranandani)",
        "city": "Mumbai",
        "zone": "S-Ward (Eastern Suburbs)",
        "state": "Maharashtra",
        "lat": 19.1176,
        "lon": 72.9060,
        "elevation_m": 35,
        "basin": "Powai Lake Sump & Hills Runoff",
        "flood_risk_level": "WARNING",
    },
    "mumbai_borivali": {
        "id": "mumbai_borivali",
        "name": "Borivali (Link Road / Dahisar)",
        "city": "Mumbai",
        "zone": "R-Central Ward",
        "state": "Maharashtra",
        "lat": 19.2307,
        "lon": 72.8567,
        "elevation_m": 16,
        "basin": "Dahisar River Storm Sluice",
        "flood_risk_level": "HIGH",
    },
    "mumbai_thane": {
        "id": "mumbai_thane",
        "name": "Thane (Majiwada / Ghodbunder)",
        "city": "Thane (Mumbai MMR)",
        "zone": "Thane Municipal Corporation",
        "state": "Maharashtra",
        "lat": 19.2183,
        "lon": 72.9781,
        "elevation_m": 18,
        "basin": "Ulhas River Estuary & Thane Creek",
        "flood_risk_level": "HIGH",
    },
    "mumbai_navi_mumbai": {
        "id": "mumbai_navi_mumbai",
        "name": "Navi Mumbai (Vashi / Nerul)",
        "city": "Navi Mumbai (MMR)",
        "zone": "NMMC Holding Pond Zone",
        "state": "Maharashtra",
        "lat": 19.0330,
        "lon": 73.0297,
        "elevation_m": 7,
        "basin": "Thane Creek Flap-Gate Drainage",
        "flood_risk_level": "WARNING",
    },

    # ── Pune Local Areas ──────────────────────────────────────────────────────
    "pune_hinjewadi": {
        "id": "pune_hinjewadi",
        "name": "Hinjewadi (IT Park Phase 1-3)",
        "city": "Pune",
        "zone": "Pimpri-Chinchwad Tech Corridor",
        "state": "Maharashtra",
        "lat": 18.5913,
        "lon": 73.7389,
        "elevation_m": 565,
        "basin": "Mula River Upper Catchment",
        "flood_risk_level": "HIGH",
    },
    "pune_shivajinagar": {
        "id": "pune_shivajinagar",
        "name": "Shivaji Nagar (Mutha Riverbed / COEP)",
        "city": "Pune",
        "zone": "Central Pune",
        "state": "Maharashtra",
        "lat": 18.5314,
        "lon": 73.8446,
        "elevation_m": 550,
        "basin": "Mutha River Floodway & Bund Garden",
        "flood_risk_level": "CRITICAL",
    },
    "pune_kothrud": {
        "id": "pune_kothrud",
        "name": "Kothrud (Karve Road / Paud Rd)",
        "city": "Pune",
        "zone": "West Pune",
        "state": "Maharashtra",
        "lat": 18.5074,
        "lon": 73.8077,
        "elevation_m": 570,
        "basin": "Ramnadi Canal Storm Channel",
        "flood_risk_level": "WARNING",
    },
    "pune_vimannagar": {
        "id": "pune_vimannagar",
        "name": "Viman Nagar (Airport Corridor)",
        "city": "Pune",
        "zone": "East Pune",
        "state": "Maharashtra",
        "lat": 18.5679,
        "lon": 73.9143,
        "elevation_m": 575,
        "basin": "Mula-Mutha Confluence Runoff",
        "flood_risk_level": "NORMAL",
    },

    # ── Delhi NCR Local Areas ─────────────────────────────────────────────────
    "delhi_ito": {
        "id": "delhi_ito",
        "name": "ITO & Vikas Marg (Ring Road)",
        "city": "New Delhi",
        "zone": "Central Delhi Floodplain",
        "state": "Delhi NCR",
        "lat": 28.6289,
        "lon": 77.2415,
        "elevation_m": 210,
        "basin": "Drain No. 12 & Yamuna Inundation",
        "flood_risk_level": "CRITICAL",
    },
    "delhi_kashmeregate": {
        "id": "delhi_kashmeregate",
        "name": "Kashmere Gate & Yamuna Bazar",
        "city": "New Delhi",
        "zone": "North Delhi",
        "state": "Delhi NCR",
        "lat": 28.6667,
        "lon": 77.2333,
        "elevation_m": 212,
        "basin": "Yamuna River Bank Overflow",
        "flood_risk_level": "CRITICAL",
    },
    "delhi_mintobridge": {
        "id": "delhi_mintobridge",
        "name": "Minto Bridge Underpass (CP)",
        "city": "New Delhi",
        "zone": "Connaught Place Vicinity",
        "state": "Delhi NCR",
        "lat": 28.6347,
        "lon": 77.2241,
        "elevation_m": 211,
        "basin": "Deep Railway Depression Catchment",
        "flood_risk_level": "CRITICAL",
    },
    "delhi_gurugram": {
        "id": "delhi_gurugram",
        "name": "Gurugram (Cyber Hub / Hero Honda)",
        "city": "Gurugram",
        "zone": "South NCR",
        "state": "Haryana",
        "lat": 28.4595,
        "lon": 77.0266,
        "elevation_m": 222,
        "basin": "Badshahpur Trunk Drain",
        "flood_risk_level": "CRITICAL",
    },

    # ── Bengaluru Local Areas ─────────────────────────────────────────────────
    "blr_silkboard": {
        "id": "blr_silkboard",
        "name": "Silk Board & HSR Layout",
        "city": "Bengaluru",
        "zone": "South Bengaluru",
        "state": "Karnataka",
        "lat": 12.9176,
        "lon": 77.6238,
        "elevation_m": 905,
        "basin": "Madiwala Lake Overflow Canal",
        "flood_risk_level": "CRITICAL",
    },
    "blr_bellandur": {
        "id": "blr_bellandur",
        "name": "Bellandur & EcoSpace (ORR)",
        "city": "Bengaluru",
        "zone": "East Tech Corridor",
        "state": "Karnataka",
        "lat": 12.9360,
        "lon": 77.6780,
        "elevation_m": 890,
        "basin": "Bellandur-Varthur Chain Lake Basin",
        "flood_risk_level": "CRITICAL",
    },
    "blr_whitefield": {
        "id": "blr_whitefield",
        "name": "Whitefield (ITPL & Hopefarm)",
        "city": "Bengaluru",
        "zone": "East Bengaluru",
        "state": "Karnataka",
        "lat": 12.9698,
        "lon": 77.7500,
        "elevation_m": 915,
        "basin": "Kadugodi Valley Canal",
        "flood_risk_level": "HIGH",
    },

    # ── Chennai Local Areas ───────────────────────────────────────────────────
    "chn_velachery": {
        "id": "chn_velachery",
        "name": "Velachery & Madipakkam",
        "city": "Chennai",
        "zone": "South Chennai",
        "state": "Tamil Nadu",
        "lat": 12.9759,
        "lon": 80.2212,
        "elevation_m": 5,
        "basin": "Pallikaranai Marshland Catchment",
        "flood_risk_level": "CRITICAL",
    },
    "chn_tnagar": {
        "id": "chn_tnagar",
        "name": "T Nagar (Usman Road / Bazullah Rd)",
        "city": "Chennai",
        "zone": "Central Chennai",
        "state": "Tamil Nadu",
        "lat": 13.0418,
        "lon": 80.2341,
        "elevation_m": 8,
        "basin": "Mambalam Canal Runoff",
        "flood_risk_level": "HIGH",
    },
}

# ── WMO Weather Code Interpretations ──────────────────────────────────────────
WMO_CODES: Dict[int, Dict[str, str]] = {
    0: {"condition": "Clear Sky", "icon": "☀️", "rain_rate": 0.0},
    1: {"condition": "Mainly Clear", "icon": "🌤️", "rain_rate": 0.0},
    2: {"condition": "Partly Cloudy", "icon": "⛅", "rain_rate": 0.0},
    3: {"condition": "Overcast", "icon": "☁️", "rain_rate": 0.0},
    45: {"condition": "Fog", "icon": "🌫️", "rain_rate": 0.0},
    48: {"condition": "Depositing Rime Fog", "icon": "🌫️", "rain_rate": 0.0},
    51: {"condition": "Light Drizzle", "icon": "🌦️", "rain_rate": 1.2},
    53: {"condition": "Moderate Drizzle", "icon": "🌦️", "rain_rate": 2.5},
    55: {"condition": "Dense Drizzle", "icon": "🌧️", "rain_rate": 4.0},
    61: {"condition": "Slight Rain", "icon": "🌧️", "rain_rate": 5.0},
    63: {"condition": "Moderate Rain", "icon": "🌧️", "rain_rate": 15.0},
    65: {"condition": "Heavy Rain", "icon": "⛈️", "rain_rate": 45.0},
    80: {"condition": "Slight Rain Showers", "icon": "🌧️", "rain_rate": 10.0},
    81: {"condition": "Moderate Rain Showers", "icon": "🌧️", "rain_rate": 25.0},
    82: {"condition": "Violent Rain Showers", "icon": "🌊", "rain_rate": 65.0},
    95: {"condition": "Thunderstorm", "icon": "⚡", "rain_rate": 35.0},
    96: {"condition": "Thunderstorm with Slight Hail", "icon": "⛈️", "rain_rate": 55.0},
    99: {"condition": "Thunderstorm with Heavy Hail", "icon": "⛈️", "rain_rate": 80.0},
}

# In-memory weather cache (TTL: 5 minutes)
_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300


def get_available_cities() -> List[Dict[str, Any]]:
    """Return all pre-configured cities with their geographic details."""
    return [
        {
            "id": v.get("id", k.lower()),
            "name": v["name"],
            "state": v["state"],
            "lat": v["lat"],
            "lon": v["lon"],
            "elevation_m": v["elevation_m"],
            "basin": v["basin"],
        }
        for k, v in WEATHER_CITIES.items()
    ]


def get_available_areas() -> List[Dict[str, Any]]:
    """Return all pre-configured local micro-areas and wards."""
    return [
        {
            "id": k,
            "name": v["name"],
            "city": v["city"],
            "zone": v["zone"],
            "state": v["state"],
            "lat": v["lat"],
            "lon": v["lon"],
            "elevation_m": v["elevation_m"],
            "basin": v["basin"],
            "flood_risk_level": v.get("flood_risk_level", "NORMAL"),
        }
        for k, v in WEATHER_AREAS.items()
    ]


def _interpret_wmo(code: int) -> Dict[str, Any]:
    """Resolve WMO weather code into readable condition and emoji icon."""
    return WMO_CODES.get(
        code,
        {"condition": "Cloudy / Showers", "icon": "🌧️", "rain_rate": 5.0}
    )


def _get_cache_key(lat: float, lon: float) -> str:
    return f"{round(lat, 3)}_{round(lon, 3)}"


def fetch_live_open_meteo(lat: float, lon: float, timeout_sec: float = 3.0) -> Optional[Dict[str, Any]]:
    """
    Attempt to fetch real-time weather from Open-Meteo REST API.
    Returns parsed dictionary or None if network is offline or request times out.
    """
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&"
        f"current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,surface_pressure&"
        f"hourly=temperature_2m,precipitation_probability,precipitation&"
        f"daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&"
        f"timezone=auto"
    )

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "AquaAlert-FloodMonitoring/1.0 (IoT Smart Drainage)"},
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        logger.debug("Open-Meteo live API request failed (%s): %s", url, exc)
    return None


def generate_local_weather_model(location_name: str, lat: float, lon: float) -> Dict[str, Any]:
    """
    Intelligent meteorological fallback when internet connectivity is absent.
    Generates realistic, physically plausible telemetry based on location,
    current month, hour of day, and topography.
    """
    now = datetime.now()
    month = now.month
    hour = now.hour

    is_monsoon = month in (6, 7, 8, 9)
    is_post_monsoon = month in (10, 11)

    if lat > 25.0:  # North India
        base_temp = 31.0 if (5 <= month <= 9) else (22.0 if month in (3, 4, 10) else 15.0)
    else:  # Peninsular India
        base_temp = 29.0 if is_monsoon else 31.5

    diurnal_offset = 4.0 * math.sin((hour - 9) * math.pi / 12)
    temp = round(base_temp + diurnal_offset, 1)
    feels_like = round(temp + (3.5 if is_monsoon else 1.5), 1)

    if is_monsoon:
        humidity = int(75 + 18 * math.sin((hour + 3) * math.pi / 12))
        humidity = max(60, min(98, humidity))
        rain_rate = round(max(0.0, 18.5 * math.sin((hour * 0.6) + lat)), 1)
        weather_code = 65 if rain_rate > 35 else (63 if rain_rate > 10 else (61 if rain_rate > 0 else 3))
    elif is_post_monsoon:
        humidity = int(60 + 12 * math.sin(hour * math.pi / 12))
        rain_rate = round(max(0.0, 4.0 * math.sin((hour * 0.4) + lon)), 1)
        weather_code = 61 if rain_rate > 0 else (2 if hour % 2 == 0 else 1)
    else:
        humidity = int(45 + 15 * math.sin(hour * math.pi / 12))
        rain_rate = 0.0
        weather_code = 0 if hour in range(6, 19) else 1

    wind_speed = round(12.0 + 6.0 * math.sin(hour * 0.5), 1)
    pressure = round(1008.0 - (2.5 if is_monsoon else 0.0) + math.cos(hour * 0.3), 1)

    hourly_hours = []
    hourly_rain = []
    hourly_temp = []
    for h in range(12):
        f_hour = (hour + h) % 24
        f_temp = round(base_temp + 4.0 * math.sin((f_hour - 9) * math.pi / 12), 1)
        f_rain = round(max(0.0, rain_rate * (0.6 + 0.5 * math.cos(h * 0.7))), 1) if is_monsoon else 0.0
        hourly_hours.append(f"{f_hour:02d}:00")
        hourly_temp.append(f_temp)
        hourly_rain.append(f_rain)

    days = ["Today", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    daily_forecast = []
    for i, day in enumerate(days):
        daily_forecast.append({
            "day": day,
            "max_temp": round(base_temp + 3.0, 1),
            "min_temp": round(base_temp - 4.0, 1),
            "rain_sum": round(rain_rate * (3.5 - i * 0.3) if is_monsoon else 0.0, 1),
            "condition": "Monsoon Showers" if is_monsoon else "Partly Cloudy",
            "icon": "🌧️" if is_monsoon else "⛅",
        })

    info = _interpret_wmo(weather_code)

    return {
        "city": location_name,
        "latitude": lat,
        "longitude": lon,
        "temperature": temp,
        "feels_like": feels_like,
        "humidity": humidity,
        "precipitation_rate_mm_h": rain_rate,
        "weather_code": weather_code,
        "condition": info["condition"],
        "icon": info["icon"],
        "wind_speed_kmh": wind_speed,
        "surface_pressure_hpa": pressure,
        "source": "local_weather_model",
        "is_live_api": False,
        "hourly_hours": hourly_hours,
        "hourly_rain": hourly_rain,
        "hourly_temp": hourly_temp,
        "daily_forecast": daily_forecast,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def resolve_location(
    query: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Resolve an area name, city name, or GPS coordinates to a recognized location.
    Prioritizes:
      1. Specific local area matches (e.g. Dadar, Kurla, Hinjewadi)
      2. Major Indian cities (e.g. Mumbai, Pune)
      3. GPS coordinate resolution using nearest area or city
    """
    # 1. Coordinate lookup if provided
    if lat is not None and lon is not None:
        best_area = None
        min_dist = float("inf")
        for area_id, area_data in WEATHER_AREAS.items():
            d = math.hypot(area_data["lat"] - lat, area_data["lon"] - lon)
            if d < min_dist:
                min_dist = d
                best_area = area_data

        # If within ~15 km (approx 0.14 degrees) of a known micro-area
        if best_area and min_dist <= 0.14:
            return {
                "name": best_area["name"],
                "area": best_area["name"],
                "city": best_area["city"],
                "zone": best_area["zone"],
                "state": best_area["state"],
                "basin": best_area["basin"],
                "lat": lat,
                "lon": lon,
            }

        # Otherwise resolve via geo_resolver
        from geo_resolver import resolve_nearest_city
        resolved_name = resolve_nearest_city(lat, lon)
        return {
            "name": resolved_name,
            "area": resolved_name,
            "city": resolved_name.split(",")[0].strip(),
            "zone": "GPS Detected Area",
            "state": "India",
            "basin": "Local Catchment",
            "lat": lat,
            "lon": lon,
        }

    q = (query or "Mumbai").strip()
    q_lower = q.lower()

    # 2. Check Area Catalog (exact ID or substring in name / zone)
    if q_lower in WEATHER_AREAS:
        a = WEATHER_AREAS[q_lower]
        return {
            "name": a["name"],
            "area": a["name"],
            "city": a["city"],
            "zone": a["zone"],
            "state": a["state"],
            "basin": a["basin"],
            "lat": a["lat"],
            "lon": a["lon"],
        }

    for a_id, a in WEATHER_AREAS.items():
        if q_lower in a["name"].lower() or q_lower in a["zone"].lower() or a_id == q_lower:
            return {
                "name": a["name"],
                "area": a["name"],
                "city": a["city"],
                "zone": a["zone"],
                "state": a["state"],
                "basin": a["basin"],
                "lat": a["lat"],
                "lon": a["lon"],
            }

    # 3. Check City Catalog
    for c_name, c in WEATHER_CITIES.items():
        if q_lower in c_name.lower() or c["id"] == q_lower:
            return {
                "name": c["name"],
                "area": c["name"],
                "city": c["name"],
                "zone": f"Greater {c['name']} Metropolitan Area",
                "state": c["state"],
                "basin": c["basin"],
                "lat": c["lat"],
                "lon": c["lon"],
            }

    # 4. Fallback default Mumbai
    fallback = WEATHER_CITIES["Mumbai"]
    return {
        "name": q if q else fallback["name"],
        "area": q if q else fallback["name"],
        "city": fallback["name"],
        "zone": "Urban Catchment",
        "state": fallback["state"],
        "basin": fallback["basin"],
        "lat": fallback["lat"],
        "lon": fallback["lon"],
    }


def get_weather(
    city: str = "Mumbai",
    area: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """
    Get current weather and precipitation telemetry for an area, city, or coordinates.
    1. Resolves location to specific area / city.
    2. Checks memory cache.
    3. Tries live Open-Meteo REST API.
    4. Falls back smoothly to local meteorological model if offline.
    """
    target_query = area or city or "Mumbai"
    loc = resolve_location(query=target_query, lat=lat, lon=lon)

    target_name = loc["name"]
    target_area = loc.get("area", target_name)
    target_city = loc.get("city", "Mumbai")
    target_zone = loc.get("zone", "Metropolitan Area")
    target_state = loc.get("state", "Maharashtra")
    target_basin = loc.get("basin", "Local Drainage Catchment")
    target_lat = loc["lat"]
    target_lon = loc["lon"]

    cache_key = _get_cache_key(target_lat, target_lon)
    now_ts = time.time()

    if not force_refresh and cache_key in _CACHE:
        cached_entry = _CACHE[cache_key]
        if now_ts - cached_entry["cached_at"] < CACHE_TTL_SECONDS:
            res = dict(cached_entry["data"])
            res["area"] = target_area
            res["zone"] = target_zone
            return res

    # 1. Try Live Open-Meteo
    live_raw = fetch_live_open_meteo(target_lat, target_lon, timeout_sec=2.5)

    if live_raw and "current" in live_raw:
        curr = live_raw["current"]
        code = int(curr.get("weather_code", 0))
        info = _interpret_wmo(code)

        hourly_raw = live_raw.get("hourly", {})
        hourly_times = hourly_raw.get("time", [])[:12]
        hourly_hours = [t.split("T")[-1] for t in hourly_times] if hourly_times else []
        hourly_rain = hourly_raw.get("precipitation", [])[:12]
        hourly_temp = hourly_raw.get("temperature_2m", [])[:12]

        daily_raw = live_raw.get("daily", {})
        daily_times = daily_raw.get("time", [])[:7]
        daily_codes = daily_raw.get("weather_code", [])[:7]
        daily_max = daily_raw.get("temperature_2m_max", [])[:7]
        daily_min = daily_raw.get("temperature_2m_min", [])[:7]
        daily_rain_sum = daily_raw.get("precipitation_sum", [])[:7]

        daily_list = []
        for i, dt in enumerate(daily_times):
            c_code = daily_codes[i] if i < len(daily_codes) else 0
            c_info = _interpret_wmo(c_code)
            try:
                day_name = datetime.strptime(dt, "%Y-%m-%d").strftime("%a")
            except Exception:
                day_name = f"Day {i+1}"
            daily_list.append({
                "date": dt,
                "day": "Today" if i == 0 else day_name,
                "max_temp": daily_max[i] if i < len(daily_max) else 30.0,
                "min_temp": daily_min[i] if i < len(daily_min) else 24.0,
                "rain_sum": daily_rain_sum[i] if i < len(daily_rain_sum) else 0.0,
                "condition": c_info["condition"],
                "icon": c_info["icon"],
            })

        rain_rate = float(curr.get("precipitation", 0.0) or curr.get("rain", 0.0) or 0.0)

        weather_result = {
            "city": target_city,
            "area": target_area,
            "zone": target_zone,
            "state": target_state,
            "basin": target_basin,
            "latitude": target_lat,
            "longitude": target_lon,
            "temperature": float(curr.get("temperature_2m", 28.0)),
            "feels_like": float(curr.get("apparent_temperature", 30.0)),
            "humidity": int(curr.get("relative_humidity_2m", 70)),
            "precipitation_rate_mm_h": rain_rate,
            "weather_code": code,
            "condition": info["condition"],
            "icon": info["icon"],
            "wind_speed_kmh": float(curr.get("wind_speed_10m", 12.0)),
            "surface_pressure_hpa": float(curr.get("surface_pressure", 1010.0)),
            "source": "live_open_meteo",
            "is_live_api": True,
            "hourly_hours": hourly_hours,
            "hourly_rain": hourly_rain,
            "hourly_temp": hourly_temp,
            "daily_forecast": daily_list,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    else:
        # Fallback to local meteorological engine
        weather_result = generate_local_weather_model(target_area, target_lat, target_lon)
        weather_result["city"] = target_city
        weather_result["area"] = target_area
        weather_result["zone"] = target_zone
        weather_result["state"] = target_state
        weather_result["basin"] = target_basin

    # Compute integrated flood risk
    weather_result["flood_impact"] = assess_rainfall_impact(
        weather_result["precipitation_rate_mm_h"]
    )

    _CACHE[cache_key] = {
        "cached_at": now_ts,
        "data": weather_result,
    }

    return weather_result


def assess_rainfall_impact(rain_mm_h: float) -> Dict[str, Any]:
    """
    Translate precipitation intensity into Indian drainage risk classifications
    (aligned with IMD standard rainfall categories).
    """
    if rain_mm_h >= 124.5:
        return {
            "category": "Cloudburst / Extremely Heavy",
            "risk_level": "CRITICAL",
            "color": "#ef4444",
            "drain_impact": "Severe surcharge & immediate flash waterlogging imminent",
            "warning": "🚨 RED ALERT: Activate stormwater emergency sump pumps",
        }
    elif rain_mm_h >= 64.5:
        return {
            "category": "Very Heavy Rainfall",
            "risk_level": "HIGH",
            "color": "#f97316",
            "drain_impact": "Catchment capacity nearing 90%; surface ponding likely",
            "warning": "🔶 ORANGE ALERT: High drainage backflow risk",
        }
    elif rain_mm_h >= 35.5:
        return {
            "category": "Heavy Rainfall",
            "risk_level": "WARNING",
            "color": "#f59e0b",
            "drain_impact": "Moderate runoff velocity; low-lying culverts inundated",
            "warning": "🟡 YELLOW WATCH: Keep arterial drains monitored",
        }
    elif rain_mm_h >= 7.5:
        return {
            "category": "Moderate Rainfall",
            "risk_level": "NORMAL",
            "color": "#10b981",
            "drain_impact": "Standard drainage clearance nominal",
            "warning": "🟢 GREEN: Stable stormwater discharge",
        }
    elif rain_mm_h > 0:
        return {
            "category": "Light Rain / Drizzle",
            "risk_level": "NORMAL",
            "color": "#38bdf8",
            "drain_impact": "Negligible drainage load",
            "warning": "🟢 Clear: No flood threat",
        }
    else:
        return {
            "category": "Dry / No Precipitation",
            "risk_level": "NORMAL",
            "color": "#94a3b8",
            "drain_impact": "Zero runoff pressure",
            "warning": "🟢 Fair Weather: All flood barriers normal",
        }
