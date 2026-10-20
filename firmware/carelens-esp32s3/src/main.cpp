// CareLens AI firmware for the chest-worn ESP32-S3-WROOM N16R8 + OV5640 + MPU6050 + MAX98357A box.
// Hardware configuration from the known-good baseline sketch; device contract v2 (docs/DEVICE_API.md).
// No Wi-Fi password, token or other secret is compiled in: they are provisioned into NVS over UART0.
#include <Arduino.h>
#include <WiFi.h>
#include <esp_system.h>

#include "audio.h"
#include "camera.h"
#include "cloud.h"
#include "config.h"
#include "console.h"
#include "devclock.h"
#include "greeting.h"
#include "imu.h"
#include "log.h"
#include "settings.h"
#include "wav.h"

using namespace carelens;

namespace {

Settings g_settings;
bool g_stable_marked = false;
constexpr uint32_t kStableUptimeMs = 60000;

const char* resetReasonText(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "external_pin";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt_watchdog";
    case ESP_RST_TASK_WDT: return "task_watchdog";
    case ESP_RST_WDT: return "other_watchdog";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    case ESP_RST_USB: return "usb";
    case ESP_RST_JTAG: return "jtag";
    default: return "unknown";
  }
}

// One greeting per boot, after the audio path is up, without any network. Suppressed after a brownout (the speaker
// may be what pulls the supply down) and after two consecutive boots that did not reach a stable minute, so a
// reboot loop can never turn into a repeating greeting.
void greetOnce(esp_reset_reason_t reason, uint8_t short_boots) {
  if (!audioReady()) {
    logf("boot", "greeting skipped: audio not ready");
    return;
  }
  if (reason == ESP_RST_BROWNOUT) {
    logf("boot", "greeting suppressed: last reset was a brownout");
    return;
  }
  if (short_boots >= 2) {
    logf("boot", "greeting suppressed: %u consecutive short boots", short_boots);
    return;
  }
  AudioJob j;
  const Mp3Error e = greetingJob(&j);
  if (e != Mp3Error::kOk) {
    logf("boot", "greeting asset invalid: %s", mp3ErrorCode(e));
    return;
  }
  logf("boot", "greeting \"Xin chao.\" mp3 %lu ms (%u bytes) queued: %s", static_cast<unsigned long>(j.mp3.durationMs()),
       static_cast<unsigned>(j.bytes), audioSubmit(j) ? "ok" : "FAILED");
}

}  // namespace

void setup() {
  logBegin();
  clockBegin();
  const esp_reset_reason_t reason = esp_reset_reason();
  const uint8_t short_boots = bootCounterEnter();
  logf("boot", "%s boot_id=%s reset=%s short_boots_before=%u psram=%u", CARELENS_FW_VERSION, bootId(), resetReasonText(reason), short_boots,
       static_cast<unsigned>(ESP.getPsramSize()));
  if (!settingsLoad(&g_settings)) logf("boot", "no settings in NVS yet (provision with tools/provision.py)");
  consoleBegin(&g_settings);

  const bool audio_ok = audioBegin(g_settings.volume);
  logf("boot", "speaker %s (volume %.2f)", audio_ok ? "ready" : "FAILED", audioVolume());
  const bool imu_ok = imuBegin(g_settings.imu_hz, g_settings.trigger_enabled);
  const bool cam_ok = cameraBegin(g_settings.cam_xclk_mhz * 1000000u);
  logf("boot", "camera=%s imu=%s speaker=%s", cam_ok ? "ok" : "error", imu_ok ? "ok" : "error", audio_ok ? "ok" : "error");
  greetOnce(reason, short_boots);

  if (g_settings.wifiConfigured()) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(g_settings.wifi_ssid.c_str(), g_settings.wifi_pass.c_str());
    WiFi.setSleep(false);  // baseline setting
    logf("boot", "wi-fi connecting (station only; no access-point fallback)");
  } else {
    logf("boot", "wi-fi not configured");
  }
  if (cloudStart(&g_settings)) {
    logf("boot", "cloud task started");
  } else {
    logf("boot", "cloud disabled (settings incomplete)");
  }
}

void loop() {
  consolePoll();
  if (!g_stable_marked && millis() > kStableUptimeMs) {
    g_stable_marked = true;
    bootCounterStable();
    logf("boot", "stable for %lu s", static_cast<unsigned long>(kStableUptimeMs / 1000));
  }
  if (!cloudRunning()) {  // without the cloud task, local diagnostic bursts are measured and discarded
    Burst* b = nullptr;
    if (cameraPollBurst(&b)) burstFree(b);
  }
  static uint32_t last_wifi_log = 0;
  static wl_status_t last_wifi = WL_IDLE_STATUS;
  if (g_settings.wifiConfigured() && WiFi.status() != last_wifi && millis() - last_wifi_log > 1000) {
    last_wifi = WiFi.status();
    last_wifi_log = millis();
    if (last_wifi == WL_CONNECTED) {
      logf("wifi", "connected ip=%s rssi=%d", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
      logf("wifi", "status %d", static_cast<int>(last_wifi));
    }
  }
  delay(10);
}
