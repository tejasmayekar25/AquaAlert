/*
 * =============================================================================
 * AquaAlert — IoT Water Level Monitoring System
 * ESP32 Firmware
 * =============================================================================
 *
 * WATER LEVEL INDICATORS
 *
 * 🟢 GREEN  -> GPIO 27 -> NORMAL (< 50%)
 * 🟡 YELLOW -> GPIO 26 -> WARNING (50 - 69%)
 * 🔴 RED    -> GPIO 25 -> HIGH / CRITICAL (>= 70%)
 *
 * HARDWARE
 *
 * AJ-SR04M Waterproof Ultrasonic Sensor
 *   TRIG -> GPIO 5
 *   ECHO -> GPIO 18
 *   VCC  -> 5V
 *   GND  -> GND
 *
 * Buzzer
 *   (+) -> GPIO 23
 *   (-) -> GND
 *
 * 16x2 I2C LCD
 *   SDA -> GPIO 21
 *   SCL -> GPIO 22
 *   VCC -> 5V
 *   GND -> GND
 *
 * LEDs
 *   RED    -> GPIO 25 -> 220Ω resistor -> LED -> GND
 *   YELLOW -> GPIO 26 -> 220Ω resistor -> LED -> GND
 *   GREEN  -> GPIO 27 -> 220Ω resistor -> LED -> GND
 *
 * Serial Monitor
 *   115200 baud
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

void printResetReason() {
  esp_reset_reason_t reason = esp_reset_reason();

  Serial.print("[BOOT] Reset reason: ");

  switch (reason) {
    case ESP_RST_POWERON:
      Serial.println("POWER ON");
      break;

    case ESP_RST_EXT:
      Serial.println("EXTERNAL RESET");
      break;

    case ESP_RST_SW:
      Serial.println("SOFTWARE RESET");
      break;

    case ESP_RST_PANIC:
      Serial.println("PANIC / CRASH");
      break;

    case ESP_RST_INT_WDT:
      Serial.println("INTERRUPT WATCHDOG");
      break;

    case ESP_RST_TASK_WDT:
      Serial.println("TASK WATCHDOG");
      break;

    case ESP_RST_WDT:
      Serial.println("OTHER WATCHDOG");
      break;

    case ESP_RST_BROWNOUT:
      Serial.println("BROWNOUT / POWER PROBLEM");
      break;

    case ESP_RST_DEEPSLEEP:
      Serial.println("DEEP SLEEP");
      break;

    default:
      Serial.printf("UNKNOWN (%d)\n", reason);
      break;
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

#if __has_include("secrets.h")
#include "secrets.h"
#else
const char* WIFI_SSID     = "vivo_1917";
const char* WIFI_PASSWORD = "tejas12345";
const char* SERVER_URL    = "http://192.168.73.200:5000/api/data";
const char* API_KEY       = "";
#endif

// Wi-Fi
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;

// Device ID
const char* DEVICE_ID = "AQUA-001";


// =============================================================================
// HARDWARE PINS
// =============================================================================

// Ultrasonic sensor
#define TRIG_PIN 5
#define ECHO_PIN 18

// Buzzer
#define BUZZER_PIN 23

// LEDs
#define RED_LED 25
#define YELLOW_LED 26
#define GREEN_LED 27


// =============================================================================
// WATER LEVEL CALIBRATION
// =============================================================================

// Total drain/tank depth
#define MAX_DEPTH 100.0f

// AJ-SR04M valid distance range
#define MIN_SENSOR_DISTANCE 2.0f
#define MAX_SENSOR_DISTANCE 400.0f

// Number of sensor readings used for median filtering
#define NUM_MEDIAN_SAMPLES 5


// =============================================================================
// WATCHDOG
// =============================================================================

#define WDT_TIMEOUT_SECONDS 8


// =============================================================================
// TIMING
// =============================================================================

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long HTTP_INTERVAL = 3000;
const unsigned long LCD_INTERVAL = 500;
const unsigned long WIFI_RETRY_INT = 10000;


// =============================================================================
// LCD
// =============================================================================

// I2C address normally 0x27
// Some LCD modules use 0x3F
LiquidCrystal_I2C lcd(0x27, 16, 2);


// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

unsigned long lastSensorTime = 0;
unsigned long lastHTTPTime = 0;
unsigned long lastLCDTime = 0;
unsigned long lastWiFiRetry = 0;


// Sensor data
float gDistance = 0.0f;
float gWaterLevel = 0.0f;
int gPercentage = 0;

String gStatus = "NORMAL";

bool gSensorError = false;


// =============================================================================
// BUZZER MODES
// =============================================================================

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

void updateLCD(
  float waterLevel,
  int pct,
  const String& status,
  bool error
);

void updateLEDs(
  const String& status,
  bool error
);

void setBuzzerMode(
  const String& status,
  bool error
);

void updateBuzzer();

void sendData(
  float dist,
  float waterLevel,
  int pct,
  const String& status
);

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

  printResetReason();

  // ===========================================================================
  // 1. CONFIGURE GPIO
  // ===========================================================================

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // LEDs
  pinMode(RED_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);

  // Initial state
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);

  // ===========================================================================
  // 2. INITIALIZE LCD
  // ===========================================================================

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("  AQUAALERT v1  ");

  lcd.setCursor(0, 1);
  lcd.print("  Booting...    ");

  // ===========================================================================
  // 3. CONNECT TO WI-FI
  // ===========================================================================

  connectWiFi(true);

  // ===========================================================================
  // 4. READY SCREEN
  // ===========================================================================

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AquaAlert System");

  lcd.setCursor(0, 1);
  lcd.print("Sensor: Ready   ");

  // ===========================================================================
  // 5. INITIALIZE TASK WATCHDOG (8 seconds)
  // ===========================================================================

  Serial.println("[WDT] Initializing Task Watchdog Timer...");
#if defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
  esp_task_wdt_config_t twdt_config = {
    .timeout_ms = WDT_TIMEOUT_SECONDS * 1000,
    .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
    .trigger_panic = true,
  };
  esp_task_wdt_reconfigure(&twdt_config);
  esp_task_wdt_add(NULL); // Subscribe current task (loopTask) to prevent "task not found"
#else
  esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
  esp_task_wdt_add(NULL); // Subscribe current task (loopTask) to prevent "task not found"
#endif
  Serial.println("[WDT] Task Watchdog configured successfully.");

  Serial.println();
  Serial.println("[SYS] Setup complete.");
  Serial.println("[SYS] LEDs initialized.");
  Serial.println("========================================");
  Serial.println();
}


// =============================================================================
// MAIN LOOP
// =============================================================================

void loop() {
  // Feed the Task Watchdog Timer
  esp_task_wdt_reset();

  unsigned long now = millis();

  // ===========================================================================
  // 1. READ ULTRASONIC SENSOR
  // ===========================================================================

  if (now - lastSensorTime >= SENSOR_INTERVAL) {
    lastSensorTime = now;

    float distance = readFilteredDistance();

    // -------------------------------------------------------------------------
    // VALID SENSOR READING
    // -------------------------------------------------------------------------

    if (distance > 0.0f) {
      gSensorError = false;
      gDistance = distance;

      // Calculate water level
      float waterLevel = MAX_DEPTH - distance;

      if (waterLevel < 0.0f) {
        waterLevel = 0.0f;
      }
      if (waterLevel > MAX_DEPTH) {
        waterLevel = MAX_DEPTH;
      }
      gWaterLevel = waterLevel;

      // Calculate percentage
      int percentage = (int)roundf((waterLevel / MAX_DEPTH) * 100.0f);

      if (percentage < 0) {
        percentage = 0;
      }
      if (percentage > 100) {
        percentage = 100;
      }
      gPercentage = percentage;

      // Determine status
      String status = calculateStatus(percentage);
      gStatus = status;

      // Serial output
      Serial.printf(
        "[SENSOR] Distance: %.1f cm | Water: %.1f cm | Level: %d%% | Status: %s\n",
        distance,
        waterLevel,
        percentage,
        status.c_str()
      );

      // Update LEDs
      updateLEDs(status, false);

      // Update buzzer
      setBuzzerMode(status, false);
    }

    // -------------------------------------------------------------------------
    // SENSOR ERROR
    // -------------------------------------------------------------------------

    else {
      gSensorError = true;

      Serial.println(
        "[SENSOR ERROR] No valid ultrasonic reading."
      );

      // Turn LEDs OFF
      updateLEDs("NORMAL", true);

      // Turn buzzer OFF
      setBuzzerMode("NORMAL", true);
    }
  }

  // ===========================================================================
  // 2. UPDATE BUZZER
  // ===========================================================================

  updateBuzzer();

  // ===========================================================================
  // 3. UPDATE LCD
  // ===========================================================================

  if (now - lastLCDTime >= LCD_INTERVAL) {
    lastLCDTime = now;

    updateLCD(
      gWaterLevel,
      gPercentage,
      gStatus,
      gSensorError
    );
  }

  // ===========================================================================
  // 4. WI-FI RECONNECT
  // ===========================================================================

  if (
    WiFi.status() != WL_CONNECTED &&
    (now - lastWiFiRetry >= WIFI_RETRY_INT)
  ) {
    lastWiFiRetry = now;

    Serial.println(
      "[WiFi] Connection lost. Reconnecting..."
    );

    WiFi.disconnect();
    WiFi.reconnect();
  }

  // ===========================================================================
  // 5. SEND DATA TO FLASK SERVER
  // ===========================================================================

  if (now - lastHTTPTime >= HTTP_INTERVAL) {
    lastHTTPTime = now;

    if (!gSensorError) {
      sendData(
        gDistance,
        gWaterLevel,
        gPercentage,
        gStatus
      );
    } else {
      Serial.println("[HTTP] Skipping POST: Ultrasonic sensor not reading valid distance.");
    }
  }
}


// =============================================================================
// READ RAW DISTANCE
// =============================================================================

float readRawDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Wait for echo
  long duration = pulseIn(ECHO_PIN, HIGH, 25000UL);

  // No echo
  if (duration == 0) {
    return 0.0f;
  }

  // Calculate distance
  float distance = (duration * 0.0343f) / 2.0f;

  // Check valid sensor range
  if (
    distance < MIN_SENSOR_DISTANCE ||
    distance > MAX_SENSOR_DISTANCE
  ) {
    return 0.0f;
  }

  return distance;
}


// =============================================================================
// MEDIAN FILTER
// =============================================================================

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

  // No valid readings
  if (validCount == 0) {
    return 0.0f;
  }

  // Sort samples
  std::sort(samples, samples + validCount);

  // Return median
  return samples[validCount / 2];
}


// =============================================================================
// CALCULATE STATUS
// =============================================================================

String calculateStatus(int pct) {
  // 85-100%
  if (pct >= 85) {
    return "CRITICAL";
  }

  // 70-84%
  if (pct >= 70) {
    return "HIGH";
  }

  // 50-69%
  if (pct >= 50) {
    return "WARNING";
  }

  // 0-49%
  return "NORMAL";
}


// =============================================================================
// UPDATE LEDs
// =============================================================================

void updateLEDs(
  const String& status,
  bool error
) {
  // Turn all LEDs off first
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);

  // Sensor error
  if (error) {
    return;
  }

  // NORMAL -> GREEN LED
  if (status == "NORMAL") {
    digitalWrite(GREEN_LED, HIGH);
    Serial.println("[LED] GREEN - NORMAL");
  }
  // WARNING -> YELLOW LED
  else if (status == "WARNING") {
    digitalWrite(YELLOW_LED, HIGH);
    Serial.println("[LED] YELLOW - WARNING");
  }
  // HIGH -> RED LED
  else if (status == "HIGH") {
    digitalWrite(RED_LED, HIGH);
    Serial.println("[LED] RED - HIGH");
  }
  // CRITICAL -> RED LED
  else if (status == "CRITICAL") {
    digitalWrite(RED_LED, HIGH);
    Serial.println("[LED] RED - CRITICAL");
  }
}


// =============================================================================
// UPDATE LCD
// =============================================================================

void updateLCD(
  float waterLevel,
  int pct,
  const String& status,
  bool error
) {
  char line1[17];
  char line2[17];

  if (error) {
    snprintf(line1, sizeof(line1), "%-16s", "AQUAALERT");
    snprintf(line2, sizeof(line2), "%-16s", "SENSOR ERROR!");
  } else {
    // Example: AQUAALERT   72%
    snprintf(line1, sizeof(line1), "AQUAALERT   %3d%%", pct);

    // Example: 72cm      HIGH
    snprintf(
      line2,
      sizeof(line2),
      "%-8s %7s",
      (String((int)roundf(waterLevel)) + "cm").c_str(),
      status.c_str()
    );
  }

  lcd.setCursor(0, 0);
  lcd.print(line1);

  lcd.setCursor(0, 1);
  lcd.print(line2);
}


// =============================================================================
// SET BUZZER MODE
// =============================================================================

void setBuzzerMode(
  const String& status,
  bool error
) {
  // NORMAL or ERROR
  if (error || status == "NORMAL") {
    gBuzzerMode = BUZZER_SILENT;
  }
  // WARNING
  else if (status == "WARNING") {
    gBuzzerMode = BUZZER_WARNING_PATTERN;
  }
  // HIGH
  else if (status == "HIGH") {
    gBuzzerMode = BUZZER_HIGH_PATTERN;
  }
  // CRITICAL
  else if (status == "CRITICAL") {
    gBuzzerMode = BUZZER_CONTINUOUS;
  }
}


// =============================================================================
// UPDATE BUZZER
// =============================================================================

void updateBuzzer() {
  unsigned long now = millis();

  switch (gBuzzerMode) {
    case BUZZER_SILENT:
      digitalWrite(BUZZER_PIN, LOW);
      break;

    // WARNING: Two short beeps
    case BUZZER_WARNING_PATTERN: {
      unsigned long phase = now % 2000;
      if ((phase < 100) || (phase >= 200 && phase < 300)) {
        digitalWrite(BUZZER_PIN, HIGH);
      } else {
        digitalWrite(BUZZER_PIN, LOW);
      }
      break;
    }

    // HIGH: Three short beeps
    case BUZZER_HIGH_PATTERN: {
      unsigned long phase = now % 1500;
      if (
        (phase < 80) ||
        (phase >= 160 && phase < 240) ||
        (phase >= 320 && phase < 400)
      ) {
        digitalWrite(BUZZER_PIN, HIGH);
      } else {
        digitalWrite(BUZZER_PIN, LOW);
      }
      break;
    }

    // CRITICAL: Continuous buzzer
    case BUZZER_CONTINUOUS:
      digitalWrite(BUZZER_PIN, HIGH);
      break;
  }
}


// =============================================================================
// CONNECT WI-FI
// =============================================================================

bool connectWiFi(bool initialBoot) {
  if (strlen(ssid) == 0) {
    Serial.println("[WiFi] SSID not configured.");
    return false;
  }

  Serial.printf("[WiFi] Connecting to \"%s\" ", ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  const int maxAttempts = initialBoot ? 20 : 6;

  while (WiFi.status() != WL_CONNECTED && attempts < maxAttempts) {
    esp_task_wdt_reset();
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


// =============================================================================
// SEND DATA TO FLASK SERVER
// =============================================================================

void sendData(
  float dist,
  float waterLevel,
  int pct,
  const String& status
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Cannot send: Wi-Fi not connected.");
    return;
  }

  // ===========================================================================
  // JSON BODY
  // ===========================================================================

  char body[256];

  snprintf(
    body,
    sizeof(body),
    "{\"device_id\":\"%s\","
    "\"distance\":%.1f,"
    "\"waterLevel\":%.1f,"
    "\"percentage\":%d,"
    "\"status\":\"%s\"}",
    DEVICE_ID,
    dist,
    waterLevel,
    pct,
    status.c_str()
  );

  // ===========================================================================
  // HTTP REQUEST
  // ===========================================================================

  HTTPClient http;
  http.begin(SERVER_URL);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");

  if (strlen(API_KEY) > 0) {
    http.addHeader("X-API-Key", API_KEY);
  }

  int httpCode = http.POST((uint8_t*)body, strlen(body));
  esp_task_wdt_reset(); // Feed watchdog immediately after network call

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[HTTP] POST OK (%d): %s\n", httpCode, body);
  } else {
    Serial.printf("[HTTP] POST Failed (code %d) to %s\n", httpCode, SERVER_URL);
  }

  http.end();
}
