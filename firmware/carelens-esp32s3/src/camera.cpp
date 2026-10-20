#include "camera.h"

#include <Arduino.h>
#include <esp_camera.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <mbedtls/sha256.h>
#include <string.h>

#include <new>

#include "devclock.h"
#include "jpeg.h"
#include "log.h"
#include "textutil.h"

namespace carelens {
namespace {

constexpr uint32_t kMinSpacingMs = 110;  // select frames >= 110 ms apart: 125 ms ± 40 ms tolerance on the server
constexpr uint32_t kWakeSettleMs = 300;  // baseline waited 300 ms after waking the sensor (AE/AWB)
constexpr uint32_t kDiscardMs = 200;

bool g_ok = false;
volatile uint32_t g_failures = 0;
QueueHandle_t g_requests = nullptr;
QueueHandle_t g_done = nullptr;
SemaphoreHandle_t g_cam_mutex = nullptr;

void sensorSleep(bool sleep) {
  sensor_t* s = esp_camera_sensor_get();
  if (s) s->set_reg(s, 0x3008, 0xff, sleep ? 0x42 : 0x02);  // OV5640 software power-down / wake (baseline)
}

uint64_t frameMs(const camera_fb_t* fb) {
  const uint64_t ts = static_cast<uint64_t>(fb->timestamp.tv_sec) * 1000ULL + static_cast<uint64_t>(fb->timestamp.tv_usec) / 1000ULL;
  const uint64_t now = uptimeMs();
  // The driver stamps frames with time since boot; fall back to the fetch time if that ever looks wrong.
  return (ts <= now && now - ts < 2000) ? ts : now;
}

void wakeAndSettle() {
  sensorSleep(false);
  vTaskDelay(pdMS_TO_TICKS(kWakeSettleMs));
  const uint32_t until = millis() + kDiscardMs;
  while (millis() < until) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
  }
}

bool captureBurst(Burst* b, uint16_t want) {
  xSemaphoreTake(g_cam_mutex, portMAX_DELAY);
  wakeAndSettle();
  uint64_t last = 0;
  uint32_t misses = 0;
  const uint32_t deadline = millis() + want * 300u;
  b->count = 0;
  b->max_interval_ms = 0;
  b->min_interval_ms = UINT32_MAX;
  bool ok = true;
  while (b->count < want) {
    if (millis() > deadline) {
      ok = false;
      logf("camera", "burst timeout after %u frames", b->count);
      break;
    }
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      if (++misses > 5) {
        ok = false;
        logf("camera", "no frame from driver");
        break;
      }
      continue;
    }
    const uint64_t t = frameMs(fb);
    if (b->count > 0 && t < last + kMinSpacingMs) {
      esp_camera_fb_return(fb);
      continue;
    }
    JpegInfo info;
    if (fb->format != PIXFORMAT_JPEG || fb->len > kMaxFrameBytes || !inspectJpeg(fb->buf, fb->len, &info)) {
      logf("camera", "frame rejected (len=%u), aborting burst to keep it continuous", static_cast<unsigned>(fb->len));
      esp_camera_fb_return(fb);
      ok = false;
      break;
    }
    if (b->count == 0) {
      b->width = info.width;
      b->height = info.height;
    } else if (info.width != b->width || info.height != b->height) {
      esp_camera_fb_return(fb);
      ok = false;
      break;
    }
    Frame& f = b->frames[b->count];
    f.data = static_cast<uint8_t*>(heap_caps_malloc(fb->len, MALLOC_CAP_SPIRAM));
    if (!f.data) {
      esp_camera_fb_return(fb);
      ok = false;
      logf("camera", "psram allocation failed");
      break;
    }
    memcpy(f.data, fb->buf, fb->len);
    f.len = fb->len;
    f.t_ms = t;
    esp_camera_fb_return(fb);
    mbedtls_sha256(f.data, f.len, f.sha256, 0);
    if (b->count > 0) {
      const uint32_t gap = static_cast<uint32_t>(t - last);
      if (gap > b->max_interval_ms) b->max_interval_ms = gap;
      if (gap < b->min_interval_ms) b->min_interval_ms = gap;
    }
    last = t;
    b->count++;
  }
  sensorSleep(true);
  xSemaphoreGive(g_cam_mutex);
  if (b->min_interval_ms == UINT32_MAX) b->min_interval_ms = 0;
  return ok && b->count == want;
}

void cameraTask(void*) {
  BurstRequest r;
  for (;;) {
    if (xQueueReceive(g_requests, &r, portMAX_DELAY) != pdTRUE) continue;
    Burst* b = static_cast<Burst*>(heap_caps_calloc(1, sizeof(Burst), MALLOC_CAP_SPIRAM));
    if (!b) {
      g_failures = g_failures + 1;
      continue;
    }
    new (b) Burst();
    strncpy(b->capture_id, r.capture_id, sizeof b->capture_id - 1);
    strncpy(b->trigger_id, r.trigger_id, sizeof b->trigger_id - 1);
    b->triggered = r.triggered;
    const uint16_t want = r.triggered ? kFramesTriggered : kFramesNormal;
    const uint32_t t0 = millis();
    const bool ok = captureBurst(b, want);
    logf("camera", "burst %s %s: %u/%u frames %ux%u interval %lu-%lu ms in %lu ms", b->capture_id, ok ? "ok" : "FAILED", b->count, want, b->width,
         b->height, static_cast<unsigned long>(b->min_interval_ms), static_cast<unsigned long>(b->max_interval_ms),
         static_cast<unsigned long>(millis() - t0));
    if (!ok) {
      g_failures = g_failures + 1;
      burstFree(b);
      continue;
    }
    if (xQueueSend(g_done, &b, 0) != pdTRUE) {
      logf("camera", "upload queue full, burst %s dropped", b->capture_id);
      burstFree(b);
    }
  }
}

}  // namespace

bool cameraBegin(uint32_t xclk_hz) {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = CL_PIN_Y2;
  c.pin_d1 = CL_PIN_Y3;
  c.pin_d2 = CL_PIN_Y4;
  c.pin_d3 = CL_PIN_Y5;
  c.pin_d4 = CL_PIN_Y6;
  c.pin_d5 = CL_PIN_Y7;
  c.pin_d6 = CL_PIN_Y8;
  c.pin_d7 = CL_PIN_Y9;
  c.pin_xclk = CL_PIN_XCLK;
  c.pin_pclk = CL_PIN_PCLK;
  c.pin_vsync = CL_PIN_VSYNC;
  c.pin_href = CL_PIN_HREF;
  c.pin_sccb_sda = CL_PIN_SIOD;
  c.pin_sccb_scl = CL_PIN_SIOC;
  c.pin_pwdn = -1;
  c.pin_reset = -1;
  c.xclk_freq_hz = static_cast<int>(xclk_hz == 20000000 ? 20000000 : CL_CAM_XCLK_HZ);
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_VGA;
  c.jpeg_quality = CL_CAM_JPEG_QUALITY;
  c.fb_count = 2;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  const esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    logf("camera", "init FAILED 0x%x", static_cast<unsigned>(err));
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();  // same image settings as the baseline
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_gainceiling(s, GAINCEILING_4X);
  s->set_lenc(s, 1);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  g_cam_mutex = xSemaphoreCreateMutex();
  g_requests = xQueueCreate(1, sizeof(BurstRequest));
  g_done = xQueueCreate(1, sizeof(Burst*));
  if (!g_cam_mutex || !g_requests || !g_done) return false;
  sensorSleep(true);
  if (xTaskCreatePinnedToCore(cameraTask, "camera", 6144, nullptr, 2, nullptr, 0) != pdPASS) return false;
  g_ok = true;
  logf("camera", "ov5640 ready (VGA JPEG q%d, XCLK %d MHz, sensor sleeping between bursts)", CL_CAM_JPEG_QUALITY, c.xclk_freq_hz / 1000000);
  return true;
}

bool cameraOk() { return g_ok; }
uint32_t cameraFailures() { return g_failures; }

bool cameraRequestBurst(const BurstRequest& r) { return g_ok && xQueueSend(g_requests, &r, 0) == pdTRUE; }

bool cameraPollBurst(Burst** out) { return g_done && xQueueReceive(g_done, out, 0) == pdTRUE; }

void burstFree(Burst* b) {
  if (!b) return;
  for (auto& f : b->frames) {
    if (f.data) heap_caps_free(f.data);
    f.data = nullptr;
  }
  heap_caps_free(b);
}

bool cameraProbe(char* out, size_t cap) {
  if (!g_ok) {
    snprintf(out, cap, "camera not initialised");
    return false;
  }
  if (xSemaphoreTake(g_cam_mutex, pdMS_TO_TICKS(8000)) != pdTRUE) {
    snprintf(out, cap, "camera busy");
    return false;
  }
  wakeAndSettle();
  camera_fb_t* fb = esp_camera_fb_get();
  bool ok = false;
  if (!fb) {
    snprintf(out, cap, "no frame");
  } else {
    JpegInfo info;
    const bool valid = fb->format == PIXFORMAT_JPEG && inspectJpeg(fb->buf, fb->len, &info);
    uint8_t sha[32];
    mbedtls_sha256(fb->buf, fb->len, sha, 0);
    char hex[65];
    toHex(sha, 32, hex);
    hex[12] = '\0';
    snprintf(out, cap, "jpeg_valid=%d size=%u dims=%ux%u t_ms=%llu sha256_prefix=%s", valid ? 1 : 0, static_cast<unsigned>(fb->len), info.width,
             info.height, static_cast<unsigned long long>(frameMs(fb)), hex);
    ok = valid;
    esp_camera_fb_return(fb);  // the image is discarded here; it is never stored or transmitted by the probe
  }
  sensorSleep(true);
  xSemaphoreGive(g_cam_mutex);
  return ok;
}

}  // namespace carelens
