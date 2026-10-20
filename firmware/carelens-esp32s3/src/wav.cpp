#include "wav.h"

#include <string.h>

namespace carelens {
namespace {

uint16_t rd16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t rd32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

}  // namespace

const char* wavErrorCode(WavError e) {
  switch (e) {
    case WavError::kOk: return "wav_ok";
    case WavError::kTooShort: return "wav_too_short";
    case WavError::kNotRiff: return "wav_not_riff";
    case WavError::kNotWave: return "wav_not_wave";
    case WavError::kChunkTruncated: return "wav_chunk_truncated";
    case WavError::kFmtTooShort: return "wav_fmt_too_short";
    case WavError::kNoFmt: return "wav_no_fmt";
    case WavError::kNoData: return "wav_no_data";
    case WavError::kNotPcm: return "wav_not_pcm";
    case WavError::kBadChannels: return "wav_bad_channels";
    case WavError::kBadBits: return "wav_bad_bits";
    case WavError::kBadBlockAlign: return "wav_bad_block_align";
    case WavError::kBadByteRate: return "wav_bad_byte_rate";
    case WavError::kBadRate: return "wav_bad_rate";
    case WavError::kEmptyData: return "wav_empty_data";
  }
  return "wav_unknown";
}

WavError parseWav(const uint8_t* buf, size_t len, WavInfo* out) {
  if (buf == nullptr || out == nullptr || len < 12) return WavError::kTooShort;
  if (memcmp(buf, "RIFF", 4) != 0) return WavError::kNotRiff;
  if (memcmp(buf + 8, "WAVE", 4) != 0) return WavError::kNotWave;

  WavInfo info;
  bool have_fmt = false;
  size_t pos = 12;
  while (pos + 8 <= len) {
    const uint8_t* id = buf + pos;
    const uint32_t size = rd32(buf + pos + 4);
    const size_t body = pos + 8;
    // 64-bit arithmetic: a size near 4 GiB must not wrap around.
    if (static_cast<uint64_t>(body) + size > len) return WavError::kChunkTruncated;
    if (memcmp(id, "fmt ", 4) == 0) {
      if (size < 16) return WavError::kFmtTooShort;
      const uint16_t format = rd16(buf + body);
      info.channels = rd16(buf + body + 2);
      info.sample_rate = rd32(buf + body + 4);
      const uint32_t byte_rate = rd32(buf + body + 8);
      info.block_align = rd16(buf + body + 12);
      info.bits_per_sample = rd16(buf + body + 14);
      if (format != 1) return WavError::kNotPcm;
      if (info.channels < 1 || info.channels > 2) return WavError::kBadChannels;
      if (info.bits_per_sample != 16) return WavError::kBadBits;
      if (info.block_align != info.channels * 2) return WavError::kBadBlockAlign;
      if (info.sample_rate < 8000 || info.sample_rate > 48000) return WavError::kBadRate;
      if (byte_rate != info.sample_rate * info.block_align) return WavError::kBadByteRate;
      have_fmt = true;
    } else if (memcmp(id, "data", 4) == 0) {
      if (!have_fmt) return WavError::kNoFmt;
      info.data_offset = body;
      info.data_bytes = size - (size % info.block_align);
      if (info.data_bytes == 0) return WavError::kEmptyData;
      *out = info;
      return WavError::kOk;
    }
    pos = body + size + (size & 1u);
  }
  return have_fmt ? WavError::kNoData : WavError::kNoFmt;
}

}  // namespace carelens
