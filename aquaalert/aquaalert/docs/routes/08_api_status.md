# Route Documentation: `GET /api/status`

## 📋 Overview
- **Endpoint:** `/api/status`
- **Method:** `GET`
- **Controller:** [`app.get_status()`](file:///D:/aquaalert/server/app.py)
- **Query Parameter:** `device_id` (optional, e.g. `?device_id=AQUA-001`)

---

## 🎯 Purpose
Provides a heartbeat / watchdog endpoint that tells clients whether an ESP32 hardware device (or any active sensor node) is **ONLINE** or **OFFLINE**. 

A device is considered **ONLINE** if its last received reading occurred within the last 10 seconds (`OFFLINE_THRESHOLD`).

---

## 🔄 Dataflow

```mermaid
graph TD
    A[Client sends GET /api/status?device_id=AQUA-001] --> B[Flask checks in-memory device_last_seen dictionary]
    B --> C{Timestamp exists?}
    C -->|No| D[Return online: false, last_seen: null]
    C -->|Yes| E[Calculate elapsed = now - last_seen]
    E --> F{elapsed <= 10s ?}
    F -->|Yes| G[Return online: true, elapsed_seconds]
    F -->|No| H[Return online: false, elapsed_seconds]
```

---

## 📤 Response Schema (`200 OK`)

### When Sensor is Active (Online)
```json
{
  "device_id": "AQUA-001",
  "elapsed_seconds": 1.4,
  "last_seen": "2026-08-29T14:36:55.993120+00:00",
  "online": true
}
```

### When Sensor is Inactive (Offline)
```json
{
  "device_id": "AQUA-001",
  "elapsed_seconds": 45.2,
  "last_seen": "2026-08-29T14:36:55.993120+00:00",
  "online": false
}
```

---

## 💻 Example Request
```bash
curl -i "http://localhost:5000/api/status?device_id=AQUA-001"
```
