// RIFF/WAVE PCM parser for audio held completely in memory. Pure C++: no Arduino or ESP-IDF headers, so the host
// tests (test/host) compile the same file. Rules mirror the backend's inspectWav (worker/src/media.ts): chunks are
// bounded by the buffer, never by the RIFF size field; the data chunk must lie completely inside the buffer.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

struct WavInfo {
  uint16_t channels = 0;
  uint32_t sample_rate = 0;
  uint16_t bits_per_sample = 0;
  uint16_t block_align = 0;
  size_t data_offset = 0;  // offset of the first sample byte from the start of the buffer
  size_t data_bytes = 0;   // whole frames only (a trailing partial frame is dropped)

  uint32_t frames() const { return block_align ? static_cast<uint32_t>(data_bytes / block_align) : 0; }
  uint32_t durationMs() const { return sample_rate ? static_cast<uint32_t>((static_cast<uint64_t>(frames()) * 1000u) / sample_rate) : 0; }
};

enum class WavError : uint8_t {
  kOk,
  kTooShort,
  kNotRiff,
  kNotWave,
  kChunkTruncated,
  kFmtTooShort,
  kNoFmt,
  kNoData,
  kNotPcm,
  kBadChannels,
  kBadBits,
  kBadBlockAlign,
  kBadByteRate,
  kBadRate,
  kEmptyData,
};

// Short stable code for logs and command reason details, e.g. "wav_not_pcm".
const char* wavErrorCode(WavError e);

// Accepts PCM (format 1), 16-bit, 1 or 2 channels, 8000..48000 Hz. Never reads outside [buf, buf + len).
WavError parseWav(const uint8_t* buf, size_t len, WavInfo* out);

}  // namespace carelens
