// OV5640 bursts for capture-session.v2: 24 (normal) or 40 (triggered) JPEG frames at ~8 fps, captured continuously
// (no rest cycle inside a burst, AUDIT FW-3/L5). Between bursts the sensor sits in software power-down, which the
// baseline used for heat (register 0x3008). Frames are copied to PSRAM with their capture time (uptime ms) and
// SHA-256; nothing is written to flash and no image ever leaves the device except through the device upload API.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "config.h"

namespace carelens {

struct Frame {
  uint8_t* data = nullptr;  // PSRAM
  uint32_t len = 0;
  uint64_t t_ms = 0;
  uint8_t sha256[32] = {0};
};

struct Burst {
  char capture_id[64] = {0};
  char trigger_id[64] = {0};  // empty for normal bursts
  bool triggered = false;
  uint16_t count = 0;
  uint16_t width = 0, height = 0;
  uint32_t max_interval_ms = 0;
  uint32_t min_interval_ms = 0;
  Frame frames[kFramesTriggered];
};

struct BurstRequest {
  bool triggered = false;
  char capture_id[64] = {0};
  char trigger_id[64] = {0};
};

bool cameraBegin(uint32_t xclk_hz);
bool cameraOk();
bool cameraRequestBurst(const BurstRequest& r);  // queued to the camera task; false if busy
bool cameraPollBurst(Burst** out);               // finished burst (caller owns it: burstFree)
void burstFree(Burst* b);
// One frame for diagnostics: prints size, dimensions and a hash prefix. The image is discarded.
bool cameraProbe(char* out, size_t cap);
uint32_t cameraFailures();

}  // namespace carelens
