#include "pcm.h"

#include <math.h>

namespace carelens {
namespace {

constexpr float kTwoPi = 6.28318530718f;

int16_t scale(int32_t v, float volume) {
  float s = static_cast<float>(v) * volume;
  if (s > 32767.0f) s = 32767.0f;
  if (s < -32768.0f) s = -32768.0f;
  return static_cast<int16_t>(s);
}

int16_t sampleAt(const uint8_t* p) { return static_cast<int16_t>(static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8)); }

}  // namespace

size_t pcmToStereo(const uint8_t* in, size_t in_frames, uint16_t channels, float volume, int16_t* out, size_t out_frames) {
  if (in == nullptr || out == nullptr || channels < 1 || channels > 2) return 0;
  const size_t n = in_frames < out_frames ? in_frames : out_frames;
  const size_t stride = static_cast<size_t>(channels) * 2;
  for (size_t i = 0; i < n; i++) {
    const uint8_t* f = in + i * stride;
    const int16_t l = sampleAt(f);
    const int16_t r = channels == 2 ? sampleAt(f + 2) : l;
    out[2 * i] = scale(l, volume);
    out[2 * i + 1] = scale(r, volume);
  }
  return n;
}

ToneGen::ToneGen(float freq_hz, uint32_t sample_rate, uint32_t total_frames, float amplitude, uint32_t ramp_frames)
    : step_(sample_rate ? kTwoPi * freq_hz / static_cast<float>(sample_rate) : 0.0f),
      total_(total_frames),
      amp_(amplitude),
      ramp_(ramp_frames ? ramp_frames : 1) {}

size_t ToneGen::next(int16_t* out, size_t out_frames, float volume) {
  size_t n = 0;
  while (n < out_frames && pos_ < total_) {
    float env = 1.0f;
    if (pos_ < ramp_) env = static_cast<float>(pos_) / ramp_;
    const uint32_t left = total_ - pos_;
    if (left < ramp_) env = static_cast<float>(left) / ramp_;
    const int16_t v = scale(static_cast<int32_t>(amp_ * 32767.0f * env * sinf(phase_)), volume);
    out[2 * n] = v;
    out[2 * n + 1] = v;
    phase_ += step_;
    if (phase_ >= kTwoPi) phase_ -= kTwoPi;
    pos_++;
    n++;
  }
  return n;
}

}  // namespace carelens
