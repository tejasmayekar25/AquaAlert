"""
serial_bridge.py - Direct USB Serial Bridge for AquaAlert ESP32
==============================================================
Reads live telemetry directly from the ESP32 connected via USB COM port
and forwards it into the AquaAlert Flask API (http://127.0.0.1:5000/api/data).

Features:
- Auto-detects ESP32 / CP210x / CH340 COM port
- Parses serial output: "[SENSOR] Distance: X cm | Water: Y cm | Level: Z% | Status: S"
  or direct JSON payloads
- Handles port reconnection automatically
- Forwards readings into the local dashboard in real time
"""

import json
import os
import re
import sys
import time
import urllib.request
import serial
import serial.tools.list_ports

# Ensure stdout and stderr don't fail on Unicode characters (e.g. emojis)
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SERVER_URL = os.getenv("AQUAALERT_LOCAL_URL", "http://127.0.0.1:5000/api/data")

BAUD_RATE = 115200
DEVICE_ID = "AQUA-001"

# Pattern matching ESP32 firmware output:
# [SENSOR] Raw: 25.2 cm | Water: 14.8/15.0 cm | Level: 99% | Status: CRITICAL
# or [SENSOR] Distance: 35.4 cm | Water: 64.6 cm | Level: 65% | Status: WARNING
SENSOR_PATTERN = re.compile(
    r"(?:Distance|Raw):\s*([\d\.]+)\s*cm\s*\|\s*Water:\s*([\d\.]+)(?:/[\d\.]+)?\s*cm\s*\|\s*Level:\s*(\d+)%\s*\|\s*Status:\s*([A-Za-z]+)",
    re.IGNORECASE
)



def find_esp32_port() -> str | None:
    """Find the most likely COM port for the ESP32 dev board."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        # Avoid bluetooth serial links
        if "bluetooth" in desc:
            continue
        if "cp210" in desc or "ch340" in desc or "ch910" in desc or "ftdi" in desc or "uart" in desc or "vid:10c4" in hwid or "vid:303a" in hwid or "vid:1a86" in hwid or "vid:0403" in hwid:
            return p.device
    return None


def post_reading(distance: float, water_level: float, percentage: int, status: str) -> bool:
    payload = {
        "device_id": DEVICE_ID,
        "distance": round(distance, 1),
        "waterLevel": round(water_level, 1),
        "percentage": int(percentage),
        "status": status.upper(),
        "rainfall": 0.0,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        SERVER_URL,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "AquaAlert-SerialBridge/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except Exception as exc:
        print(f"  [API Error] Failed to send reading to {SERVER_URL}: {exc}", flush=True)
        return False


def run_bridge(preferred_port: str | None = None):
    print("=" * 60, flush=True)
    print("  AquaAlert ESP32 Live Serial Bridge", flush=True)
    print(f"  Forwarding to: {SERVER_URL}", flush=True)
    print("  (Note: Ensure Arduino Serial Monitor is CLOSED so port is free)", flush=True)
    print("=" * 60, flush=True)

    warned_waiting = False
    warned_locked = False

    while True:
        target_port = preferred_port or find_esp32_port()
        if not target_port:
            if not warned_waiting:
                print("[Bridge Waiting] No active ESP32 COM port detected. Please plug in or reconnect the ESP32 via USB...", flush=True)
                warned_waiting = True
            time.sleep(2)
            continue

        try:
            with serial.Serial(target_port, BAUD_RATE, timeout=2) as ser:
                print(f"[Connected] Successfully opened {target_port} @ {BAUD_RATE} baud. Listening for readings...", flush=True)
                warned_locked = False
                warned_waiting = False
                ser.reset_input_buffer()

                while True:
                    try:
                        raw_line = ser.readline()
                        if not raw_line:
                            continue
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue

                        # Echo ESP32 output safely
                        try:
                            print(f"[ESP32] {line}", flush=True)
                        except Exception:
                            safe_line = line.encode("ascii", errors="replace").decode("ascii")
                            print(f"[ESP32] {safe_line}", flush=True)

                        # Check for sensor pattern
                        match = SENSOR_PATTERN.search(line)
                        if match:
                            dist = float(match.group(1))
                            wlevel = float(match.group(2))
                            pct = int(match.group(3))
                            st = match.group(4)
                            success = post_reading(dist, wlevel, pct, st)
                            if success:
                                print(f"  -> Forwarded to Dashboard: Level={pct}% Status={st}", flush=True)
                        elif line.startswith("{") and "distance" in line:
                            try:
                                d = json.loads(line)
                                post_reading(
                                    float(d.get("distance", 0)),
                                    float(d.get("waterLevel", 0)),
                                    int(d.get("percentage", 0)),
                                    str(d.get("status", "NORMAL"))
                                )
                            except Exception:
                                pass
                    except (serial.SerialException, OSError, PermissionError) as comm_err:
                        print(f"  [Port Lost] Connection interrupted: {comm_err}. Reconnecting...", flush=True)
                        break
                    except Exception as loop_err:
                        err_msg = str(loop_err).lower()
                        if "access is denied" in err_msg or "clearcommerror" in err_msg or "device disconnected" in err_msg or "permissionerror" in err_msg:
                            print(f"  [Port Lost] Connection interrupted: {loop_err}. Reconnecting...", flush=True)
                            break
                        print(f"  [Parse Notice] Skipping line due to: {loop_err}", flush=True)

        except serial.SerialException as se:
            err_str = str(se)
            if "PermissionError" in err_str or "Access is denied" in err_str:
                if not warned_locked:
                    print(f"[Port Locked] {target_port} is in use by another app (e.g. Arduino Serial Monitor).", flush=True)
                    print("             Attempting reconnect every 2s...", flush=True)
                    warned_locked = True
            elif "FileNotFoundError" in err_str or "could not open port" in err_str:
                if not warned_waiting:
                    print(f"[Port Disconnected] {target_port} not found. Waiting for ESP32 to reconnect...", flush=True)
                    warned_waiting = True
                # If a specific port was requested but is now gone, fall back to auto-detection
                if preferred_port and not any(p.device == preferred_port for p in serial.tools.list_ports.comports()):
                    preferred_port = None
            else:
                print(f"[Serial Disconnect] {err_str}", flush=True)
                warned_locked = False
            time.sleep(2)
        except KeyboardInterrupt:
            print("\n[Exiting] Serial bridge stopped by user.", flush=True)
            break
        except Exception as e:
            print(f"[Unexpected Error] {e}", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    port_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run_bridge(port_arg)
