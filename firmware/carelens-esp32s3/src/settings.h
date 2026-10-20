// Device configuration in NVS (namespace "carelens"), written only through the UART provisioning console
// (tools/provision.py). Nothing here is compiled into the firmware image, so the .bin carries no Wi-Fi password and
// no device token. The values are not encrypted at rest (NVS encryption needs flash encryption, not enabled on this
// board): physical access to the flash exposes them.
#pragma once

#include <Arduino.h>

namespace carelens {

struct Settings {
  String wifi_ssid;
  String wifi_pass;
  String api_base;   // "https://host[:port]", no trailing slash; plain http is refused
  String device_id;  // must match the device credential
  String token;      // cld_… device token (never logged)
  String ca_pem;     // optional trust anchor (local test CA); empty = ESP-IDF certificate bundle
  uint32_t capture_interval_s = 0;  // periodic normal bursts; 0 = off
  float volume = 0.25f;
  bool trigger_enabled = true;
  uint32_t imu_hz = 50;
  uint32_t cam_xclk_mhz = 20;  // 20 (default) or 10 (baseline): the OV5640 frame period, hence the burst cadence, scales with it

  bool wifiConfigured() const { return wifi_ssid.length() > 0; }
  bool cloudConfigured() const { return wifiConfigured() && api_base.length() > 0 && device_id.length() > 0 && token.length() > 0; }
};

bool settingsLoad(Settings* s);
bool settingsSave(const Settings& s);
bool settingsErase();
bool settingsSaveVolume(float volume);  // the volume set remotely survives a reboot

// Validates one provisioning value; returns nullptr if valid, else a short error code.
const char* settingsValidate(const char* key, const String& value);
bool settingsApply(Settings* s, const char* key, const String& value);

// Boot-loop guard for the greeting: counts boots that did not reach the stable uptime.
uint8_t bootCounterEnter();  // returns the count of consecutive short boots before this one
void bootCounterStable();

}  // namespace carelens
