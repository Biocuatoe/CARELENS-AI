// MPU6050 sampler: a fixed-rate task reads raw accelerometer/gyroscope registers, stamps each sample with uptime
// (ms since boot) and stores it in a PSRAM ring buffer. Configured ±8 g and ±1000 °/s (the baseline only woke the
// chip, leaving ±2 g which saturates on impacts, AUDIT FW-4). Values are raw sensor readings converted to g and °/s:
// no orientation, posture or "fall" is computed here. The impact trigger only asks for a camera burst and is never
// evidence (ADR-017).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

constexpr int kAccelRangeG = 8;
constexpr int kGyroRangeDps = 1000;
constexpr float kAccelLsbPerG = 4096.0f;
constexpr float kGyroLsbPerDps = 32.8f;

struct ImuSample {
  uint64_t t_ms;
  int16_t ax, ay, az, gx, gy, gz;
};

struct ImuTrigger {
  uint64_t t_ms;
  float peak_g;
};

bool imuBegin(uint32_t rate_hz, bool trigger_enabled);
bool imuOk();
uint32_t imuRateHz();
uint32_t imuHead();                       // number of samples produced since boot
bool imuGet(uint32_t index, ImuSample* out);  // false if not yet produced or already overwritten
uint32_t imuOldest();                     // oldest index still in the ring
uint32_t imuReadErrors();
uint32_t imuSkippedSlots();               // sampling slots missed because the task ran late
uint8_t imuWhoAmI();
bool imuPollTrigger(ImuTrigger* t);       // firmware impact rule fired (rate limited)

}  // namespace carelens
