#include "imu.h"

#include <Arduino.h>
#include <Wire.h>
#include <esp_heap_caps.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <math.h>

#include "config.h"
#include "log.h"

namespace carelens {
namespace {

constexpr uint32_t kRingSeconds = 180;
constexpr uint32_t kTriggerCooldownMs = 60000;

ImuSample* g_ring = nullptr;
uint32_t g_cap = 0;
volatile uint32_t g_head = 0;
volatile bool g_ok = false;
volatile uint32_t g_errors = 0;
volatile uint32_t g_skipped = 0;
uint32_t g_rate = kImuDefaultHz;
uint8_t g_who = 0;
bool g_trigger_enabled = true;
QueueHandle_t g_triggers = nullptr;

bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(CL_MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool readRegs(uint8_t reg, uint8_t* out, size_t n) {
  Wire.beginTransmission(CL_MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(static_cast<uint8_t>(CL_MPU_ADDR), static_cast<uint8_t>(n)) != n) return false;
  for (size_t i = 0; i < n; i++) out[i] = static_cast<uint8_t>(Wire.read());
  return true;
}

bool configure() {
  uint8_t v = 0;
  if (!readRegs(0x75, &v, 1)) return false;  // WHO_AM_I
  g_who = v;
  const uint8_t div = static_cast<uint8_t>(1000 / g_rate - 1);  // 1 kHz internal rate with DLPF enabled
  const bool ok = writeReg(0x6B, 0x01)      // PWR_MGMT_1: wake, PLL with X gyro reference
                  && writeReg(0x1A, 0x04)   // CONFIG: DLPF ~21 Hz accel / 20 Hz gyro (below Nyquist of 50 Hz)
                  && writeReg(0x19, div)    // SMPLRT_DIV
                  && writeReg(0x1B, 0x10)   // GYRO_CONFIG: ±1000 °/s
                  && writeReg(0x1C, 0x10);  // ACCEL_CONFIG: ±8 g
  if (!ok) return false;
  delay(20);
  uint8_t back[4] = {0};
  if (!readRegs(0x19, back, 4)) return false;  // SMPLRT_DIV, CONFIG, GYRO_CONFIG, ACCEL_CONFIG
  return back[0] == div && back[1] == 0x04 && (back[2] & 0x18) == 0x10 && (back[3] & 0x18) == 0x10;
}

void imuTask(void*) {
  const int64_t period_us = 1000000 / static_cast<int64_t>(g_rate);
  int64_t next_us = esp_timer_get_time();
  uint64_t last_ms = 0;
  uint32_t consecutive_errors = 0;
  uint64_t last_trigger_ms = 0;
  for (;;) {
    next_us += period_us;
    int64_t now = esp_timer_get_time();
    if (now > next_us + period_us) {  // ran late: skip the missed slots instead of reading in a burst
      g_skipped = g_skipped + static_cast<uint32_t>((now - next_us) / period_us);
      next_us = now + period_us;
    }
    const int64_t wait_us = next_us - esp_timer_get_time();
    if (wait_us > 1000) vTaskDelay(pdMS_TO_TICKS(static_cast<uint32_t>(wait_us / 1000)));

    uint8_t b[14];
    const int64_t t_us = esp_timer_get_time();
    if (!readRegs(0x3B, b, sizeof b)) {
      g_errors = g_errors + 1;
      if (++consecutive_errors >= 10) {
        g_ok = false;
        if (consecutive_errors % 50 == 10) logf("imu", "read failing (%lu errors), reconfiguring", static_cast<unsigned long>(g_errors));
        if (configure()) {
          consecutive_errors = 0;
          g_ok = true;
          logf("imu", "reconfigured");
        }
      }
      continue;
    }
    consecutive_errors = 0;
    g_ok = true;
    const uint64_t t_ms = static_cast<uint64_t>(t_us) / 1000ULL;
    if (t_ms <= last_ms) continue;  // timestamps must strictly increase; drop rather than invent a time
    last_ms = t_ms;
    ImuSample s;
    s.t_ms = t_ms;
    s.ax = static_cast<int16_t>((b[0] << 8) | b[1]);
    s.ay = static_cast<int16_t>((b[2] << 8) | b[3]);
    s.az = static_cast<int16_t>((b[4] << 8) | b[5]);
    s.gx = static_cast<int16_t>((b[8] << 8) | b[9]);
    s.gy = static_cast<int16_t>((b[10] << 8) | b[11]);
    s.gz = static_cast<int16_t>((b[12] << 8) | b[13]);
    g_ring[g_head % g_cap] = s;
    g_head = g_head + 1;

    if (g_trigger_enabled) {
      const float ax = s.ax / kAccelLsbPerG, ay = s.ay / kAccelLsbPerG, az = s.az / kAccelLsbPerG;
      const float mag = sqrtf(ax * ax + ay * ay + az * az);
      if (mag >= kImpactTriggerG && (last_trigger_ms == 0 || t_ms - last_trigger_ms >= kTriggerCooldownMs)) {
        last_trigger_ms = t_ms;
        ImuTrigger t{t_ms, mag};
        xQueueSend(g_triggers, &t, 0);
      }
    }
  }
}

}  // namespace

bool imuBegin(uint32_t rate_hz, bool trigger_enabled) {
  g_rate = (rate_hz == 25 || rate_hz == 50 || rate_hz == 100) ? rate_hz : kImuDefaultHz;
  g_trigger_enabled = trigger_enabled;
  g_cap = g_rate * kRingSeconds;
  g_ring = static_cast<ImuSample*>(heap_caps_malloc(sizeof(ImuSample) * g_cap, MALLOC_CAP_SPIRAM));
  g_triggers = xQueueCreate(2, sizeof(ImuTrigger));
  if (!g_ring || !g_triggers) {
    logf("imu", "allocation failed");
    return false;
  }
  Wire.begin(CL_MPU_SDA, CL_MPU_SCL, CL_MPU_I2C_HZ);
  const bool ok = configure();
  logf("imu", "mpu6050 %s, who_am_i=0x%02x, %lu Hz, +-%d g, +-%d dps", ok ? "configured" : "CONFIG FAILED", g_who,
       static_cast<unsigned long>(g_rate), kAccelRangeG, kGyroRangeDps);
  if (!ok) return false;
  g_ok = true;
  return xTaskCreatePinnedToCore(imuTask, "imu", 4096, nullptr, 5, nullptr, 1) == pdPASS;
}

bool imuOk() { return g_ok; }
uint32_t imuRateHz() { return g_rate; }
uint32_t imuHead() { return g_head; }
// The slot of index head - cap is the one the writer fills next, so readers keep a margin of kGuard slots.
constexpr uint32_t kGuard = 8;
uint32_t imuOldest() { return g_head + kGuard > g_cap ? g_head + kGuard - g_cap : 0; }
uint32_t imuReadErrors() { return g_errors; }
uint32_t imuSkippedSlots() { return g_skipped; }
uint8_t imuWhoAmI() { return g_who; }

bool imuGet(uint32_t index, ImuSample* out) {
  if (!g_ring || index >= g_head || index < imuOldest()) return false;
  *out = g_ring[index % g_cap];
  return index >= imuOldest();  // re-check: the writer may have overwritten the slot meanwhile
}

bool imuPollTrigger(ImuTrigger* t) { return g_triggers && xQueueReceive(g_triggers, t, 0) == pdTRUE; }

}  // namespace carelens
