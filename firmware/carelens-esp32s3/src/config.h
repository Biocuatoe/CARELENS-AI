// Hardware map and fixed limits. The pin numbers and the camera configuration are copied unchanged from the
// known-good baseline sketch that ran on this board (docs/HARDWARE.md §3, BASELINE_FLASH_TEST_REPORT.md). Do not
// change them without verifying on the physical board.
#pragma once

#include <stdint.h>

#ifndef CARELENS_FW_VERSION
#define CARELENS_FW_VERSION "carelens-fw-0.1.0"
#endif

// OV5640 (baseline: XCLK 15, SIOD 4, SIOC 5, D0-D7 = 11 9 8 10 12 18 17 16, VSYNC 6, HREF 7, PCLK 13, no PWDN/RESET)
#define CL_PIN_XCLK 15
#define CL_PIN_SIOD 4
#define CL_PIN_SIOC 5
#define CL_PIN_Y2 11
#define CL_PIN_Y3 9
#define CL_PIN_Y4 8
#define CL_PIN_Y5 10
#define CL_PIN_Y6 12
#define CL_PIN_Y7 18
#define CL_PIN_Y8 17
#define CL_PIN_Y9 16
#define CL_PIN_VSYNC 6
#define CL_PIN_HREF 7
#define CL_PIN_PCLK 13
// XCLK: the baseline used 10 MHz (cooler for continuous streaming). Measured on this board 2026-10-19: 10 MHz gives one VGA
// frame per 90 ms, so bursts can only be spaced 180 ms (outside 125 +/- 40 ms); 20 MHz gives ~45 ms frames and 135 ms spacing.
// Default 20 MHz (setting camxclk=10 returns to the baseline). The sensor sleeps between bursts; temperature was not measured.
#define CL_CAM_XCLK_HZ 10000000
#define CL_CAM_XCLK_DEFAULT_MHZ 20
#define CL_CAM_JPEG_QUALITY 12   // baseline

// MPU6050 on its own I2C bus (Wire, port 0); the camera's SCCB uses I2C port 1 (CONFIG_SCCB_HARDWARE_I2C_PORT1).
#define CL_MPU_SDA 47
#define CL_MPU_SCL 21
#define CL_MPU_ADDR 0x68
#define CL_MPU_I2C_HZ 400000

// MAX98357A (SD and GAIN not wired: (L+R)/2 mix, 9 dB gain)
#define CL_I2S_BCLK 41
#define CL_I2S_LRC 42
#define CL_I2S_DIN 1

namespace carelens {

constexpr float kDefaultVolume = 0.25f;  // baseline value, kept low for the 8 ohm 1 W speaker
constexpr float kMinRemoteVolume = 0.05f;  // range the backend may set (SPEAKER_VOLUME, migration 0007)
constexpr float kMaxVolume = 0.7f;        // conservative software limit for the 8 ohm / 1 W speaker, not a measured rating
constexpr uint32_t kAudioMaxBytes = 2200000;  // legacy WAV: backend AUDIO_CONTRACT.maxBytes
constexpr uint32_t kMp3MaxBytes = 2000000;    // MP3: backend MP3_CONTRACT.maxBytes (ADR-025)
constexpr uint32_t kAudioMaxDurationMs = 60000;  // both codecs: backend contract max_duration_ms
constexpr uint32_t kImuDefaultHz = 50;
constexpr float kImpactTriggerG = 2.5f;  // firmware trigger only; never fall evidence (ADR-017)
constexpr const char* kImuRuleVersion = "fw-imu-impact-0.1-uncalibrated";
constexpr uint32_t kMaxFrameBytes = 200000;  // Vision/backend per-frame limit
constexpr uint32_t kFramesNormal = 24;
constexpr uint32_t kFramesTriggered = 40;

}  // namespace carelens
