/*
 * =============================================================================
 * AquaAlert — IoT Water Level Monitoring System
 * ESP32 Firmware
 * =============================================================================
 *
 * WATER LEVEL INDICATORS
 *   🟢 GREEN  -> GPIO 16 (RX2) -> NORMAL (0% - 49%)
 *   🟡 YELLOW -> GPIO 17 (TX2) -> WARNING (50% - 69%)
 *   🔴 RED    -> GPIO 19 (D19) -> HIGH & CRITICAL (70% - 100%)
 *
 * HARDWARE CONNECTIONS
 *   AJ-SR04M Ultrasonic Sensor:
 *     TRIG -> GPIO 5
 *     ECHO -> GPIO 18
 *     VCC  -> 5V
 *     GND  -> GND
 *
 *   Active Buzzer:
 *     Signal -> GPIO 32
 *     VCC    -> 3.3V / 5V
 *     GND    -> GND
 *
 *   16x2 I2C LCD:
 *     SDA -> GPIO 21
 *     SCL -> GPIO 22
 *     VCC -> 5V
 *     GND -> GND
 *
 *   LEDs (Current Limiting Resistor 220Ω to GND):
 *     RED    -> GPIO 19
 *     YELLOW -> GPIO 17
 *     GREEN  -> GPIO 16
 *
 * Serial Monitor Baud Rate: 115200
 * =============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <esp_task_wdt.h>
#include "esp_system.h"
#include <algorithm>
#include <math.h>

// =============================================================================
// CONFIGURATION
// =============================================================================

// Wi-Fi Credentials
const char* ssid     = "vivo_1917";
const char* password = "tejas12345";

// Flask API Endpoint
const char* SERVER_URL = "http://192.168.85.200:5000/api/data";

// Device Identification
const char* DEVICE_ID = "AQUA-001";
const char* API_KEY   = "";

// =============================================================================
// HARDWARE GPIO PIN DEFINITIONS
// =============================================================================

#define TRIG_PIN   5
#define ECHO_PIN   18
#define BUZZER_PIN 32

#define BUZZER_ON  HIGH
#define BUZZER_OFF LOW

#define RED_LED    19       // D19
#define YELLOW_LED 17       // TX2
#define GREEN_LED  16       // RX2

// =============================================================================
// WATER LEVEL CALIBRATION (15cm Height + 25cm Offset)
// =============================================================================

// Container depth set to 15.0 cm
#define TANK_HEIGHT 15.0f

// Air gap clearance above the 100% full mark (keeps AJ-SR04M outside blind spot)
#define SENSOR_OFFSET 25.0f

// Total distance from sensor to empty container bottom: 25.0 + 15.0 = 40.0 cm
#define MAX_EMPTY_DISTANCE (SENSOR_OFFSET + TANK_HEIGHT)

// Sensor operational bounds
#define MIN_SENSOR_DISTANCE 20.0f
#define MAX_SENSOR_DISTANCE 400.0f

#define NUM_MEDIAN_SAMPLES 5

// =============================================================================
// TIMING INTERVALS (MILLISECONDS)
// =============================================================================

const unsigned long SENSOR_INTERVAL = 1500;
const unsigned long HTTP_INTERVAL   = 3000;
const unsigned long LCD_INTERVAL    = 500;
const unsigned long WIFI_RETRY_INT  = 10000;

LiquidCrystal_I2C lcd(0x27, 16, 2);

unsigned long lastSensorTime = 0;
unsigned long lastHTTPTime   = 0;
unsigned long lastLCDTime    = 0;
unsigned long lastWiFiRetry  = 0;

float  gDistance    = 0.0f;
float  gWaterLevel  = 0.0f;
int    gPercentage  = 0;
String gStatus      = "NORMAL";
bool   gSensorError = false;

enum BuzzerMode {
  BUZZER_SILENT,
  BUZZER_WARNING_PATTERN,
  BUZZER_HIGH_PATTERN,
  BUZZER_CONTINUOUS
};

BuzzerMode gBuzzerMode = BUZZER_SILENT;

// =============================================================================
// FUNCTION PROTOTYPES
// =============================================================================

float readRawDistance();
float readFilteredDistance();
String calculateStatus(int pct);
void updateLCD(float waterLevel, int pct, const String& status, bool error);
void updateLEDs(const String& status, bool error);
void setBuzzerMode(const String& status, bool error);
void updateBuzzer();
void sendData(float dist, float waterLevel, int pct, const String& status);
bool connectWiFi(bool initialBoot = false);

// =============================================================================
// SETUP
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("========================================");
  Serial.println("   AquaAlert - Water Level Monitor");
  Serial.println("========================================");

  // Configure GPIO Pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(RED_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);

  // Set initial pin states
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);

  // Initialize LCD
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("  AQUAALERT v1  ");
  lcd.setCursor(0, 1);
  lcd.print("  Booting...    ");

  // Connect to Local Wi-Fi
  connectWiFi(true);

  // Display Ready Screen
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AquaAlert System");
  lcd.setCursor(0, 1);
  lcd.print("Sensor: Ready   ");
  delay(1000);

  Serial.println("[SYS] Setup complete.");
}

// =============================================================================
// MAIN LOOP
// =============================================================================

void loop() {
  unsigned long now = millis();

  // 1. SENSOR SAMPLING ROUTINE
  if (now - lastSensorTime >= SENSOR_INTERVAL) {
    lastSensorTime = now;

    float rawDist = readFilteredDistance();

    if (rawDist > 0.0f) {
      gSensorError = false;
      gDistance = rawDist;

      // Water Level Calculation (0.0 cm to 15.0 cm)
      // Empty: rawDist = 40.0 cm -> waterLevel = 40.0 - 40.0 = 0.0 cm
      // Full:  rawDist = 25.0 cm -> waterLevel = 40.0 - 25.0 = 15.0 cm
      float waterLevel = MAX_EMPTY_DISTANCE - rawDist;

      if (waterLevel < 0.0f) waterLevel = 0.0f;
      if (waterLevel > TANK_HEIGHT) waterLevel = TANK_HEIGHT;
      gWaterLevel = waterLevel;

      // Percentage Calculation based on 15.0 cm container height
      int percentage = (int)roundf((waterLevel / TANK_HEIGHT) * 100.0f);
      if (percentage < 0) percentage = 0;
      if (percentage > 100) percentage = 100;
      gPercentage = percentage;

      String status = calculateStatus(percentage);
      gStatus = status;

      Serial.printf("[SENSOR] Raw: %.1f cm | Water: %.1f/15.0 cm | Level: %d%% | Status: %s\n",
                    rawDist, waterLevel, percentage, status.c_str());

      updateLEDs(status, false);
      setBuzzerMode(status, false);
    } else {
      gSensorError = true;
      Serial.println("[SENSOR ERROR] Reading out of range or in blind zone (<20cm).");
      updateLEDs("NORMAL", true);
      setBuzzerMode("NORMAL", true);
    }
  }

  // 2. NON-BLOCKING BUZZER PATTERNS
  updateBuzzer();

  // 3. LCD REFRESH
  if (now - lastLCDTime >= LCD_INTERVAL) {
    lastLCDTime = now;
    updateLCD(gWaterLevel, gPercentage, gStatus, gSensorError);
  }

  // 4. WI-FI AUTO-RECONNECT
  if (WiFi.status() != WL_CONNECTED && (now - lastWiFiRetry >= WIFI_RETRY_INT)) {
    lastWiFiRetry = now;
    Serial.println("[WiFi] Connection lost. Reconnecting...");
    WiFi.disconnect();
    WiFi.reconnect();
  }

  // 5. HTTP TELEMETRY TRANSMISSION
  if (now - lastHTTPTime >= HTTP_INTERVAL) {
    lastHTTPTime = now;
    if (!gSensorError) {
      sendData(gDistance, gWaterLevel, gPercentage, gStatus);
    }
  }
}

// =============================================================================
// SENSOR PROCESSING FUNCTIONS
// =============================================================================

float readRawDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) return 0.0f;

  float distance = (duration * 0.0343f) / 2.0f;

  if (distance < MIN_SENSOR_DISTANCE || distance > MAX_SENSOR_DISTANCE) {
    return 0.0f;
  }
  return distance;
}

float readFilteredDistance() {
  float samples[NUM_MEDIAN_SAMPLES];
  int validCount = 0;

  for (int i = 0; i < NUM_MEDIAN_SAMPLES; i++) {
    float d = readRawDistance();
    if (d > 0.0f) {
      samples[validCount++] = d;
    }
    delay(20);
  }

  if (validCount == 0) return 0.0f;

  std::sort(samples, samples + validCount);
  return samples[validCount / 2];
}

String calculateStatus(int pct) {
  if (pct >= 85) return "CRITICAL"; // Red LED + Continuous Buzzer
  if (pct >= 70) return "HIGH";     // Red LED + 3-Beep Pattern
  if (pct >= 50) return "WARNING";  // Yellow LED + 1-Beep Pattern
  return "NORMAL";                  // Green LED + Silent
}

// =============================================================================
// OUTPUT PERIPHERAL CONTROLLERS
// =============================================================================

void updateLEDs(const String& status, bool error) {
  // Clear all indicator LEDs
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);

  if (error) return;

  if (status == "NORMAL") {
    digitalWrite(GREEN_LED, HIGH);
  } else if (status == "WARNING") {
    digitalWrite(YELLOW_LED, HIGH); // Active from 50% to 69%
  } else if (status == "HIGH" || status == "CRITICAL") {
    digitalWrite(RED_LED, HIGH);    // Active from 70% to 100%
  }
}

void updateLCD(float waterLevel, int pct, const String& status, bool error) {
  char line1[17];
  char line2[17];

  if (error) {
    snprintf(line1, sizeof(line1), "%-16s", "AQUAALERT");
    snprintf(line2, sizeof(line2), "%-16s", "SENSOR ERROR!");
  } else {
    snprintf(line1, sizeof(line1), "AQUAALERT   %3d%%", pct);
    snprintf(line2, sizeof(line2), "%.1fcm     %7s", waterLevel, status.c_str());
  }

  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void setBuzzerMode(const String& status, bool error) {
  if (error || status == "NORMAL") {
    gBuzzerMode = BUZZER_SILENT;
    digitalWrite(BUZZER_PIN, BUZZER_OFF);
    return;
  }
  if (status == "WARNING") {
    gBuzzerMode = BUZZER_WARNING_PATTERN;
    return;
  }
  if (status == "HIGH") {
    gBuzzerMode = BUZZER_HIGH_PATTERN;
    return;
  }
  if (status == "CRITICAL") {
    gBuzzerMode = BUZZER_CONTINUOUS;
    return;
  }
  gBuzzerMode = BUZZER_SILENT;
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
}

void updateBuzzer() {
  unsigned long now = millis();
  switch (gBuzzerMode) {
    case BUZZER_SILENT:
      digitalWrite(BUZZER_PIN, BUZZER_OFF);
      break;
    case BUZZER_WARNING_PATTERN: {
      unsigned long phase = now % 1200;
      digitalWrite(BUZZER_PIN, (phase < 200) ? BUZZER_ON : BUZZER_OFF);
      break;
    }
    case BUZZER_HIGH_PATTERN: {
      unsigned long phase = now % 1500;
      bool on = (phase < 150) || (phase >= 300 && phase < 450) || (phase >= 600 && phase < 750);
      digitalWrite(BUZZER_PIN, on ? BUZZER_ON : BUZZER_OFF);
      break;
    }
    case BUZZER_CONTINUOUS:
      digitalWrite(BUZZER_PIN, BUZZER_ON);
      break;
  }
}

// =============================================================================
// NETWORK COMMUNICATION
// =============================================================================

bool connectWiFi(bool initialBoot) {
  if (strlen(ssid) == 0) return false;
  Serial.printf("[WiFi] Connecting to \"%s\" ", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  const int maxAttempts = initialBoot ? 20 : 6;
  while (WiFi.status() != WL_CONNECTED && attempts < maxAttempts) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" Connected!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println(" FAILED. Continuing offline.");
  return false;
}

void sendData(float dist, float waterLevel, int pct, const String& status) {
  if (WiFi.status() != WL_CONNECTED) return;

  char body[256];
  snprintf(body, sizeof(body),
    "{\"device_id\":\"%s\",\"distance\":%.1f,\"waterLevel\":%.1f,\"percentage\":%d,\"status\":\"%s\"}",
    DEVICE_ID, dist, waterLevel, pct, status.c_str());

  HTTPClient http;
  http.begin(SERVER_URL);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");

  if (strlen(API_KEY) > 0) {
    http.addHeader("X-API-Key", API_KEY);
  }

  int httpCode = http.POST((uint8_t*)body, strlen(body));
  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[HTTP] POST OK (%d): %s\n", httpCode, body);
  } else {
    Serial.printf("[HTTP] POST Failed (%d)\n", httpCode);
  }
  http.end();
}