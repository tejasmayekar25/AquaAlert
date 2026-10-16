import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

import database
import mumbai_drainage
from app import app


class MumbaiDrainageTest(unittest.TestCase):
    def setUp(self):
        database.init_db()
        app.config["API_KEY"] = "test-api-key"
        self.client = app.test_client()

    def test_mumbai_drainage_page_loads(self):
        resp = self.client.get("/mumbai-drainage")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Mumbai Monsoon Drainage", html)
        self.assertIn("mumbai-leaflet-map", html)
        self.assertIn("16×2 I2C CHARACTER LCD", html)
        self.assertIn("GPIO 27", html)

    def test_api_mumbai_drains_list(self):
        resp = self.client.get("/api/mumbai/drains")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertGreaterEqual(data["count"], 16)
        
        # Verify fields on first drain
        d1 = data["drains"][0]
        self.assertIn("name", d1)
        self.assertIn("ward", d1)
        self.assertIn("percentage", d1)
        self.assertIn("nearest_station", d1)
        self.assertIn("in_heavy_rain_zone", d1)

    def test_api_mumbai_stations(self):
        resp = self.client.get("/api/mumbai/stations")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertGreaterEqual(len(data["stations"]), 7)

    def test_api_mumbai_tide(self):
        resp = self.client.get("/api/mumbai/tide")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertIn("height_m", data["tide"])
        self.assertIn("floodgates_locked", data["tide"])

    def test_api_mumbai_hardware_twin(self):
        resp = self.client.get("/api/mumbai/hardware")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        hw = data["hardware"]
        self.assertIn("lcd_line_1", hw)
        self.assertIn("lcd_line_2", hw)
        self.assertIn("led_green", hw)
        self.assertIn("led_yellow", hw)
        self.assertIn("led_red", hw)
        self.assertIn("buzzer_mode", hw)

    def test_assign_hardware_node(self):
        resp = self.client.post(
            "/api/mumbai/assign-node",
            json={"drain_id": "DRN-MUM-002", "device_id": "AQUA-001"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["hardware"]["bound_drain_id"], "DRN-MUM-002")

    def test_monsoon_simulation(self):
        resp = self.client.post(
            "/api/mumbai/simulate",
            json={"scenario": "cloudburst_santacruz", "rainfall": 140.0},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["result"]["scenario"], "cloudburst_santacruz")

    def test_esp32_telemetry_updates_mumbai_twin(self):
        # 1. Post telemetry from physical ESP32 to /api/data
        resp = self.client.post(
            "/api/data",
            json={
                "device_id": "AQUA-001",
                "distance": 18.0,
                "waterLevel": 88.0,
                "percentage": 88,
                "status": "CRITICAL",
                "rainfall": 92.5,
            },
            headers={"X-API-Key": "test-api-key"},
        )
        self.assertEqual(resp.status_code, 200)

        # 2. Check hardware twin state reflects Red LED and Continuous Buzzer
        hw = mumbai_drainage.get_esp32_hardware_state()
        self.assertEqual(hw["percentage"], 88)
        self.assertEqual(hw["status"], "CRITICAL")
        self.assertTrue(hw["led_red"])
        self.assertFalse(hw["led_green"])
        self.assertEqual(hw["buzzer_mode"], "CONTINUOUS")
        self.assertIn("CRITICAL", hw["lcd_line_2"])


if __name__ == "__main__":
    unittest.main()
