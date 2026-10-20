// Sample conversion for the I2S path. The baseline sketch overflowed its 512-sample output buffer for mono WAV
// (it converted got/2 = 512 mono frames into 1024 output samples, FW-1). Here the number of frames converted per call
// is bounded by the output capacity, so no input layout can write past `out`. Pure C++ (host-tested).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

// Converts up to min(in_frames, out_frames) frames of 16-bit little-endian PCM (1 or 2 channels, any byte alignment)
// into interleaved stereo int16 in `out` (capacity out_frames * 2 samples), scaled by volume (0..1) with saturation.
// Returns the number of frames written. Returns 0 for channels outside 1..2.
size_t pcmToStereo(const uint8_t* in, size_t in_frames, uint16_t channels, float volume, int16_t* out, size_t out_frames);

// Sine tone generator with a linear attack/release envelope, continuous across calls.
class ToneGen {
 public:
  ToneGen(float freq_hz, uint32_t sample_rate, uint32_t total_frames, float amplitude, uint32_t ramp_frames);
  // Writes up to out_frames stereo frames; returns frames written (0 when the tone is finished).
  size_t next(int16_t* out, size_t out_frames, float volume);
  bool done() const { return pos_ >= total_; }

 private:
  float phase_ = 0.0f;
  float step_;
  uint32_t total_;
  uint32_t pos_ = 0;
  float amp_;
  uint32_t ramp_;
};

}  // namespace carelens
