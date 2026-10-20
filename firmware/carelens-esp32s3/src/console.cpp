#include "console.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_crt_bundle.h>
#include <esp_heap_caps.h>
#include <esp_http_client.h>
#include <mbedtls/sha256.h>

#include "audio.h"
#include "camera.h"
#include "cloud.h"
#include "config.h"
#include "devclock.h"
#include "greeting.h"
#include "imu.h"
#include "jpeg.h"
#include "ledger.h"
#include "log.h"
#include "mp3.h"
#include "pcm.h"
#include "textutil.h"
#include "wav.h"

namespace carelens {
namespace {

Settings* g_live = nullptr;
uint32_t g_reconnect_at = 0;  // wifidrop: when to reconnect (0 = not dropped)
Settings g_staged;
bool g_staging = false;
char g_line[4200];
size_t g_len = 0;
bool g_overflow = false;

bool isSecretKey(const String& k) { return k == "pass" || k == "token" || k == "ssid"; }

void reply(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
void reply(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  logf("console", "%s", buf);
}

void submitLocal(const AudioJob& j) {
  if (!audioReady()) {
    reply("ERR audio not ready");
    return;
  }
  if (audioBusy()) {
    reply("ERR audio busy");
    return;
  }
  reply(audioSubmit(j) ? "OK queued %s (result is logged by the audio task)" : "ERR audio queue full", j.tag);
}

void cmdTone(char* args) {
  AudioJob j;
  j.kind = AudioKind::kTone;
  strcpy(j.tag, "local:tone");
  float hz = 1000, amp = 0.9f;
  unsigned long ms = 400, rate = 16000;
  sscanf(args, "%f %lu %lu %f", &hz, &ms, &rate, &amp);
  if (hz < 50 || hz > 8000 || ms < 20 || ms > 5000 || (rate != 16000 && rate != 22050 && rate != 44100 && rate != 48000) || amp <= 0 || amp > 1) {
    reply("ERR usage: tone <hz 50-8000> <ms 20-5000> [rate 16000|22050|44100|48000] [amp 0-1]");
    return;
  }
  j.tone_hz = hz;
  j.tone_ms = ms;
  j.rate = rate;
  j.tone_amp = amp;
  submitLocal(j);
}

void cmdSelftest() {
  int pass = 0, fail = 0;
  auto check = [&](bool ok, const char* name) {
    ok ? pass++ : fail++;
    logf("selftest", "%s %s", ok ? "PASS" : "FAIL", name);
  };
  Mp3Info m;
  check(inspectMp3(kGreetingMp3, kGreetingMp3Len, &m) == Mp3Error::kOk && m.channels == 1 && m.sample_rate == 16000, "greeting mp3 parses (mono 16 kHz)");
  uint8_t sha[32];
  char hex[65];
  mbedtls_sha256(kGreetingMp3, kGreetingMp3Len, sha, 0);
  toHex(sha, 32, hex);
  check(strcmp(hex, CARELENS_GREETING_SHA256) == 0, "greeting asset sha256 matches build");
  {  // decode the whole greeting on the target (no playback): every frame, exact sample count
    void* state = heap_caps_malloc(Mp3Decoder::stateBytes(), MALLOC_CAP_SPIRAM);
    int16_t* pcm = static_cast<int16_t*>(heap_caps_malloc(Mp3Decoder::kMaxPcmSamples * sizeof(int16_t), MALLOC_CAP_SPIRAM));
    bool ok = state && pcm;
    if (ok) {
      Mp3Decoder d;
      d.begin(state, kGreetingMp3, m);
      Mp3Error err = Mp3Error::kOk;
      for (int guard = 0; guard < 10000; guard++) {
        const int n = d.next(pcm, &err);
        if (n <= 0) {
          ok = n == 0;
          break;
        }
      }
      ok = ok && d.framesDecoded() == m.frames && d.pcmFramesDecoded() == m.pcm_frames;
    }
    heap_caps_free(state);
    heap_caps_free(pcm);
    check(ok, "greeting mp3 decodes completely");
  }
  check(m.frames > 1 && inspectMp3(kGreetingMp3, kGreetingMp3Len - 10, &m) == Mp3Error::kTruncatedFrame, "mp3 rejects a truncated stream");
  WavInfo w;
  // FW-1 regression on the target: 512 mono frames into a 256-frame block must not write past it.
  static uint8_t mono[1024];
  static int16_t out[256 * 2 + 4];
  out[512] = out[513] = 0x1234;
  check(pcmToStereo(mono, 512, 1, 0.25f, out, 256) == 256 && out[512] == 0x1234 && out[513] == 0x1234, "pcm block bound (FW-1)");
  uint8_t bad[44] = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ', 0xF0, 0xFF, 0xFF, 0xFF};
  check(parseWav(bad, sizeof bad, &w) == WavError::kChunkTruncated, "wav rejects oversized chunk");
  check(psramFound() && ESP.getPsramSize() >= 7 * 1024 * 1024, "psram present (>= 7 MiB)");
  check(audioReady(), "audio ready");
  check(imuOk() && imuHead() > 0, "imu sampling");
  check(cameraOk(), "camera initialised");
  logf("selftest", "SELFTEST %s %d/%d", fail ? "FAIL" : "PASS", pass, pass + fail);
}

void cmdStatus() {
  ImuSample s{};
  const uint32_t head = imuHead();
  const bool have = head > 0 && imuGet(head - 1, &s);
  reply("fw=%s boot=%s uptime_ms=%llu wall_synced=%d heap_internal=%u psram_free=%u", CARELENS_FW_VERSION, bootId(),
        static_cast<unsigned long long>(uptimeMs()), wallSynced(), static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
        static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));
  reply("audio ready=%d busy=%d volume=%.2f | camera ok=%d failures=%lu | imu ok=%d who=0x%02x rate=%lu samples=%lu errors=%lu skipped=%lu", audioReady(),
        audioBusy(), audioVolume(), cameraOk(), static_cast<unsigned long>(cameraFailures()), imuOk(), imuWhoAmI(), static_cast<unsigned long>(imuRateHz()),
        static_cast<unsigned long>(head), static_cast<unsigned long>(imuReadErrors()), static_cast<unsigned long>(imuSkippedSlots()));
  if (have) {
    reply("imu last t_ms=%llu a=[%.3f %.3f %.3f] g g=[%.1f %.1f %.1f] dps", static_cast<unsigned long long>(s.t_ms), s.ax / kAccelLsbPerG,
          s.ay / kAccelLsbPerG, s.az / kAccelLsbPerG, s.gx / kGyroLsbPerDps, s.gy / kGyroLsbPerDps, s.gz / kGyroLsbPerDps);
  }
  reply("wifi configured=%d status=%d ip=%s | cloud configured=%d", g_live->wifiConfigured(), static_cast<int>(WiFi.status()),
        WiFi.localIP().toString().c_str(), g_live->cloudConfigured());
  if (cloudRunning()) {
    char buf[400];
    cloudStatus(buf, sizeof buf);
    reply("cloud %s", buf);
  }
}

void cmdProvShow(const Settings& s, const char* label) {
  auto secretInfo = [](const String& v) {
    static char b[48];
    if (v.length() == 0) return "unset";
    snprintf(b, sizeof b, "set (%u chars)", static_cast<unsigned>(v.length()));
    return static_cast<const char*>(b);
  };
  reply("%s ssid=%s", label, secretInfo(s.wifi_ssid));
  reply("%s pass=%s", label, secretInfo(s.wifi_pass));
  reply("%s token=%s", label, secretInfo(s.token));
  reply("%s api=%s device=%s ca=%s capint=%lu vol=%.2f trig=%d imuhz=%lu camxclk=%lu", label, s.api_base.length() ? s.api_base.c_str() : "unset",
        s.device_id.length() ? s.device_id.c_str() : "unset", s.ca_pem.length() ? "set" : "bundle", static_cast<unsigned long>(s.capture_interval_s), s.volume,
        s.trigger_enabled, static_cast<unsigned long>(s.imu_hz), static_cast<unsigned long>(s.cam_xclk_mhz));
}

void cmdProv(char* args) {
  char* sub = strtok(args, " ");
  if (!sub) {
    reply("ERR usage: prov show|begin|set <key> <base64>|append <key> <base64>|commit|abort|erase");
    return;
  }
  if (!strcmp(sub, "show")) {
    cmdProvShow(*g_live, "live");
    if (g_staging) cmdProvShow(g_staged, "staged");
    return;
  }
  if (!strcmp(sub, "begin")) {
    g_staged = *g_live;
    g_staging = true;
    reply("OK staging");
    return;
  }
  if (!strcmp(sub, "abort")) {
    g_staging = false;
    reply("OK aborted");
    return;
  }
  if (!strcmp(sub, "erase")) {
    reply(settingsErase() ? "OK erased (reboot to apply)" : "ERR erase failed");
    return;
  }
  if (!g_staging) {
    reply("ERR run 'prov begin' first");
    return;
  }
  if (!strcmp(sub, "commit")) {
    const bool ok = settingsSave(g_staged);
    g_staging = false;
    reply(ok ? "OK committed (reboot to apply)" : "ERR nvs write failed");
    return;
  }
  const bool append = !strcmp(sub, "append");
  if (!append && strcmp(sub, "set") != 0) {
    reply("ERR unknown prov command");
    return;
  }
  char* key = strtok(nullptr, " ");
  char* b64 = strtok(nullptr, " ");
  if (!key) {
    reply("ERR missing key");
    return;
  }
  static uint8_t buf[3200];
  int n = 0;
  if (b64) n = base64Decode(b64, strlen(b64), buf, sizeof buf - 1);
  if (n < 0) {
    reply("ERR %s: bad base64", key);
    return;
  }
  buf[n] = 0;
  String value = String(reinterpret_cast<char*>(buf));
  const String k(key);
  if (append) {
    if (k != "ca") {
      reply("ERR append only for ca");
      return;
    }
    g_staged.ca_pem += value;
    reply("OK ca now %u bytes", static_cast<unsigned>(g_staged.ca_pem.length()));
    return;
  }
  const char* err = settingsValidate(key, value);
  if (err || !settingsApply(&g_staged, key, value)) {
    reply("ERR %s: %s", key, err ? err : "invalid");
    return;
  }
  if (isSecretKey(k)) {
    reply("OK set %s (%u chars)", key, static_cast<unsigned>(value.length()));
  } else {
    reply("OK set %s", key);
  }
}

// One unauthenticated HTTPS GET with full certificate and host-name verification against the ESP-IDF bundle. Reports the
// HTTP status and the time taken; the response body is discarded.
void tlsCheckTask(void* arg) {
  const char* url = static_cast<const char*>(arg);
  esp_http_client_config_t cfg = {};
  cfg.url = url;
  cfg.timeout_ms = 15000;
  cfg.crt_bundle_attach = esp_crt_bundle_attach;
  cfg.disable_auto_redirect = true;
  const uint32_t t0 = millis();
  esp_http_client_handle_t h = esp_http_client_init(&cfg);
  esp_err_t err = h ? esp_http_client_perform(h) : ESP_FAIL;
  const int status = h && err == ESP_OK ? esp_http_client_get_status_code(h) : 0;
  if (h) esp_http_client_cleanup(h);
  logf("console", "tlscheck %s: %s status=%d in %lu ms (certificate verified with the ESP-IDF bundle)", url, err == ESP_OK ? "OK" : esp_err_to_name(err), status,
       static_cast<unsigned long>(millis() - t0));
  vTaskDelete(nullptr);
}

void dispatch(char* line) {
  while (*line == ' ') line++;
  char* args = strchr(line, ' ');
  if (args) *args++ = '\0';
  else args = line + strlen(line);
  logf("console", "> %s", line);  // only the command word; arguments may hold secrets
  if (!strcmp(line, "help")) {
    reply("commands: status | selftest | greet | beep | sweep | tone <hz> <ms> [rate] [amp] | cam | burst | wifidrop <s> | tlscheck <https://host> | prov ... | reboot");
  } else if (!strcmp(line, "status")) {
    cmdStatus();
  } else if (!strcmp(line, "selftest")) {
    cmdSelftest();
  } else if (!strcmp(line, "greet")) {
    AudioJob j;
    const Mp3Error e = greetingJob(&j);
    if (e != Mp3Error::kOk) {
      reply("ERR greeting asset invalid: %s", mp3ErrorCode(e));
      return;
    }
    submitLocal(j);
  } else if (!strcmp(line, "beep")) {  // the baseline's /beep melody, same samples, through the checked write path
    AudioJob j;
    j.kind = AudioKind::kDoReMi;
    strcpy(j.tag, "local:beep");
    j.rate = 16000;
    submitLocal(j);
  } else if (!strcmp(line, "sweep")) {
    AudioJob j;
    j.kind = AudioKind::kSweep;
    strcpy(j.tag, "local:sweep");
    j.tone_ms = 600;
    j.tone_amp = 0.9f;
    j.rate = 16000;
    submitLocal(j);
  } else if (!strcmp(line, "tone")) {
    cmdTone(args);
  } else if (!strcmp(line, "cam")) {
    char out[200];
    const bool ok = cameraProbe(out, sizeof out);
    reply("%s %s", ok ? "OK" : "ERR", out);
  } else if (!strcmp(line, "burst")) {
    if (cloudRunning()) {
      cloudRequestBurst();
      reply("OK burst requested (upload path)");
    } else {
      BurstRequest r;
      snprintf(r.capture_id, sizeof r.capture_id, "cap-%s-local", bootId());
      reply(cameraRequestBurst(r) ? "OK local burst requested (frames are measured then discarded)" : "ERR camera busy");
    }
  } else if (!strcmp(line, "tlscheck")) {  // read-only: GET <https base>/health, no token, verified with the IDF bundle
    static char url[160];
    if (strncmp(args, "https://", 8) != 0 || strlen(args) > 120 || strchr(args, '?') || WiFi.status() != WL_CONNECTED) {
      reply("ERR usage: tlscheck https://host (Wi-Fi must be connected)");
      return;
    }
    snprintf(url, sizeof url, "%s/health", args);
    if (xTaskCreatePinnedToCore(tlsCheckTask, "tlscheck", 12288, url, 1, nullptr, 1) != pdPASS) reply("ERR no task");
  } else if (!strcmp(line, "wifidrop")) {  // test hook: drop Wi-Fi for N seconds, then reconnect (no router change)
    const long secs = strtol(args, nullptr, 10);
    if (secs < 5 || secs > 300 || !g_live->wifiConfigured()) {
      reply("ERR usage: wifidrop <5-300 seconds> (Wi-Fi must be configured)");
      return;
    }
    reply("OK dropping wi-fi for %ld s", secs);
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false, false);
    g_reconnect_at = millis() + static_cast<uint32_t>(secs) * 1000u;
  } else if (!strcmp(line, "prov")) {
    cmdProv(args);
  } else if (!strcmp(line, "reboot")) {
    reply("OK rebooting");
    delay(200);
    ESP.restart();
  } else if (line[0]) {
    reply("ERR unknown command (help)");
  }
}

}  // namespace

void consoleBegin(Settings* live) { g_live = live; }

bool consoleWifiHeld() { return g_reconnect_at != 0; }

void consolePoll() {
  if (g_reconnect_at && static_cast<int32_t>(millis() - g_reconnect_at) >= 0) {
    g_reconnect_at = 0;
    WiFi.setAutoReconnect(true);
    WiFi.begin(g_live->wifi_ssid.c_str(), g_live->wifi_pass.c_str());
    logf("console", "wifidrop over: reconnecting");
  }
  while (Serial0.available()) {
    const int c = Serial0.read();
    if (c < 0) break;
    if (c == '\r') continue;
    if (c == '\n') {
      g_line[g_len] = '\0';
      if (g_overflow) {
        reply("ERR line too long");
      } else {
        dispatch(g_line);
      }
      g_len = 0;
      g_overflow = false;
      continue;
    }
    if (g_len + 1 < sizeof g_line) {
      g_line[g_len++] = static_cast<char>(c);
    } else {
      g_overflow = true;
    }
  }
}

}  // namespace carelens
