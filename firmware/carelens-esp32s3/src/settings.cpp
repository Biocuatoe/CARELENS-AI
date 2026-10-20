#include "settings.h"

#include <Preferences.h>

#include "textutil.h"

namespace carelens {
namespace {
constexpr const char* kNs = "carelens";
constexpr const char* kBootNs = "clboot";
}  // namespace

bool settingsLoad(Settings* s) {
  Preferences p;
  if (!p.begin(kNs, true)) return false;  // read-only; fails when the namespace was never written
  s->wifi_ssid = p.getString("ssid", "");
  s->wifi_pass = p.getString("pass", "");
  s->api_base = p.getString("api", "");
  s->device_id = p.getString("dev", "");
  s->token = p.getString("tok", "");
  s->ca_pem = p.getString("ca", "");
  s->capture_interval_s = p.getUInt("capint", 0);
  s->volume = p.getFloat("vol", 0.25f);
  s->trigger_enabled = p.getBool("trig", true);
  s->imu_hz = p.getUInt("imuhz", 50);
  s->cam_xclk_mhz = p.getUInt("camxclk", 20);
  p.end();
  return true;
}

bool settingsSave(const Settings& s) {
  Preferences p;
  if (!p.begin(kNs, false)) return false;
  bool ok = true;
  ok &= p.putString("ssid", s.wifi_ssid) == s.wifi_ssid.length();
  ok &= p.putString("pass", s.wifi_pass) == s.wifi_pass.length();
  ok &= p.putString("api", s.api_base) == s.api_base.length();
  ok &= p.putString("dev", s.device_id) == s.device_id.length();
  ok &= p.putString("tok", s.token) == s.token.length();
  ok &= p.putString("ca", s.ca_pem) == s.ca_pem.length();
  ok &= p.putUInt("capint", s.capture_interval_s) > 0;
  ok &= p.putFloat("vol", s.volume) > 0;
  ok &= p.putBool("trig", s.trigger_enabled) > 0;
  ok &= p.putUInt("imuhz", s.imu_hz) > 0;
  ok &= p.putUInt("camxclk", s.cam_xclk_mhz) > 0;
  p.end();
  return ok;
}

bool settingsErase() {
  Preferences p;
  if (!p.begin(kNs, false)) return false;
  const bool ok = p.clear();
  p.end();
  return ok;
}

const char* settingsValidate(const char* key, const String& v) {
  const String k(key);
  if (k == "ssid") return v.length() >= 1 && v.length() <= 32 ? nullptr : "ssid_length";
  if (k == "pass") return v.length() == 0 || (v.length() >= 8 && v.length() <= 63) ? nullptr : "pass_length";
  if (k == "api") {
    if (!v.startsWith("https://")) return "api_must_be_https";
    if (v.length() > 120 || v.indexOf('?') >= 0 || v.indexOf('#') >= 0 || v.indexOf(' ') >= 0) return "api_invalid";
    return nullptr;
  }
  if (k == "device") return isRecordId(v.c_str(), 64) ? nullptr : "device_id_invalid";
  if (k == "token") {
    if (!v.startsWith("cld_") || v.length() > 200) return "token_invalid";
    for (size_t i = 0; i < v.length(); i++) {
      const char c = v[i];
      if (!(isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-')) return "token_invalid";
    }
    return nullptr;
  }
  if (k == "ca") return v.length() == 0 || (v.indexOf("-----BEGIN CERTIFICATE-----") >= 0 && v.length() < 3900) ? nullptr : "ca_invalid";
  if (k == "capint") return v.toInt() == 0 || (v.toInt() >= 60 && v.toInt() <= 86400) ? nullptr : "capint_range";
  if (k == "vol") return v.toFloat() >= 0.0f && v.toFloat() <= 0.7f ? nullptr : "vol_range";
  if (k == "trig") return v == "0" || v == "1" ? nullptr : "trig_bool";
  if (k == "imuhz") return v.toInt() == 25 || v.toInt() == 50 || v.toInt() == 100 ? nullptr : "imuhz_value";
  if (k == "camxclk") return v.toInt() == 10 || v.toInt() == 20 ? nullptr : "camxclk_value";
  return "unknown_key";
}

bool settingsApply(Settings* s, const char* key, const String& v) {
  if (settingsValidate(key, v) != nullptr) return false;
  const String k(key);
  if (k == "ssid") s->wifi_ssid = v;
  else if (k == "pass") s->wifi_pass = v;
  else if (k == "api") s->api_base = v.endsWith("/") ? v.substring(0, v.length() - 1) : v;
  else if (k == "device") s->device_id = v;
  else if (k == "token") s->token = v;
  else if (k == "ca") s->ca_pem = v;
  else if (k == "capint") s->capture_interval_s = static_cast<uint32_t>(v.toInt());
  else if (k == "vol") s->volume = v.toFloat();
  else if (k == "trig") s->trigger_enabled = v == "1";
  else if (k == "imuhz") s->imu_hz = static_cast<uint32_t>(v.toInt());
  else if (k == "camxclk") s->cam_xclk_mhz = static_cast<uint32_t>(v.toInt());
  return true;
}

bool settingsSaveVolume(float volume) {
  Preferences p;
  if (!p.begin(kNs, false)) return false;
  const bool ok = p.putFloat("vol", volume) > 0;
  p.end();
  return ok;
}

uint8_t bootCounterEnter() {
  Preferences p;
  if (!p.begin(kBootNs, false)) return 0;
  const uint8_t n = p.getUChar("short", 0);
  p.putUChar("short", n < 250 ? n + 1 : n);
  p.end();
  return n;
}

void bootCounterStable() {
  Preferences p;
  if (!p.begin(kBootNs, false)) return;
  p.putUChar("short", 0);
  p.end();
}

}  // namespace carelens
