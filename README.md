# 🌊 AquaAlert – Smart Waterlogging Monitoring & Early Warning System

**An IoT-based solution for water-level monitoring and waterlogging awareness.**

AquaAlert is a smart monitoring project that combines IoT hardware and a web-based dashboard to monitor water levels and identify potential waterlogging conditions. It uses an ESP32 and a waterproof ultrasonic sensor to measure water levels, while the dashboard presents monitoring information and analytics.

---

## 📸 Project Screenshots

### 🏠 Home Page
<img width="960" height="600" alt="Screenshot 2026-10-06 155957" src="https://github.com/user-attachments/assets/802251e0-9718-4a70-8a46-96d8e2c2b590" />



### 📊 Live Monitoring Dashboard
<img width="960" height="600" alt="Screenshot 2026-10-06 160032" src="https://github.com/user-attachments/assets/0eceadc9-63a3-49db-a2ab-27a6a6ca2175" />



### 🌧️ Mumbai Drainage Monitoring
<img width="960" height="600" alt="Screenshot 2026-10-06 160113" src="https://github.com/user-attachments/assets/f23bb0b1-3307-4d7e-9fb3-2608c46536af" />



### 📈 Analytics & Forecasting
<img width="960" height="600" alt="Screenshot 2026-10-06 160135" src="https://github.com/user-attachments/assets/bdb4bcc9-c1f6-4194-910f-a9402eaef189" />



### ⚙️ System Architecture
<img width="960" height="600" alt="Screenshot 2026-10-06 160158" src="https://github.com/user-attachments/assets/6bc1f5c1-5ea8-421b-a7a0-52dda7675204" />



---

## ✨ Key Features

- Real-time water-level monitoring using an ultrasonic sensor.
- ESP32-based IoT hardware integration.
- LCD display for local water-level information.
- LED indicators for different water-level conditions.
- Web-based monitoring dashboard.
- Mumbai drainage monitoring interface.
- Data visualization and analytics dashboard.
- Waterlogging risk monitoring concept.

## 🛠️ Technologies Used

| Category          | Technologies                          |
| ----------------- | ------------------------------------- |
| Microcontroller   | ESP32                                 |
| Sensor            | AJ-SR04M Waterproof Ultrasonic Sensor |
| Programming       | C/C++, Python                         |
| Backend           | Flask                                 |
| Database          | SQLite                                |
| Frontend          | HTML, CSS, JavaScript                 |
| Development Tools | Arduino IDE, VS Code, Git, GitHub     |

## 🔌 Hardware Components

- ESP32 Development Board
- AJ-SR04M Waterproof Ultrasonic Sensor
- 16×2 I²C LCD
- Green, Yellow and Red LEDs
- 220Ω Resistors
- Jumper Wires

## ⚙️ How It Works

1. The ultrasonic sensor measures the distance between the sensor and the water surface.
2. ESP32 processes the sensor readings.
3. The water level is calculated using the configured reference depth.
4. LCD and LEDs indicate the current water-level condition.
5. Sensor data can be transmitted through Wi-Fi to the backend.
6. The dashboard displays available monitoring information.

## 🏗️ System Architecture

```text
Water Surface
      ↓
Ultrasonic Sensor
      ↓
ESP32 Microcontroller
      ↓
 ┌────┴─────┐
 ↓          ↓
LCD       LEDs
      ↓
    Wi-Fi
      ↓
 Flask Backend
      ↓
 SQLite Database
      ↓
  Web Dashboard
```

## 🎯 Project Objectives

- Develop an IoT-based water-level monitoring prototype.
- Reduce dependence on manual water-level inspection.
- Provide visual indications of changing water levels.
- Explore real-time monitoring through a web dashboard.
- Demonstrate how IoT technology can support urban waterlogging awareness.

## 🚀 Future Improvements

- SMS and mobile notifications.
- GPS-based sensor location tracking.
- Historical water-level analysis.
- Integration with verified rainfall and weather APIs.
- Deployment of sensors at selected drainage locations.
- Improved flood-risk prediction and analysis.

## 🌍 Potential Applications

- Urban drainage monitoring.
- Waterlogging-prone roads.
- Flood-prone areas.
- Municipal monitoring systems.
- Smart city infrastructure.

**AquaAlert – Smart Monitoring for Safer Urban Environments.** 🌊

*Academic IoT prototype. Dashboard data sources and hardware integrations should be verified before operational or public-safety use.*
