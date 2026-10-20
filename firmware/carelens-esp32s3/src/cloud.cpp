#include "cloud.h"

#include <Preferences.h>
#include <WiFi.h>
#include <cJSON.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <mbedtls/sha256.h>
#include <stdio.h>
#include <math.h>
#include <string.h>

#include "audio.h"
#include "camera.h"
#include "config.h"
#include "console.h"
#include "devclock.h"
#include "https.h"
#include "imu.h"
#include "ledger.h"
#include "log.h"
#include "mp3.h"
#include "textutil.h"
#include "wav.h"

namespace carelens {
namespace {

constexpr uint32_t kHeartbeatMs = 60000;
constexpr uint32_t kPollIdleMs = 5000;
constexpr uint32_t kPollActiveMs = 2000;
constexpr uint32_t kImuBatchMs = 10000;
constexpr uint32_t kImuMaxBatch = 600;
constexpr size_t kRespCap = 8192;
constexpr size_t kBodyCap = 64 * 1024;
constexpr uint32_t kRangeBytes = 64 * 1024;
constexpr uint32_t kDownloadBaseMs = 30000;          // ADR-022: 30 s + size / AUDIO_DOWNLOAD_MIN_BYTES_PER_SECOND
constexpr uint32_t kMinDownloadBytesPerS = 16000;
constexpr const char* kCmdPrefix = "/api/device/v1/commands/";
constexpr const char* kCapPrefix = "/api/device/v1/captures/";

enum class Report : uint8_t { kOk, kStop, kRetry, kDrop, kUnsupported };
enum class Phase : uint8_t { kIdle, kDownloading, kPlaying };
enum class StopWhy : uint8_t { kNone, kCancel, kPreempt, kServer };

struct Command {
  char id[LedgerEntry::kIdLen];
  char kind[16];
  int priority;
  uint64_t deadline_ms;
  char status_path[160];
  bool has_audio;
  char audio_path[160];
  uint32_t audio_bytes;
  char audio_sha[65];
  uint32_t audio_rate;
  uint16_t audio_channels;
  bool audio_mp3;               // audio/mpeg + mp3 (ADR-025); false = legacy audio/wav + pcm_s16le
  uint32_t audio_duration_ms;   // from the server's metadata; the downloaded bytes must agree
  uint32_t buzz_total_ms, buzz_on_ms, buzz_off_ms;
};

struct Active {
  Phase phase = Phase::kIdle;
  Command cmd{};
  uint8_t* audio = nullptr;
  uint32_t downloaded = 0;
  uint64_t download_deadline_ms = 0;
  uint64_t next_try_ms = 0;
  uint32_t retries = 0;
  mbedtls_sha256_context sha;
  bool sha_active = false;
  bool started_reported = false;
  StopWhy stop = StopWhy::kNone;
};

const Settings* g_cfg = nullptr;
Https g_http;
CommandLedger g_ledger;
Active g_act;
char* g_body = nullptr;    // PSRAM, request bodies
char* g_resp = nullptr;    // PSRAM, response bodies
volatile bool g_running = false;
volatile bool g_manual_burst = false;
bool g_ready = false;      // time synced and first heartbeat answered
bool g_auth_failed = false;
bool g_server_has_received = true;
bool g_server_sends_config = false;   // the heartbeat response carries config: report the applied volume back
bool next_report_volume_now = false;  // send a heartbeat soon so the dashboard sees the applied volume
bool g_server_wants_codecs = false;   // heartbeat response config.report_audio_codecs: report what this firmware plays (ADR-025)
char g_last_error[64] = "";
int g_last_status = 0;
uint32_t g_wifi_drops = 0;
uint32_t g_imu_seq = 0;
uint32_t g_imu_next = 0;
uint32_t g_imu_sent = 0;
uint32_t g_bursts_uploaded = 0;
uint32_t g_capture_n = 0;
uint32_t g_trigger_n = 0;
uint32_t g_commands_completed = 0;
uint64_t g_imu_pause_until = 0;

void setError(const char* code) {
  strncpy(g_last_error, code, sizeof g_last_error - 1);
  g_last_error[sizeof g_last_error - 1] = '\0';
}

/* ------------------------------------------------------------------ ledger persistence */

void ledgerSave() {
  static uint8_t blob[CommandLedger::kBlobSize];
  const size_t n = g_ledger.serialize(blob, sizeof blob);
  Preferences p;
  if (n && p.begin("clcmd", false)) {
    p.putBytes("ledger", blob, n);
    p.end();
  }
}

void ledgerLoad() {
  static uint8_t blob[CommandLedger::kBlobSize];
  Preferences p;
  size_t n = 0;
  if (p.begin("clcmd", true)) {
    n = p.getBytes("ledger", blob, sizeof blob);
    p.end();
  }
  if (n && !g_ledger.deserialize(blob, n)) logf("cloud", "command ledger corrupt, starting empty");
  logf("cloud", "command ledger: %u entries", static_cast<unsigned>(g_ledger.size()));
}

void setState(LedgerEntry* e, CmdState s, const char* reason) {
  if (!e) return;
  e->state = s;
  strncpy(e->reason, reason ? reason : "", sizeof e->reason - 1);
  ledgerSave();
}

/* ------------------------------------------------------------------ JSON helpers */

const char* jstr(const cJSON* o, const char* k) {
  const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, k);
  return cJSON_IsString(v) ? v->valuestring : nullptr;
}
bool jnum(const cJSON* o, const char* k, double* out) {
  const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, k);
  if (!cJSON_IsNumber(v)) return false;
  *out = v->valuedouble;
  return true;
}
bool jtrue(const cJSON* o, const char* k) { return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(o, k)); }

// "code" of an application/problem+json error, for last_error. Never copies free text.
void problemCode(const char* body, char* out, size_t cap) {
  out[0] = '\0';
  cJSON* j = cJSON_Parse(body);
  if (!j) return;
  const char* c = jstr(j, "code");
  if (c && isRecordId(c, 48)) strncpy(out, c, cap - 1);
  cJSON_Delete(j);
}

/* ------------------------------------------------------------------ HTTP wrappers */

HttpResult postJson(const char* path, size_t len) {
  HttpResult r = g_http.request(HTTP_METHOD_POST, path, "application/json", reinterpret_cast<const uint8_t*>(g_body), len,
                                reinterpret_cast<uint8_t*>(g_resp), kRespCap);
  g_last_status = r.status;
  if (r.status == 401) {
    if (!g_auth_failed) logf("cloud", "device token rejected (401): stopping requests until re-provisioned");
    g_auth_failed = true;
  }
  return r;
}

int clockField(char* out, size_t cap) {
  char clock[192];
  if (clockJson(clock, sizeof clock) < 0) return -1;
  const int n = snprintf(out, cap, "\"clock\":%s", clock);
  return n > 0 && static_cast<size_t>(n) < cap ? n : -1;
}

/* ------------------------------------------------------------------ heartbeat */

bool heartbeat(uint32_t* pending) {
  char clock[220];
  if (clockField(clock, sizeof clock) < 0) return false;
  char err[80] = "null";
  if (g_last_error[0]) snprintf(err, sizeof err, "\"%s\"", g_last_error);
  const char* cam = cameraOk() ? "ok" : "error";
  const char* imu = imuOk() ? "ok" : "error";
  const char* spk = audioReady() ? "ok" : "error";
  const int rssi = WiFi.RSSI();
  char vol[96] = "";
  // Only a server that sends config knows status.speaker_volume, and only one that asks knows status.audio_codecs (an
  // older one refuses unknown fields).
  if (g_server_sends_config) {
    snprintf(vol, sizeof vol, ",\"speaker_volume\":%.2f%s", audioVolume(), g_server_wants_codecs ? ",\"audio_codecs\":[\"pcm_s16le\",\"mp3\"]" : "");
  }
  const int n = snprintf(g_body, kBodyCap,
                         "{\"schema_version\":\"device-heartbeat.v2\",\"device_id\":\"%s\",%s,\"firmware_version\":\"%s\","
                         "\"status\":{\"camera\":\"%s\",\"imu\":\"%s\",\"speaker\":\"%s\",\"wifi_rssi_dbm\":%d,\"free_heap_bytes\":%u,\"last_error\":%s%s}}",
                         g_cfg->device_id.c_str(), clock, CARELENS_FW_VERSION, cam, imu, spk, rssi < 0 && rssi >= -127 ? rssi : -127,
                         static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)), err, vol);
  const HttpResult r = postJson("/api/device/v1/heartbeat", static_cast<size_t>(n));
  if (!r.ok()) {
    char code[48];
    problemCode(g_resp, code, sizeof code);
    logf("cloud", "heartbeat failed: status=%d %s", r.status, code);
    return false;
  }
  g_last_error[0] = '\0';
  cJSON* j = cJSON_Parse(g_resp);
  double p = 0;
  if (j && jnum(j, "pending_commands", &p) && pending) *pending = static_cast<uint32_t>(p);
  const cJSON* config = j ? cJSON_GetObjectItemCaseSensitive(j, "config") : nullptr;
  if (cJSON_IsObject(config)) {
    const bool first = !g_server_sends_config;
    g_server_sends_config = true;
    double v = -1;
    if (jnum(config, "speaker_volume", &v) && v >= kMinRemoteVolume - 1e-6 && v <= kMaxVolume + 1e-6) {
      const float target = static_cast<float>(v);
      if (fabsf(target - audioVolume()) > 0.004f) {
        const float before = audioVolume();
        audioSetVolume(target);
        const bool saved = settingsSaveVolume(audioVolume());
        logf("cloud", "speaker volume %.2f -> %.2f (set by the server%s)", before, audioVolume(), saved ? ", saved" : ", NOT saved");
      }
    }
    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(config, "report_audio_codecs")) && !g_server_wants_codecs) {
      g_server_wants_codecs = true;
      next_report_volume_now = true;  // tell the server what this firmware plays without waiting a full minute
    }
    if (first) next_report_volume_now = true;
  }
  const cJSON* ck = j ? cJSON_GetObjectItemCaseSensitive(j, "clock") : nullptr;
  const cJSON* issues = ck ? cJSON_GetObjectItemCaseSensitive(ck, "issues") : nullptr;
  logf("cloud", "heartbeat ok: pending_commands=%.0f clock_issues=%d rssi=%d", p, issues ? cJSON_GetArraySize(issues) : 0, rssi);
  cJSON_Delete(j);
  return true;
}

/* ------------------------------------------------------------------ command status */

Report postStatusOnce(const char* id, const char* path, const char* status, const char* reason, const char* detail) {
  char clock[220];
  if (clockField(clock, sizeof clock) < 0) return Report::kRetry;
  char det[220] = "null";
  if (detail && detail[0] && jsonQuote(detail, det, sizeof det) < 0) strcpy(det, "null");
  char rsn[48] = "null";
  if (reason && reason[0]) snprintf(rsn, sizeof rsn, "\"%s\"", reason);
  const int n = snprintf(g_body, kBodyCap, "{\"schema_version\":\"command-status.v2\",\"device_id\":\"%s\",%s,\"status\":\"%s\",\"reason_code\":%s,\"detail\":%s}",
                         g_cfg->device_id.c_str(), clock, status, rsn, det);
  const HttpResult r = postJson(path, static_cast<size_t>(n));
  if (r.ok()) {
    cJSON* j = cJSON_Parse(g_resp);
    const bool dup = j && jtrue(j, "duplicate");
    cJSON_Delete(j);
    logf("cmd", "%s -> %s%s%s%s", id, status, reason ? " " : "", reason ? reason : "", dup ? " (duplicate)" : "");
    return Report::kOk;
  }
  if (r.transport() || r.status >= 500 || r.status == 429 || r.status == 401) return Report::kRetry;
  char code[48];
  problemCode(g_resp, code, sizeof code);
  logf("cmd", "%s -> %s refused: %d %s", id, status, r.status, code);
  if (r.status == 409) {
    cJSON* j = cJSON_Parse(g_resp);
    const bool stop = j && jtrue(j, "stop_playback");
    cJSON_Delete(j);
    return stop ? Report::kStop : Report::kDrop;
  }
  if (r.status == 404) return Report::kStop;
  if (r.status == 422) return Report::kUnsupported;
  return Report::kDrop;
}

// Up to three attempts (1 s, 2 s backoff). On 422 for codes an older server does not know, falls back once.
Report postStatus(LedgerEntry* e, const char* path, CmdState st, const char* reason, const char* detail) {
  const char* status = cmdStateWire(st);
  Report rep = Report::kRetry;
  for (int attempt = 0; attempt < 3; attempt++) {
    if (attempt) vTaskDelay(pdMS_TO_TICKS(1000u << (attempt - 1)));
    rep = postStatusOnce(e ? e->id : "?", path, status, reason, detail);
    if (rep == Report::kUnsupported && reason && (strcmp(reason, "device_rebooted") == 0 || strcmp(reason, "download_timeout") == 0)) {
      rep = postStatusOnce(e ? e->id : "?", path, status, "other", reason);
    }
    if (rep != Report::kRetry) break;
  }
  if (e && rep == Report::kOk) {
    e->reported = st;
    ledgerSave();
  }
  return rep;
}

void statusPathFor(const char* id, char* out, size_t cap) { snprintf(out, cap, "%s%s/status", kCmdPrefix, id); }

/* ------------------------------------------------------------------ command parsing */

const char* parseCommand(const cJSON* c, Command* out) {
  *out = Command{};
  const char* id = jstr(c, "command_id");
  const char* sp = jstr(c, "status_path");
  double exp = -1, pr = 0;
  if (!id || !isRecordId(id, LedgerEntry::kIdLen - 1)) return "bad_command_id";
  strncpy(out->id, id, sizeof out->id - 1);
  if (!sp || !isSafeDevicePath(sp, kCmdPrefix, sizeof out->status_path - 1)) return "bad_status_path";
  strncpy(out->status_path, sp, sizeof out->status_path - 1);
  if (!jnum(c, "expires_in_ms", &exp) || exp < 0) return "bad_expiry";
  jnum(c, "priority", &pr);
  out->priority = static_cast<int>(pr);
  out->deadline_ms = uptimeMs() + static_cast<uint64_t>(exp);
  const cJSON* action = cJSON_GetObjectItemCaseSensitive(c, "action");
  const char* kind = action ? jstr(action, "kind") : nullptr;
  if (!kind) return "bad_action";
  strncpy(out->kind, kind, sizeof out->kind - 1);
  if (strcmp(kind, "buzzer") == 0) {
    double d = 30000, on = 500, off = 500;
    jnum(action, "duration_ms", &d);
    jnum(action, "beep_on_ms", &on);
    jnum(action, "beep_off_ms", &off);
    out->buzz_total_ms = static_cast<uint32_t>(d > 0 && d <= 60000 ? d : 30000);
    out->buzz_on_ms = static_cast<uint32_t>(on > 0 && on <= 5000 ? on : 500);
    out->buzz_off_ms = static_cast<uint32_t>(off >= 0 && off <= 5000 ? off : 500);
  }
  const cJSON* audio = action ? cJSON_GetObjectItemCaseSensitive(action, "audio") : nullptr;
  if (cJSON_IsObject(audio)) {
    const char* path = jstr(audio, "path");
    const char* sha = jstr(audio, "sha256");
    const char* ct = jstr(audio, "content_type");
    const char* codec = jstr(audio, "codec");
    double bytes = 0, rate = 0, ch = 0, bits = 0, dur = 0;
    jnum(audio, "byte_size", &bytes);
    jnum(audio, "sample_rate_hz", &rate);
    jnum(audio, "channels", &ch);
    jnum(audio, "bits_per_sample", &bits);
    jnum(audio, "duration_ms", &dur);
    if (!path || !isSafeDevicePath(path, kCmdPrefix, sizeof out->audio_path - 1)) return "bad_audio_path";
    if (!sha || strlen(sha) != 64) return "bad_audio_sha";
    for (const char* p = sha; *p; p++) {
      if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f'))) return "bad_audio_sha";
    }
    // Two formats only, named by the server; anything else is refused before a byte is downloaded.
    const bool mp3 = ct && strcmp(ct, "audio/mpeg") == 0 && codec && strcmp(codec, "mp3") == 0;
    const bool wav = ct && strcmp(ct, "audio/wav") == 0 && codec && strcmp(codec, "pcm_s16le") == 0 && bits == 16;
    if (!mp3 && !wav) return "audio_format_unsupported";
    if (ch < 1 || ch > 2 || rate < 8000 || rate > 48000 || bytes < (mp3 ? 4 : 44) || bytes > (mp3 ? kMp3MaxBytes : kAudioMaxBytes)) {
      return "audio_format_unsupported";
    }
    if (mp3 && (dur <= 0 || dur > kAudioMaxDurationMs)) return "audio_format_unsupported";
    out->has_audio = true;
    strncpy(out->audio_path, path, sizeof out->audio_path - 1);
    strncpy(out->audio_sha, sha, sizeof out->audio_sha - 1);
    out->audio_bytes = static_cast<uint32_t>(bytes);
    out->audio_rate = static_cast<uint32_t>(rate);
    out->audio_channels = static_cast<uint16_t>(ch);
    out->audio_mp3 = mp3;
    out->audio_duration_ms = static_cast<uint32_t>(dur);
  }
  return nullptr;
}

/* ------------------------------------------------------------------ command execution */

void freeActive() {
  if (g_act.audio) heap_caps_free(g_act.audio);
  if (g_act.sha_active) mbedtls_sha256_free(&g_act.sha);
  g_act = Active();
}

// Reports a final state for the active command and returns to idle.
void finishActive(CmdState st, const char* reason, const char* detail) {
  LedgerEntry* e = g_ledger.find(g_act.cmd.id);
  setState(e, st, reason);
  postStatus(e, g_act.cmd.status_path, st, reason, detail);
  if (st == CmdState::kCompleted) g_commands_completed++;
  freeActive();
}

// Stops playback and waits for the audio task to confirm (bounded).
void stopPlaybackAndWait() {
  audioStop();
  AudioEvent ev;
  const uint32_t until = millis() + 3000;
  while (millis() < until) {
    if (audioPollEvent(&ev, 100) && strcmp(ev.tag, g_act.cmd.id) == 0 && ev.kind != AudioEventKind::kStarted) return;
  }
  logf("cmd", "audio did not confirm stop within 3 s");
}

void endActiveFor(StopWhy why) {
  const bool playing = g_act.phase == Phase::kPlaying;
  if (playing) stopPlaybackAndWait();
  if (why == StopWhy::kCancel) {
    finishActive(CmdState::kCancelled, "cancel_requested", nullptr);
  } else if (why == StopWhy::kPreempt) {
    finishActive(playing ? CmdState::kFailed : CmdState::kRejected, "preempted_by_higher_priority", nullptr);
  } else {  // the server already holds a final state (409 stop_playback / 404): nothing to report
    setState(g_ledger.find(g_act.cmd.id), CmdState::kFailed, "stopped_by_server");
    LedgerEntry* e = g_ledger.find(g_act.cmd.id);
    if (e) {
      e->reported = e->state;
      ledgerSave();
    }
    freeActive();
  }
}

void play(const AudioJob& job) {
  LedgerEntry* e = g_ledger.find(g_act.cmd.id);
  // accepted must be acknowledged before anything is played: otherwise the server could time the command out
  // while the speaker plays it, and its final state would be untruthful.
  const Report a = postStatus(e, g_act.cmd.status_path, CmdState::kAccepted, nullptr, nullptr);
  if (a == Report::kStop || a == Report::kDrop) {
    endActiveFor(StopWhy::kServer);
    return;
  }
  if (a != Report::kOk) {
    // Not reported: the server times the command out on its own (failed download_timeout), which is truthful.
    logf("cmd", "%s: accepted not acknowledged, not playing", g_act.cmd.id);
    setState(e, CmdState::kFailed, "accepted_not_acknowledged");
    if (e) {
      e->reported = e->state;
      ledgerSave();
    }
    freeActive();
    return;
  }
  setState(e, CmdState::kAccepted, nullptr);
  if (uptimeMs() > g_act.cmd.deadline_ms) {
    finishActive(CmdState::kRejected, "expired_on_device", nullptr);
    return;
  }
  setState(e, CmdState::kStarted, nullptr);  // persisted before the first sample: a reboot can never replay it
  if (!audioSubmit(job)) {
    finishActive(CmdState::kFailed, "playback_error", "audio_queue_unavailable");
    return;
  }
  g_act.phase = Phase::kPlaying;
}

void audioJobForActive(AudioJob* j) {
  *j = AudioJob();
  strncpy(j->tag, g_act.cmd.id, sizeof j->tag - 1);
  j->rate = 16000;
}

void startCommand(const Command& c) {
  g_act = Active();
  g_act.cmd = c;
  LedgerEntry* e = g_ledger.upsert(c.id);
  if (!e) return;
  setState(e, CmdState::kReceived, nullptr);
  if (g_server_has_received) {
    const Report r = postStatus(e, c.status_path, CmdState::kReceived, nullptr, nullptr);
    if (r == Report::kUnsupported) {
      g_server_has_received = false;  // pre-ADR-022 server: continue with the original lifecycle
      logf("cloud", "server does not accept 'received'; using delivered -> accepted only");
    } else if (r == Report::kStop) {
      endActiveFor(StopWhy::kServer);
      return;
    }
  }
  if (uptimeMs() > c.deadline_ms) {
    finishActive(CmdState::kRejected, "expired_on_device", nullptr);
    return;
  }
  AudioJob job;
  audioJobForActive(&job);
  if (c.has_audio && (strcmp(c.kind, "voice") == 0 || strcmp(c.kind, "reminder") == 0)) {
    g_act.audio = static_cast<uint8_t*>(heap_caps_malloc(c.audio_bytes, MALLOC_CAP_SPIRAM));
    if (!g_act.audio) {
      finishActive(CmdState::kRejected, "busy", "no_memory");
      return;
    }
    mbedtls_sha256_init(&g_act.sha);
    mbedtls_sha256_starts(&g_act.sha, 0);
    g_act.sha_active = true;
    const uint64_t budget = kDownloadBaseMs + static_cast<uint64_t>(c.audio_bytes) * 1000ULL / kMinDownloadBytesPerS;
    g_act.download_deadline_ms = uptimeMs() + budget < c.deadline_ms ? uptimeMs() + budget : c.deadline_ms;
    g_act.phase = Phase::kDownloading;
    logf("cmd", "%s: downloading %lu bytes (budget %llu ms)", c.id, static_cast<unsigned long>(c.audio_bytes),
         static_cast<unsigned long long>(g_act.download_deadline_ms - uptimeMs()));
    return;
  }
  if (strcmp(c.kind, "voice") == 0) {
    finishActive(CmdState::kRejected, "audio_download_failed", "no_audio_in_command");
    return;
  }
  if (strcmp(c.kind, "reminder") == 0) {
    job.kind = AudioKind::kChime;
  } else if (strcmp(c.kind, "buzzer") == 0) {
    job.kind = AudioKind::kBuzzer;
    job.on_ms = c.buzz_on_ms;
    job.off_ms = c.buzz_off_ms;
    job.total_ms = c.buzz_total_ms;
  } else {
    finishActive(CmdState::kRejected, "unsupported_command", nullptr);
    return;
  }
  play(job);
}

void downloadStep() {
  Active& a = g_act;
  const uint64_t now = uptimeMs();
  if (now > a.cmd.deadline_ms) {
    finishActive(CmdState::kRejected, "expired_on_device", "during_download");
    return;
  }
  if (now > a.download_deadline_ms) {
    finishActive(CmdState::kFailed, "audio_download_failed", "download_deadline");
    return;
  }
  if (now < a.next_try_ms) return;
  const uint32_t start = a.downloaded;
  const uint32_t len = a.cmd.audio_bytes - start < kRangeBytes ? a.cmd.audio_bytes - start : kRangeBytes;
  char range[48];
  snprintf(range, sizeof range, "bytes=%lu-%lu", static_cast<unsigned long>(start), static_cast<unsigned long>(start + len - 1));
  const HttpResult r = g_http.request(HTTP_METHOD_GET, a.cmd.audio_path, nullptr, nullptr, 0, a.audio + start, len, range, 20000);
  g_last_status = r.status;
  char expect[64];
  snprintf(expect, sizeof expect, "bytes %lu-%lu/%lu", static_cast<unsigned long>(start), static_cast<unsigned long>(start + len - 1),
           static_cast<unsigned long>(a.cmd.audio_bytes));
  if (r.status == 206 && r.body_len == len && !r.body_truncated && strcmp(r.content_range, expect) == 0) {
    mbedtls_sha256_update(&a.sha, a.audio + start, len);
    a.downloaded += len;
    a.retries = 0;
  } else if (r.status == 404) {  // the command is no longer active on the server (expired/cancelled)
    logf("cmd", "%s: audio 404, command no longer active", a.cmd.id);
    endActiveFor(StopWhy::kServer);
    return;
  } else if (r.status == 410) {
    finishActive(CmdState::kFailed, "audio_download_failed", "audio_deleted");
    return;
  } else if (r.status == 401 || r.status == 403) {
    finishActive(CmdState::kFailed, "audio_download_failed", "not_authorised");
    return;
  } else {
    a.retries++;
    logf("cmd", "%s: range %s failed (status %d, %u bytes), retry %lu", a.cmd.id, range, r.status, static_cast<unsigned>(r.body_len),
         static_cast<unsigned long>(a.retries));
    if (a.retries > 6) {
      finishActive(CmdState::kFailed, "audio_download_failed", "range_retries_exhausted");
      return;
    }
    a.next_try_ms = now + (1000ULL << (a.retries < 5 ? a.retries : 5));
    return;
  }
  if (a.downloaded < a.cmd.audio_bytes) return;

  uint8_t digest[32];
  mbedtls_sha256_finish(&a.sha, digest);
  mbedtls_sha256_free(&a.sha);
  a.sha_active = false;
  char hex[65];
  toHex(digest, 32, hex);
  if (strcmp(hex, a.cmd.audio_sha) != 0) {
    logf("cmd", "%s: sha256 mismatch", a.cmd.id);
    finishActive(CmdState::kRejected, "audio_integrity_failed", "sha256_mismatch");
    return;
  }
  if (a.cmd.audio_mp3) {
    // The bytes the server hashed must also be the stream it described: one rate, one layout, whole frames, same length.
    Mp3Info m;
    const Mp3Error me = inspectMp3(a.audio, a.cmd.audio_bytes, &m);
    const uint32_t ms = m.durationMs();
    const char* why = me != Mp3Error::kOk ? mp3ErrorCode(me)
                      : m.sample_rate != a.cmd.audio_rate || m.channels != a.cmd.audio_channels ||
                              (ms > a.cmd.audio_duration_ms ? ms - a.cmd.audio_duration_ms : a.cmd.audio_duration_ms - ms) > 2
                          ? "metadata_mismatch"
                      : ms > kAudioMaxDurationMs ? "mp3_too_long"
                                                 : nullptr;
    if (why) {
      finishActive(CmdState::kRejected, "audio_format_unsupported", why);
      return;
    }
    logf("cmd", "%s: audio verified (sha256 ok, mp3 %lu ms, %u ch, %lu Hz, %lu frames, %u-%u kbps)", a.cmd.id, static_cast<unsigned long>(ms),
         m.channels, static_cast<unsigned long>(m.sample_rate), static_cast<unsigned long>(m.frames), m.min_kbps, m.max_kbps);
    AudioJob job;
    audioJobForActive(&job);
    job.kind = AudioKind::kMp3;
    job.data = a.audio;
    job.bytes = a.cmd.audio_bytes;
    job.mp3 = m;
    job.channels = m.channels;
    job.rate = m.sample_rate;
    play(job);
    return;
  }
  WavInfo w;
  const WavError e = parseWav(a.audio, a.cmd.audio_bytes, &w);
  if (e != WavError::kOk || w.channels != a.cmd.audio_channels || w.sample_rate != a.cmd.audio_rate) {
    finishActive(CmdState::kRejected, "audio_format_unsupported", e != WavError::kOk ? wavErrorCode(e) : "metadata_mismatch");
    return;
  }
  logf("cmd", "%s: audio verified (sha256 ok, %lu ms, %u ch, %lu Hz)", a.cmd.id, static_cast<unsigned long>(w.durationMs()), w.channels,
       static_cast<unsigned long>(w.sample_rate));
  AudioJob job;
  audioJobForActive(&job);
  job.kind = AudioKind::kPcm;
  job.data = a.audio + w.data_offset;
  job.frames = w.frames();
  job.channels = w.channels;
  job.rate = w.sample_rate;
  play(job);
}

void handleAudioEvents() {
  AudioEvent ev;
  while (audioPollEvent(&ev, 0)) {
    if (g_act.phase != Phase::kPlaying || strcmp(ev.tag, g_act.cmd.id) != 0) continue;
    LedgerEntry* e = g_ledger.find(g_act.cmd.id);
    switch (ev.kind) {
      case AudioEventKind::kStarted: {
        const Report r = postStatus(e, g_act.cmd.status_path, CmdState::kStarted, nullptr, nullptr);
        g_act.started_reported = r == Report::kOk;
        if (r == Report::kStop) {
          audioStop();
          g_act.stop = StopWhy::kServer;
        }
        break;
      }
      case AudioEventKind::kFinished:
        finishActive(CmdState::kCompleted, nullptr, nullptr);
        return;
      case AudioEventKind::kFailed:
        finishActive(CmdState::kFailed, "playback_error", ev.reason);
        return;
      case AudioEventKind::kStopped:
        if (g_act.stop == StopWhy::kServer) {
          endActiveFor(StopWhy::kServer);
        } else {
          finishActive(CmdState::kFailed, "playback_error", "stopped");
        }
        return;
    }
  }
}

void handleCancels(const cJSON* ids) {
  const cJSON* it = nullptr;
  cJSON_ArrayForEach(it, ids) {
    if (!cJSON_IsString(it) || !isRecordId(it->valuestring, LedgerEntry::kIdLen - 1)) continue;
    const char* id = it->valuestring;
    if (g_act.phase != Phase::kIdle && strcmp(id, g_act.cmd.id) == 0) {
      logf("cmd", "%s: cancel requested", id);
      endActiveFor(StopWhy::kCancel);
      continue;
    }
    LedgerEntry* e = g_ledger.upsert(id);
    if (e && !isFinal(e->state)) {
      setState(e, CmdState::kCancelled, "cancel_requested");
      char path[160];
      statusPathFor(id, path, sizeof path);
      postStatus(e, path, CmdState::kCancelled, "cancel_requested", nullptr);
    }
  }
}

void handleDelivered(const Command& c) {
  LedgerEntry* e = g_ledger.find(c.id);
  const bool active_now = g_act.phase != Phase::kIdle && strcmp(g_act.cmd.id, c.id) == 0;
  switch (decideDelivery(e, active_now)) {
    case DeliveryAction::kIgnore:
      return;
    case DeliveryAction::kResendFinal:
      logf("cmd", "%s: delivered again after it finished; reporting %s again", c.id, cmdStateWire(e->state));
      postStatus(e, c.status_path, e->state, e->reason[0] ? e->reason : nullptr, "redelivered_after_final");
      return;
    case DeliveryAction::kFailNotReplay:
      logf("cmd", "%s: was started before a restart; never replayed", c.id);
      setState(e, CmdState::kFailed, "device_rebooted");
      postStatus(e, c.status_path, CmdState::kFailed, "device_rebooted", nullptr);
      return;
    case DeliveryAction::kProcess:
      break;
  }
  if (g_act.phase != Phase::kIdle) {
    if (c.priority > g_act.cmd.priority) {
      logf("cmd", "%s preempts %s", c.id, g_act.cmd.id);
      endActiveFor(StopWhy::kPreempt);
    } else {
      LedgerEntry* n = g_ledger.upsert(c.id);
      setState(n, CmdState::kRejected, "busy");
      postStatus(n, c.status_path, CmdState::kRejected, "busy", nullptr);
      return;
    }
  }
  startCommand(c);
}

bool pollCommands() {
  const HttpResult r = g_http.request(HTTP_METHOD_GET, "/api/device/v1/commands/next", nullptr, nullptr, 0, reinterpret_cast<uint8_t*>(g_resp), kRespCap);
  g_last_status = r.status;
  if (r.status == 204) return true;
  if (!r.ok()) {
    if (r.status == 401) g_auth_failed = true;
    return false;
  }
  cJSON* j = cJSON_Parse(g_resp);
  if (!j) {
    setError("commands_bad_json");
    return false;
  }
  const cJSON* cancels = cJSON_GetObjectItemCaseSensitive(j, "cancel_command_ids");
  if (cJSON_IsArray(cancels)) handleCancels(cancels);
  const cJSON* c = cJSON_GetObjectItemCaseSensitive(j, "command");
  if (cJSON_IsObject(c)) {
    Command cmd;
    const char* bad = parseCommand(c, &cmd);
    if (bad) {
      logf("cmd", "unusable command (%s)", bad);
      if (cmd.id[0] && cmd.status_path[0]) {
        LedgerEntry* e = g_ledger.upsert(cmd.id);
        const char* reason = strcmp(bad, "audio_format_unsupported") == 0 ? "audio_format_unsupported" : "unsupported_command";
        setState(e, CmdState::kRejected, reason);
        postStatus(e, cmd.status_path, CmdState::kRejected, reason, bad);
      }
    } else {
      logf("cmd", "delivered %s kind=%s priority=%d audio=%s expires_in=%llu ms", cmd.id, cmd.kind, cmd.priority, cmd.has_audio ? "yes" : "no",
           static_cast<unsigned long long>(cmd.deadline_ms - uptimeMs()));
      handleDelivered(cmd);
    }
  }
  cJSON_Delete(j);
  return true;
}

// Final states the server has not acknowledged yet (e.g. lost before a reboot) are reported first, then any command
// that was playing when the device restarted is reported failed: it is never replayed.
void flushLedger(bool after_boot) {
  for (size_t i = 0; i < CommandLedger::kCapacity; i++) {
    LedgerEntry& e = const_cast<LedgerEntry&>(g_ledger.at(i));
    if (e.state == CmdState::kNone || e.reported == e.state) continue;
    if (g_act.phase != Phase::kIdle && strcmp(e.id, g_act.cmd.id) == 0) continue;  // in progress right now
    char path[160];
    statusPathFor(e.id, path, sizeof path);
    if (isFinal(e.state)) {
      if (postStatus(&e, path, e.state, e.reason[0] ? e.reason : nullptr, "reported_after_restart") != Report::kRetry) {
        e.reported = e.state;
        ledgerSave();
      }
    } else if (after_boot && e.state == CmdState::kStarted) {
      setState(&e, CmdState::kFailed, "device_rebooted");
      if (postStatus(&e, path, CmdState::kFailed, "device_rebooted", nullptr) != Report::kRetry) {
        e.reported = e.state;
        ledgerSave();
      }
    }
  }
}

/* ------------------------------------------------------------------ IMU */

// Sends one batch. Returns true when more samples are already waiting (a backlog after an outage), so the caller sends the
// next batch right away instead of falling further behind real time.
bool imuBatchStep() {
  if (!imuOk() || uptimeMs() < g_imu_pause_until) return false;
  const uint32_t head = imuHead();
  if (g_imu_next < imuOldest()) {
    logf("imu", "ring overrun: %lu samples not sent", static_cast<unsigned long>(imuOldest() - g_imu_next));
    g_imu_next = imuOldest();
  }
  if (head <= g_imu_next) return false;
  const uint32_t count = head - g_imu_next < kImuMaxBatch ? head - g_imu_next : kImuMaxBatch;
  // Build the columns from a consistent copy of the samples.
  static ImuSample* buf = nullptr;
  if (!buf) buf = static_cast<ImuSample*>(heap_caps_malloc(sizeof(ImuSample) * kImuMaxBatch, MALLOC_CAP_SPIRAM));
  if (!buf) return false;
  uint32_t n = 0;
  for (uint32_t i = 0; i < count; i++) {
    if (!imuGet(g_imu_next + i, &buf[n])) break;
    n++;
  }
  if (n == 0) return false;
  char clock[220];
  if (clockField(clock, sizeof clock) < 0) return false;
  size_t len = static_cast<size_t>(snprintf(g_body, kBodyCap,
                                            "{\"schema_version\":\"imu-batch.v1\",\"source_mode\":\"device\",\"device_id\":\"%s\",%s,\"batch_seq\":%lu,"
                                            "\"sensor\":\"mpu6050\",\"sample_rate_hz\":%lu,\"accel_range_g\":%d,\"gyro_range_dps\":%d,"
                                            "\"units\":{\"time\":\"ms_since_boot\",\"accel\":\"g\",\"gyro\":\"deg_per_s\"},\"samples\":{",
                                            g_cfg->device_id.c_str(), clock, static_cast<unsigned long>(g_imu_seq), static_cast<unsigned long>(imuRateHz()),
                                            kAccelRangeG, kGyroRangeDps));
  static const char* kCols[] = {"uptime_ms", "ax", "ay", "az", "gx", "gy", "gz"};
  for (int col = 0; col < 7 && len < kBodyCap - 64; col++) {
    len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "%s\"%s\":[", col ? "," : "", kCols[col]));
    for (uint32_t i = 0; i < n && len < kBodyCap - 32; i++) {
      const ImuSample& s = buf[i];
      const char* sep = i ? "," : "";
      int w = 0;
      switch (col) {
        case 0: w = snprintf(g_body + len, kBodyCap - len, "%s%llu", sep, static_cast<unsigned long long>(s.t_ms)); break;
        case 1: w = snprintf(g_body + len, kBodyCap - len, "%s%.4f", sep, s.ax / kAccelLsbPerG); break;
        case 2: w = snprintf(g_body + len, kBodyCap - len, "%s%.4f", sep, s.ay / kAccelLsbPerG); break;
        case 3: w = snprintf(g_body + len, kBodyCap - len, "%s%.4f", sep, s.az / kAccelLsbPerG); break;
        case 4: w = snprintf(g_body + len, kBodyCap - len, "%s%.2f", sep, s.gx / kGyroLsbPerDps); break;
        case 5: w = snprintf(g_body + len, kBodyCap - len, "%s%.2f", sep, s.gy / kGyroLsbPerDps); break;
        default: w = snprintf(g_body + len, kBodyCap - len, "%s%.2f", sep, s.gz / kGyroLsbPerDps); break;
      }
      len += static_cast<size_t>(w);
    }
    len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "]"));
  }
  len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "}}"));
  if (len >= kBodyCap - 8) {
    logf("imu", "batch body too large");
    return false;
  }
  const HttpResult r = postJson("/api/device/v1/imu-batches", len);
  if (r.ok()) {
    g_imu_next += n;
    g_imu_seq++;
    g_imu_sent += n;
    return imuHead() - g_imu_next >= kImuMaxBatch / 2;
  }
  char code[48];
  problemCode(g_resp, code, sizeof code);
  if (r.status == 507) {
    g_imu_pause_until = uptimeMs() + (r.retry_after_s ? r.retry_after_s : 600) * 1000ULL;
    g_imu_next += n;  // dropped by contract: the budget is exhausted, older raw samples are not kept
    g_imu_seq++;
    setError("imu_storage_budget");
  } else if (!r.transport() && r.status >= 400 && r.status < 500 && r.status != 429 && r.status != 401) {
    logf("imu", "batch %lu refused: %d %s (dropped)", static_cast<unsigned long>(g_imu_seq), r.status, code);
    setError(code[0] ? code : "imu_batch_refused");
    g_imu_next += n;
    g_imu_seq++;
  }  // transport / 5xx / 429: same samples and batch_seq next time (idempotent on the server)
  return false;
}

/* ------------------------------------------------------------------ camera */

bool requestBurst(bool triggered, const char* trigger_id, char* capture_id_out, size_t cap) {
  BurstRequest req;
  req.triggered = triggered;
  snprintf(req.capture_id, sizeof req.capture_id, "cap-%s-%s%lu", bootId(), triggered ? "t" : "n", static_cast<unsigned long>(++g_capture_n));
  if (trigger_id) strncpy(req.trigger_id, trigger_id, sizeof req.trigger_id - 1);
  if (!cameraRequestBurst(req)) return false;
  if (capture_id_out) strncpy(capture_id_out, req.capture_id, cap - 1);
  return true;
}

void triggerStep() {
  ImuTrigger t;
  if (!imuPollTrigger(&t) || !g_cfg->trigger_enabled) return;
  char trigger_id[64], capture_id[64] = {0};
  snprintf(trigger_id, sizeof trigger_id, "trg-%s-%lu", bootId(), static_cast<unsigned long>(++g_trigger_n));
  const bool burst = requestBurst(true, trigger_id, capture_id, sizeof capture_id);
  char clock[220];
  if (clockField(clock, sizeof clock) < 0) return;
  char cap[80] = "null";
  if (burst) snprintf(cap, sizeof cap, "\"%s\"", capture_id);
  const int n = snprintf(g_body, kBodyCap,
                         "{\"schema_version\":\"imu-event.v2\",\"source_mode\":\"device\",\"device_id\":\"%s\",%s,\"trigger\":{\"trigger_id\":\"%s\","
                         "\"trigger_type\":\"impact\",\"triggered_uptime_ms\":%llu,\"firmware_rule_version\":\"%s\",\"capture_id\":%s,"
                         "\"device_metrics\":{\"peak_accel_g\":%.3f}}}",
                         g_cfg->device_id.c_str(), clock, trigger_id, static_cast<unsigned long long>(t.t_ms), kImuRuleVersion, cap, t.peak_g);
  const HttpResult r = postJson("/api/device/v1/imu-events", static_cast<size_t>(n));
  logf("imu", "firmware trigger %s (peak %.2f g, not evidence): event status %d, burst %s", trigger_id, t.peak_g, r.status, burst ? capture_id : "none");
}

bool uploadBurst(Burst* b) {
  // manifest
  char clock[220];
  if (clockField(clock, sizeof clock) < 0) return false;
  size_t len = static_cast<size_t>(snprintf(g_body, kBodyCap,
                                            "{\"schema_version\":\"capture-session.v2\",\"source_mode\":\"device\",\"device_id\":\"%s\",\"capture_id\":\"%s\","
                                            "\"mode\":\"%s\",%s,\"frame_count\":%u,\"nominal_fps\":8,\"content_type\":\"image/jpeg\",\"frame_width\":%u,"
                                            "\"frame_height\":%u,\"frames\":[",
                                            g_cfg->device_id.c_str(), b->capture_id, b->triggered ? "triggered" : "normal", clock, b->count, b->width, b->height));
  for (uint16_t i = 0; i < b->count; i++) {
    char hex[65];
    toHex(b->frames[i].sha256, 32, hex);
    len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "%s{\"seq\":%u,\"uptime_ms\":%llu,\"size_bytes\":%lu,\"sha256\":\"%s\"}", i ? "," : "", i,
                                        static_cast<unsigned long long>(b->frames[i].t_ms), static_cast<unsigned long>(b->frames[i].len), hex));
  }
  if (b->triggered) {
    len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "],\"trigger_id\":\"%s\",\"trigger_frame_index\":0,\"firmware_version\":\"%s\"}",
                                        b->trigger_id, CARELENS_FW_VERSION));
  } else {
    len += static_cast<size_t>(snprintf(g_body + len, kBodyCap - len, "],\"trigger_id\":null,\"trigger_frame_index\":null,\"firmware_version\":\"%s\"}",
                                        CARELENS_FW_VERSION));
  }
  HttpResult r;
  for (int attempt = 0; attempt < 3; attempt++) {
    r = postJson("/api/device/v1/captures", len);
    if (!r.transport() && r.status < 500) break;
    vTaskDelay(pdMS_TO_TICKS(1000u << attempt));
  }
  if (!r.ok()) {
    char code[48];
    problemCode(g_resp, code, sizeof code);
    logf("camera", "manifest %s refused: %d %s", b->capture_id, r.status, code);
    setError(code[0] ? code : "capture_manifest_failed");
    return false;
  }
  cJSON* j = cJSON_Parse(g_resp);
  const cJSON* up = j ? cJSON_GetObjectItemCaseSensitive(j, "upload") : nullptr;
  double k = 0, chunks = 0;
  const char* tmpl = up ? jstr(up, "chunk_path_template") : nullptr;
  const char* done = up ? jstr(up, "complete_path") : nullptr;
  char tmpl_c[160] = {0}, done_c[160] = {0};
  if (up && jnum(up, "frames_per_chunk", &k) && jnum(up, "chunk_count", &chunks) && tmpl && done) {
    strncpy(tmpl_c, tmpl, sizeof tmpl_c - 1);
    strncpy(done_c, done, sizeof done_c - 1);
  }
  cJSON_Delete(j);
  char* idx = strstr(tmpl_c, "{index}");
  if (k < 1 || chunks < 1 || chunks > 40 || !idx || !isSafeDevicePath(done_c, kCapPrefix, sizeof done_c - 1)) {
    setError("capture_upload_plan_invalid");
    return false;
  }
  *idx = '\0';
  const uint32_t fpc = static_cast<uint32_t>(k);
  for (uint32_t c = 0; c < static_cast<uint32_t>(chunks); c++) {
    char path[180];
    snprintf(path, sizeof path, "%s%lu%s", tmpl_c, static_cast<unsigned long>(c), idx + 7);
    if (!isSafeDevicePath(path, kCapPrefix, sizeof path - 1)) return false;
    size_t body_len = 0;
    for (uint32_t f = c * fpc; f < (c + 1) * fpc && f < b->count; f++) body_len += 4 + b->frames[f].len;
    uint8_t* body = static_cast<uint8_t*>(heap_caps_malloc(body_len, MALLOC_CAP_SPIRAM));
    if (!body) return false;
    size_t o = 0;
    for (uint32_t f = c * fpc; f < (c + 1) * fpc && f < b->count; f++) {
      const uint32_t n = b->frames[f].len;
      body[o] = n & 0xFF;
      body[o + 1] = (n >> 8) & 0xFF;
      body[o + 2] = (n >> 16) & 0xFF;
      body[o + 3] = (n >> 24) & 0xFF;
      memcpy(body + o + 4, b->frames[f].data, n);
      o += 4 + n;
    }
    HttpResult cr;
    for (int attempt = 0; attempt < 3; attempt++) {
      cr = g_http.request(HTTP_METHOD_PUT, path, "application/octet-stream", body, body_len, reinterpret_cast<uint8_t*>(g_resp), kRespCap, nullptr, 30000);
      if (!cr.transport() && cr.status < 500) break;
      vTaskDelay(pdMS_TO_TICKS(1000u << attempt));
    }
    heap_caps_free(body);
    if (!cr.ok()) {
      char code[48];
      problemCode(g_resp, code, sizeof code);
      logf("camera", "chunk %lu of %s refused: %d %s", static_cast<unsigned long>(c), b->capture_id, cr.status, code);
      setError(code[0] ? code : "capture_chunk_failed");
      return false;
    }
  }
  for (int attempt = 0; attempt < 3; attempt++) {
    r = g_http.request(HTTP_METHOD_POST, done_c, "application/json", reinterpret_cast<const uint8_t*>("{}"), 2, reinterpret_cast<uint8_t*>(g_resp), kRespCap);
    if (!r.transport() && r.status < 500) break;
    vTaskDelay(pdMS_TO_TICKS(1000u << attempt));
  }
  char code[48];
  problemCode(g_resp, code, sizeof code);
  logf("camera", "burst %s uploaded: complete status %d %s", b->capture_id, r.status, code);
  if (r.ok()) g_bursts_uploaded++;
  return r.ok();
}

/* ------------------------------------------------------------------ task */

bool waitWifi(uint32_t ms) {
  const uint32_t until = millis() + ms;
  while (WiFi.status() != WL_CONNECTED && millis() < until) vTaskDelay(pdMS_TO_TICKS(200));
  return WiFi.status() == WL_CONNECTED;
}

void cloudTask(void*) {
  g_running = true;
  logf("cloud", "starting: api=%s device=%s trust=%s", g_cfg->api_base.c_str(), g_cfg->device_id.c_str(),
       g_cfg->ca_pem.length() ? "provisioned CA" : "ESP-IDF bundle");
  ledgerLoad();
  while (!waitWifi(30000)) logf("cloud", "waiting for wi-fi");
  sntpStart();
  for (int i = 0; !wallSynced(); i++) {  // certificate validity needs the real time
    if (i % 15 == 0) logf("cloud", "waiting for sntp before the first https request");
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
  if (!g_http.begin(g_cfg->api_base.c_str(), g_cfg->token.c_str(), g_cfg->ca_pem.c_str())) {
    logf("cloud", "https client could not start");
    g_running = false;
    vTaskDelete(nullptr);
    return;
  }
  uint64_t next_hb = 0, next_poll = 0, next_imu = uptimeMs() + kImuBatchMs, next_flush = 0, next_capture = 0, auth_retry = 0;
  if (g_cfg->capture_interval_s) next_capture = uptimeMs() + 30000;
  bool was_connected = true;
  for (;;) {
    const uint64_t now = uptimeMs();
    if (WiFi.status() != WL_CONNECTED) {
      if (was_connected) {
        g_wifi_drops++;
        logf("cloud", "wi-fi lost (drop %lu)", static_cast<unsigned long>(g_wifi_drops));
      }
      was_connected = false;
      g_http.reset();
      if (!waitWifi(10000)) {
        if (!consoleWifiHeld()) WiFi.reconnect();  // a wifidrop test keeps it off on purpose
        continue;
      }
    }
    if (!was_connected) {
      logf("cloud", "wi-fi back, rssi %d", WiFi.RSSI());
      was_connected = true;
      next_hb = 0;
    }
    if (g_auth_failed) {
      if (now < auth_retry) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        continue;
      }
      g_auth_failed = false;  // one attempt every 10 minutes
      auth_retry = now + 600000;
    }
    if (!g_ready) {
      flushLedger(true);  // before the first heartbeat of this boot (ADR-022 reboot handling)
      uint32_t pending = 0;
      if (heartbeat(&pending)) {
        g_ready = true;
        next_hb = now + kHeartbeatMs;
        next_poll = 0;
      } else {
        vTaskDelay(pdMS_TO_TICKS(5000));
        continue;
      }
    }
    handleAudioEvents();
    if (next_report_volume_now) {
      next_report_volume_now = false;
      next_hb = now;  // report the applied volume without waiting a full minute
    }
    if (now >= next_hb) {
      uint32_t pending = 0;
      if (heartbeat(&pending) && pending > 0) next_poll = 0;
      next_hb = now + kHeartbeatMs;
    }
    if (now >= next_poll) {
      pollCommands();
      next_poll = uptimeMs() + (g_act.phase == Phase::kIdle ? kPollIdleMs : kPollActiveMs);
    }
    if (g_act.phase == Phase::kDownloading) downloadStep();
    handleAudioEvents();
    triggerStep();
    if (g_manual_burst) {
      g_manual_burst = false;
      char id[64];
      logf("camera", "%s", requestBurst(false, nullptr, id, sizeof id) ? "manual burst requested" : "camera busy");
    }
    if (g_cfg->capture_interval_s && now >= next_capture) {
      requestBurst(false, nullptr, nullptr, 0);
      next_capture = now + g_cfg->capture_interval_s * 1000ULL;
    }
    Burst* b = nullptr;
    if (cameraPollBurst(&b)) {
      uploadBurst(b);
      burstFree(b);
      // Send the raw IMU around the burst soon (window end + ~3 s) instead of at the next 10 s tick, so the fusion
      // decision does not have to wait for it.
      const uint64_t soon = uptimeMs() + 3500;
      if (next_imu > soon) next_imu = soon;
    }
    if (now >= next_imu) {
      const bool backlog = imuBatchStep();
      next_imu = uptimeMs() + (backlog ? 200 : kImuBatchMs);
    }
    if (now >= next_flush) {
      flushLedger(false);
      next_flush = now + 30000;
    }
    vTaskDelay(pdMS_TO_TICKS(g_act.phase == Phase::kDownloading ? 5 : 50));
  }
}

}  // namespace

bool cloudStart(const Settings* cfg) {
  if (!cfg || !cfg->cloudConfigured()) return false;
  g_cfg = cfg;
  g_body = static_cast<char*>(heap_caps_malloc(kBodyCap, MALLOC_CAP_SPIRAM));
  g_resp = static_cast<char*>(heap_caps_malloc(kRespCap, MALLOC_CAP_SPIRAM));
  if (!g_body || !g_resp) return false;
  return xTaskCreatePinnedToCore(cloudTask, "cloud", 16384, nullptr, 2, nullptr, 1) == pdPASS;
}

bool cloudRunning() { return g_running; }
void cloudRequestBurst() { g_manual_burst = true; }

void cloudStatus(char* out, size_t cap) {
  snprintf(out, cap,
           "running=%d ready=%d auth_failed=%d wifi=%d rssi=%d requests=%lu transport_errors=%lu last_status=%d imu_seq=%lu imu_sent=%lu "
           "bursts_uploaded=%lu commands_completed=%lu active=%s phase=%d ledger=%u received_supported=%d last_error=%s",
           g_running, g_ready, g_auth_failed, WiFi.status() == WL_CONNECTED, WiFi.RSSI(), static_cast<unsigned long>(g_http.requests()),
           static_cast<unsigned long>(g_http.transportErrors()), g_last_status, static_cast<unsigned long>(g_imu_seq), static_cast<unsigned long>(g_imu_sent),
           static_cast<unsigned long>(g_bursts_uploaded), static_cast<unsigned long>(g_commands_completed), g_act.phase == Phase::kIdle ? "-" : g_act.cmd.id,
           static_cast<int>(g_act.phase), static_cast<unsigned>(g_ledger.size()), g_server_has_received, g_last_error[0] ? g_last_error : "-");
}

}  // namespace carelens
