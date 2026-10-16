# Route Documentation: `GET /about`

## 📋 Overview
- **Endpoint:** `/about`
- **Method:** `GET`
- **Controller:** [`app.about()`](file:///D:/aquaalert/server/app.py)
- **Template:** [`templates/about.html`](file:///D:/aquaalert/templates/about.html)

---

## 🎯 Purpose
Serves the **About & Architecture Specification** page detailing:
- Hardware components (ESP32, AJ-SR04M waterproof ultrasonic sensor, I2C LCD, active buzzer)
- Threshold specifications ($0\text{--}49\%$ NORMAL, $50\text{--}69\%$ WARNING, $70\text{--}84\%$ HIGH, $85\text{--}100\%$ CRITICAL)
- Acoustic alert patterns and frequencies
- Software tech stack and REST API schemas

---

## 🔄 Dataflow

1. Browser requests `GET /about`.
2. Flask renders the static documentation template [`templates/about.html`](file:///D:/aquaalert/templates/about.html).
3. No active WebSocket or telemetry polling is executed on this page.

---

## 💻 Example Request & Response

### Request
```bash
curl -i http://localhost:5000/about
```

### Response
- **Status:** `200 OK`
- **Content-Type:** `text/html; charset=utf-8`
- **Body:** Rendered HTML for the about & spec documentation.
