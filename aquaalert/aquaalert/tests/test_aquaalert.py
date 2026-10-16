import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

import database
from app import app, calculate_status
from validation import validate_sensor_payload


class AquaAlertThresholdsTest(unittest.TestCase):
    def setUp(self):
        database.init_db()
        app.config["API_KEY"] = "test-api-key"
        self.client = app.test_client()

    def test_thresholds_match_spec(self):
        cases = [
            (0, "NORMAL"),
            (25, "NORMAL"),
            (48, "NORMAL"),
            (49, "NORMAL"),
            (50, "WARNING"),
            (69, "WARNING"),
            (70, "HIGH"),
            (84, "HIGH"),
            (85, "CRITICAL"),
            (100, "CRITICAL"),
        ]
        for percentage, expected in cases:
            with self.subTest(percentage=percentage):
                self.assertEqual(calculate_status(percentage), expected)

    def test_validation_accepts_requested_statuses(self):
        payload = {
            "device_id": "AQUA-001",
            "distance": 28.5,
            "waterLevel": 71.5,
            "percentage": 72,
            "status": "HIGH",
        }
        normalized, errors = validate_sensor_payload(payload)
        self.assertFalse(errors)
        self.assertEqual(normalized["status"], "HIGH")

        warning_payload = {
            "device_id": "AQUA-001",
            "distance": 50.0,
            "waterLevel": 50.0,
            "percentage": 50,
            "status": "WARNING",
        }
        normalized_warning, errors_warning = validate_sensor_payload(warning_payload)
        self.assertFalse(errors_warning)
        self.assertEqual(normalized_warning["status"], "WARNING")

    def test_post_api_accepts_warning_and_rejects_missing_key(self):
        resp = self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 50.0,
                "waterLevel": 50.0,
                "percentage": 50,
                "status": "WARNING",
            },
            headers={"X-API-Key": "test-api-key"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "WARNING")

        reject = self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 50.0,
                "waterLevel": 50.0,
                "percentage": 50,
                "status": "WARNING",
            },
        )
        self.assertEqual(reject.status_code, 401)

    def test_lowercase_status_is_rejected(self):
        resp = self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 10.0,
                "waterLevel": 10.0,
                "percentage": 10,
                "status": "warning",
            },
            headers={"X-API-Key": "test-api-key"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("status must be one of", resp.get_json()["error"])

    def test_history_and_latest_return_values(self):
        self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 28.0,
                "waterLevel": 72.0,
                "percentage": 72,
                "status": "HIGH",
            },
            headers={"X-API-Key": "test-api-key"},
        )

        latest = self.client.get("/api/latest")
        self.assertEqual(latest.status_code, 200)
        self.assertEqual(latest.get_json()["status"], "HIGH")

        history = self.client.get("/api/history?limit=5")
        self.assertEqual(history.status_code, 200)
        self.assertGreaterEqual(len(history.get_json()), 1)

    def test_map_points_api_returns_geo_sample(self):
        resp = self.client.get("/api/map/points?limit=10")
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertIn("points", payload)
        self.assertLessEqual(len(payload["points"]), 10)
        if payload["points"]:
            point = payload["points"][0]
            self.assertIn("Latitude", point)
            self.assertIn("Longitude", point)
            self.assertIn("Flood Occurred", point)
            self.assertIn("City", point)
            self.assertTrue(bool(point["City"]))

    def test_sensor_analytics_and_history_order(self):
        # Insert a sample reading
        self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 45.0,
                "waterLevel": 55.0,
                "percentage": 55,
                "status": "WARNING",
            },
            headers={"X-API-Key": "test-api-key"},
        )

        # Test history with order=asc
        resp_asc = self.client.get("/api/history?limit=10&order=asc")
        self.assertEqual(resp_asc.status_code, 200)
        items = resp_asc.get_json()
        self.assertIsInstance(items, list)
        self.assertGreaterEqual(len(items), 1)

        # Test sensor analytics
        resp_analytics = self.client.get("/api/sensor/analytics?limit=10")
        self.assertEqual(resp_analytics.status_code, 200)
        analytics_data = resp_analytics.get_json()
        self.assertIn("total_readings", analytics_data)
        self.assertIn("min_water_level", analytics_data)
        self.assertIn("max_water_level", analytics_data)
        self.assertIn("avg_water_level", analytics_data)
        self.assertIn("status_breakdown", analytics_data)
        self.assertIn("trend", analytics_data)
        self.assertGreaterEqual(analytics_data["total_readings"], 1)

    def test_rain_endpoints_and_rainfall_ingestion(self):
        # 1. Test GET /api/rain/latest
        resp_latest = self.client.get("/api/rain/latest")
        self.assertEqual(resp_latest.status_code, 200)
        data = resp_latest.get_json()
        self.assertIn("last_rain_date", data)
        self.assertIn("last_rain_time", data)
        self.assertIn("last_rain_datetime", data)
        self.assertIn("current_observation_date", data)
        self.assertIn("current_observation_time", data)

        # 2. Test GET /api/rain/events
        resp_events = self.client.get("/api/rain/events?limit=5")
        self.assertEqual(resp_events.status_code, 200)
        events_data = resp_events.get_json()
        self.assertIn("historical_events", events_data)
        self.assertIsInstance(events_data["historical_events"], list)
        if events_data["historical_events"]:
            first_event = events_data["historical_events"][0]
            self.assertIn("date", first_event)
            self.assertIn("time_12h", first_event)
            self.assertIn("rainfall_mm", first_event)

        # 3. Test Ingesting reading with rainfall
        resp_post = self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 30.0,
                "waterLevel": 70.0,
                "percentage": 70,
                "status": "HIGH",
                "rainfall": 45.2,
            },
            headers={"X-API-Key": "test-api-key"},
        )
        self.assertEqual(resp_post.status_code, 200)

        # Verify rain latest reflects rainfall
        resp_after = self.client.get("/api/rain/latest")
        self.assertEqual(resp_after.status_code, 200)
        after_data = resp_after.get_json()
        self.assertGreaterEqual(after_data["rainfall_mm"], 45.2)

    def test_weather_endpoints(self):
        # 1. Test GET /api/weather for default city (Mumbai)
        resp_weather = self.client.get("/api/weather?city=Mumbai")
        self.assertEqual(resp_weather.status_code, 200)
        data = resp_weather.get_json()
        self.assertTrue(data.get("success"))
        self.assertIn("weather", data)
        w = data["weather"]
        self.assertEqual(w["city"], "Mumbai")
        self.assertIn("temperature", w)
        self.assertIn("humidity", w)
        self.assertIn("precipitation_rate_mm_h", w)
        self.assertIn("condition", w)
        self.assertIn("flood_impact", w)
        self.assertIn("hourly_hours", w)
        self.assertIn("hourly_rain", w)

        # 2. Test GET /api/weather/cities
        resp_cities = self.client.get("/api/weather/cities")
        self.assertEqual(resp_cities.status_code, 200)
        cities_data = resp_cities.get_json()
        self.assertTrue(cities_data.get("success"))
        self.assertIsInstance(cities_data.get("cities"), list)
        city_names = [c["name"] for c in cities_data["cities"]]
        self.assertIn("Mumbai", city_names)
        self.assertIn("Pune", city_names)
        self.assertIn("New Delhi", city_names)

        # 3. Test POST /api/weather/sync
        resp_sync = self.client.post(
            "/api/weather/sync",
            json={"city": "Pune"},
        )
        self.assertEqual(resp_sync.status_code, 200)
        sync_data = resp_sync.get_json()
        self.assertTrue(sync_data.get("success"))
        self.assertEqual(sync_data["weather"]["city"], "Pune")

        # 4. Test GET /api/weather?area=mumbai_dadar
        resp_area = self.client.get("/api/weather?area=mumbai_dadar")
        self.assertEqual(resp_area.status_code, 200)
        area_data = resp_area.get_json()
        self.assertTrue(area_data.get("success"))
        self.assertIn("Dadar", area_data["weather"]["area"])
        self.assertIn("F-North", area_data["weather"]["zone"])
        self.assertIn("Britannia", area_data["weather"]["basin"])

        # 5. Test GET /api/weather/areas
        resp_all_areas = self.client.get("/api/weather/areas")
        self.assertEqual(resp_all_areas.status_code, 200)
        areas_catalog = resp_all_areas.get_json()
        self.assertTrue(areas_catalog.get("success"))
        self.assertGreater(areas_catalog.get("count", 0), 10)

    def test_tide_endpoints(self):
        # 1. Test GET /api/tide
        resp = self.client.get("/api/tide")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data.get("success"))
        tide = data.get("tide")
        self.assertIsNotNone(tide)
        self.assertIn("height_m", tide)
        self.assertIn("spring_tide_threshold_m", tide)
        self.assertIn("phase", tide)
        self.assertIn("peak_high_tide", tide)
        self.assertIn("evening_low_tide", tide)
        self.assertIn("floodgates_locked", tide)
        self.assertIn("schedule", tide)
        self.assertIn("coastal_outfalls", tide)

        # 2. Test GET /api/mumbai/tide compatibility alias
        resp_mum = self.client.get("/api/mumbai/tide")
        self.assertEqual(resp_mum.status_code, 200)
        self.assertTrue(resp_mum.get_json().get("success"))

        # 3. Test POST /api/tide/simulate with low_tide
        resp_low = self.client.post(
            "/api/tide/simulate",
            json={"scenario": "low_tide"},
        )
        self.assertEqual(resp_low.status_code, 200)
        low_tide = resp_low.get_json()["tide"]
        self.assertFalse(low_tide["is_high_tide"])
        self.assertFalse(low_tide["floodgates_locked"])
        self.assertLess(low_tide["height_m"], 2.0)

        # 4. Test POST /api/tide/simulate with high_tide_surge
        resp_surge = self.client.post(
            "/api/tide/simulate",
            json={"scenario": "high_tide_surge", "height_m": 4.88},
        )
        self.assertEqual(resp_surge.status_code, 200)
        surge_tide = resp_surge.get_json()["tide"]
        self.assertTrue(surge_tide["is_high_tide"])
        self.assertTrue(surge_tide["floodgates_locked"])
        self.assertGreaterEqual(surge_tide["height_m"], 4.50)


if __name__ == "__main__":
    unittest.main()


