#include "audio.h"

#include <Arduino.h>
#include <ESP_I2S.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <string.h>

#include "config.h"
#include "log.h"
#include "mp3.h"
#include "pcm.h"

namespace carelens {
namespace {

constexpr size_t kBlockFrames = 256;  // one I2S write = 256 stereo frames = 1024 bytes
constexpr uint32_t kDrainMs = 150;    // > DMA depth (6 x 240 frames = 90 ms at 16 kHz) so the tail is clocked out
constexpr uint32_t kMp3OverrunMs = 5000;  // a stream may take at most its own duration + 5 s to play out
constexpr uint32_t kAudioTaskStack = 8192;

// MP3 decoder state (~23 KB incl. scratch) and one decoded frame (4.6 KB): PSRAM, allocated once at the first MP3 job so
// internal RAM stays with Wi-Fi and TLS (CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC).
void* g_mp3_state = nullptr;
int16_t* g_mp3_pcm = nullptr;
Mp3PlayStats g_mp3_stats;
TaskHandle_t g_task = nullptr;

I2SClass g_i2s;
bool g_i2s_ok = false;
uint32_t g_rate = 0;
volatile bool g_ready = false;
volatile bool g_stop = false;
volatile bool g_busy = false;
volatile float g_volume = kDefaultVolume;
QueueHandle_t g_jobs = nullptr;
QueueHandle_t g_events = nullptr;

struct Outcome {
  AudioEventKind kind;
  const char* reason;
  uint32_t frames;
};

bool isLocal(const char* tag) { return strncmp(tag, "local:", 6) == 0; }

void post(AudioEventKind kind, const char* tag, const char* reason, uint32_t frames) {
  if (isLocal(tag)) return;  // console/greeting jobs only log
  AudioEvent ev{};
  ev.kind = kind;
  strncpy(ev.tag, tag, sizeof ev.tag - 1);
  strncpy(ev.reason, reason ? reason : "", sizeof ev.reason - 1);
  ev.frames_written = frames;
  if (xQueueSend(g_events, &ev, pdMS_TO_TICKS(100)) != pdTRUE) logf("audio", "event queue full, dropped %d for %s", static_cast<int>(kind), tag);
}

bool ensureRate(uint32_t rate) {
  if (g_i2s_ok && rate == g_rate) return true;
  if (g_i2s_ok) g_i2s.end();
  g_i2s.setPins(CL_I2S_BCLK, CL_I2S_LRC, CL_I2S_DIN);
  g_i2s_ok = g_i2s.begin(I2S_MODE_STD, rate, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH);
  g_rate = g_i2s_ok ? rate : 0;
  logf("audio", "i2s %s at %lu Hz", g_i2s_ok ? "configured" : "CONFIG FAILED", static_cast<unsigned long>(rate));
  return g_i2s_ok;
}

bool writeBlock(const int16_t* stereo, size_t frames) {
  const size_t want = frames * 4;
  const size_t got = g_i2s.write(reinterpret_cast<const uint8_t*>(stereo), want);
  return got == want;
}

bool writeSilence(uint32_t ms) {
  static int16_t zero[kBlockFrames * 2] = {0};
  uint32_t frames = static_cast<uint32_t>(static_cast<uint64_t>(g_rate) * ms / 1000);
  while (frames > 0) {
    const size_t n = frames < kBlockFrames ? frames : kBlockFrames;
    if (!writeBlock(zero, n)) return false;
    frames -= n;
  }
  return true;
}

// Writes frames from a producer callback. `fill` returns frames written into the block (0 = end of sound).
template <typename Fill>
Outcome stream(const char* tag, uint32_t rate, Fill fill, bool& started, uint32_t& total) {
  if (!ensureRate(rate)) return {AudioEventKind::kFailed, "i2s_config_failed", total};
  int16_t block[kBlockFrames * 2];
  for (;;) {
    if (g_stop) {
      writeSilence(20);
      return {AudioEventKind::kStopped, "stopped", total};
    }
    const size_t n = fill(block, kBlockFrames);
    if (n == 0) break;
    if (!writeBlock(block, n)) return {AudioEventKind::kFailed, "i2s_write_short", total};
    total += n;
    if (!started) {
      started = true;
      post(AudioEventKind::kStarted, tag, nullptr, total);
    }
  }
  return {AudioEventKind::kFinished, nullptr, total};
}

Outcome silenceFor(uint32_t ms) {
  const uint32_t step = 20;
  for (uint32_t t = 0; t < ms; t += step) {
    if (g_stop) return {AudioEventKind::kStopped, "stopped", 0};
    if (!writeSilence(step)) return {AudioEventKind::kFailed, "i2s_write_short", 0};
  }
  return {AudioEventKind::kFinished, nullptr, 0};
}

Outcome toneOnce(const char* tag, float hz, uint32_t ms, float amp, uint32_t rate, bool& started, uint32_t& total, uint32_t ramp = 0) {
  ToneGen gen(hz, rate, static_cast<uint32_t>(static_cast<uint64_t>(rate) * ms / 1000), amp, ramp ? ramp : rate / 200);
  const float vol = g_volume;
  return stream(tag, rate, [&](int16_t* b, size_t cap) { return gen.next(b, cap, vol); }, started, total);
}

bool ensureMp3Buffers() {
  if (!g_mp3_state) g_mp3_state = heap_caps_malloc(Mp3Decoder::stateBytes(), MALLOC_CAP_SPIRAM);
  if (!g_mp3_pcm) g_mp3_pcm = static_cast<int16_t*>(heap_caps_malloc(Mp3Decoder::kMaxPcmSamples * sizeof(int16_t), MALLOC_CAP_SPIRAM));
  return g_mp3_state && g_mp3_pcm;
}

// Decodes one MP3 frame at a time and writes it in kBlockFrames blocks, so the stop flag is seen within one block
// (16 ms at 16 kHz, 6 ms at 44.1 kHz) and memory use does not depend on the file. The I2S rate follows the stream.
Outcome playMp3(const AudioJob& j, bool& started, uint32_t& total) {
  g_mp3_stats = Mp3PlayStats();
  g_mp3_stats.stream_ms = j.mp3.durationMs();
  if (!ensureMp3Buffers()) return {AudioEventKind::kFailed, "mp3_no_memory", total};
  if (!ensureRate(j.mp3.sample_rate)) return {AudioEventKind::kFailed, "i2s_config_failed", total};
  Mp3Decoder dec;
  dec.begin(g_mp3_state, j.data, j.mp3);
  const float vol = g_volume;
  const size_t stride = static_cast<size_t>(j.mp3.channels) * 2;
  const uint32_t t0 = millis();
  int16_t block[kBlockFrames * 2];
  for (;;) {
    if (g_stop) {
      writeSilence(20);
      return {AudioEventKind::kStopped, "stopped", total};
    }
    const uint32_t d0 = micros();
    Mp3Error err;
    const int n = dec.next(g_mp3_pcm, &err);
    const uint32_t du = micros() - d0;
    g_mp3_stats.decode_us_total += du;
    if (du > g_mp3_stats.decode_us_max) g_mp3_stats.decode_us_max = du;
    g_mp3_stats.frames = dec.framesDecoded();
    g_mp3_stats.skipped = dec.framesSkipped();
    if (n < 0) return {AudioEventKind::kFailed, mp3ErrorCode(err), total};
    if (n == 0) break;
    const uint8_t* src = reinterpret_cast<const uint8_t*>(g_mp3_pcm);
    size_t pos = 0;
    while (pos < static_cast<size_t>(n)) {
      if (g_stop) {
        writeSilence(20);
        return {AudioEventKind::kStopped, "stopped", total};
      }
      const size_t k = pcmToStereo(src + pos * stride, static_cast<size_t>(n) - pos, j.mp3.channels, vol, block, kBlockFrames);
      if (k == 0 || !writeBlock(block, k)) return {AudioEventKind::kFailed, "i2s_write_short", total};
      pos += k;
      total += k;
      if (!started) {
        started = true;
        post(AudioEventKind::kStarted, j.tag, nullptr, total);
      }
    }
    if (millis() - t0 > g_mp3_stats.stream_ms + kMp3OverrunMs) return {AudioEventKind::kFailed, "mp3_overlong", total};
  }
  return {AudioEventKind::kFinished, nullptr, total};
}

Outcome run(const AudioJob& j) {
  bool started = false;
  uint32_t total = 0;
  Outcome o{AudioEventKind::kFinished, nullptr, 0};
  switch (j.kind) {
    case AudioKind::kMp3:
      o = playMp3(j, started, total);
      break;
    case AudioKind::kPcm: {
      size_t pos = 0;
      const size_t stride = static_cast<size_t>(j.channels) * 2;
      const float vol = g_volume;
      o = stream(j.tag, j.rate, [&](int16_t* b, size_t cap) {
        const size_t n = pcmToStereo(j.data + pos * stride, j.frames - pos, j.channels, vol, b, cap);
        pos += n;
        return n;
      }, started, total);
      break;
    }
    case AudioKind::kTone:
      o = toneOnce(j.tag, j.tone_hz, j.tone_ms, j.tone_amp, j.rate, started, total);
      break;
    case AudioKind::kSweep: {  // diagnostic: same amplitude at frequencies the speaker reproduces differently
      static const float kHz[] = {262.0f, 523.0f, 1000.0f, 2000.0f};
      for (float hz : kHz) {
        logf("audio", "sweep %.0f Hz", hz);
        o = toneOnce(j.tag, hz, j.tone_ms, j.tone_amp, j.rate, started, total);
        if (o.kind != AudioEventKind::kFinished) break;
        o = silenceFor(700);
        if (o.kind != AudioEventKind::kFinished) break;
      }
      break;
    }
    case AudioKind::kDoReMi: {  // exactly the baseline /beep: 262, 294, 330 Hz x 300 ms, 300-sample ramps, peak 30000
      static const float kHz[] = {262.0f, 294.0f, 330.0f};
      for (float hz : kHz) {
        o = toneOnce(j.tag, hz, 300, 30000.0f / 32767.0f, 16000, started, total, 300);
        if (o.kind != AudioEventKind::kFinished) break;
      }
      break;
    }
    case AudioKind::kChime: {  // reminder without a recording: three soft tones
      static const float kHz[] = {880.0f, 1175.0f, 1568.0f};
      for (float hz : kHz) {
        o = toneOnce(j.tag, hz, 220, 0.6f, j.rate, started, total);
        if (o.kind != AudioEventKind::kFinished) break;
        o = silenceFor(120);
        if (o.kind != AudioEventKind::kFinished) break;
      }
      break;
    }
    case AudioKind::kBuzzer: {
      const uint32_t period = j.on_ms + j.off_ms;
      for (uint32_t t = 0; period > 0 && t + j.on_ms <= j.total_ms; t += period) {
        o = toneOnce(j.tag, 2000.0f, j.on_ms, 0.9f, j.rate, started, total);
        if (o.kind != AudioEventKind::kFinished) break;
        o = silenceFor(j.off_ms);
        if (o.kind != AudioEventKind::kFinished) break;
      }
      break;
    }
  }
  if (o.kind == AudioEventKind::kFinished && !writeSilence(kDrainMs)) o = {AudioEventKind::kFailed, "i2s_write_short", total};
  if (o.kind == AudioEventKind::kFinished && !started) o = {AudioEventKind::kFailed, "nothing_played", total};
  o.frames = total;
  return o;
}

void audioTask(void*) {
  AudioJob job;
  for (;;) {
    if (xQueueReceive(g_jobs, &job, portMAX_DELAY) != pdTRUE) continue;
    g_stop = false;
    g_busy = true;
    const uint32_t t0 = millis();
    const Outcome o = run(job);
    g_busy = false;
    logf("audio", "job %s kind=%d rate=%lu frames_written=%lu result=%s%s%s ms=%lu", job.tag, static_cast<int>(job.kind),
         static_cast<unsigned long>(g_rate), static_cast<unsigned long>(o.frames),
         o.kind == AudioEventKind::kFinished ? "finished" : o.kind == AudioEventKind::kStopped ? "stopped" : "FAILED", o.reason ? " " : "",
         o.reason ? o.reason : "", static_cast<unsigned long>(millis() - t0));
    if (job.kind == AudioKind::kMp3) {
      g_mp3_stats.play_ms = millis() - t0;
      g_mp3_stats.stack_free_bytes = static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr));
      const Mp3PlayStats& s = g_mp3_stats;
      logf("audio", "mp3 %s: %lu Hz %u ch %lu bytes, %lu frames (%lu skipped), stream %lu ms, played %lu ms, decode %lu ms total (%.1f%% of stream), max %lu us/frame, stack free %lu",
           job.tag, static_cast<unsigned long>(job.mp3.sample_rate), job.mp3.channels, static_cast<unsigned long>(job.bytes),
           static_cast<unsigned long>(s.frames), static_cast<unsigned long>(s.skipped), static_cast<unsigned long>(s.stream_ms),
           static_cast<unsigned long>(s.play_ms), static_cast<unsigned long>(s.decode_us_total / 1000),
           s.stream_ms ? s.decode_us_total / 10.0 / s.stream_ms : 0.0, static_cast<unsigned long>(s.decode_us_max),
           static_cast<unsigned long>(s.stack_free_bytes));
    }
    post(o.kind, job.tag, o.reason, o.frames);
  }
}

}  // namespace

bool audioBegin(float volume) {
  audioSetVolume(volume);
  g_jobs = xQueueCreate(2, sizeof(AudioJob));
  g_events = xQueueCreate(8, sizeof(AudioEvent));
  if (!g_jobs || !g_events) return false;
  if (!ensureRate(16000)) return false;
  if (!writeSilence(20)) {
    logf("audio", "initial silence write failed");
    return false;
  }
  if (xTaskCreatePinnedToCore(audioTask, "audio", kAudioTaskStack, nullptr, 4, &g_task, 1) != pdPASS) return false;
  g_ready = true;
  return true;
}

bool audioReady() { return g_ready; }
void audioSetVolume(float v) { g_volume = v < 0.0f ? 0.0f : v > kMaxVolume ? kMaxVolume : v; }
float audioVolume() { return g_volume; }

bool audioSubmit(const AudioJob& job) {
  if (!g_ready) return false;
  return xQueueSend(g_jobs, &job, 0) == pdTRUE;
}

void audioStop() { g_stop = true; }
bool audioBusy() { return g_busy || (g_jobs && uxQueueMessagesWaiting(g_jobs) > 0); }

bool audioPollEvent(AudioEvent* ev, uint32_t wait_ms) {
  return g_events && xQueueReceive(g_events, ev, pdMS_TO_TICKS(wait_ms)) == pdTRUE;
}

Mp3PlayStats audioLastMp3Stats() { return g_mp3_stats; }

}  // namespace carelens
