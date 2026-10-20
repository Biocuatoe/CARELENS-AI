// MP3 (MPEG-1/2/2.5 Layer III) held completely in memory: a header walk that validates the whole stream without decoding
// it, and a frame-by-frame decoder (dr_mp3, src/third_party/dr_mp3) with bounded output. Pure C++: no Arduino or ESP-IDF
// headers, so the host tests (test/host) compile the same files. The header walk mirrors the backend's inspectMp3
// (worker/src/media.ts): every byte between the tags must belong to a complete frame of one sample rate and one channel
// layout, so a truncated, padded or spliced file is refused before anything is played.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

struct Mp3Info {
  uint8_t mpeg_version = 0;   // 1, 2, or 25 (MPEG-2.5)
  uint32_t sample_rate = 0;
  uint16_t channels = 0;      // 1 (mono) or 2 (stereo, joint stereo, dual channel)
  uint32_t frames = 0;        // audio frames (a Xing/Info/VBRI metadata frame is not counted)
  uint64_t pcm_frames = 0;    // samples per channel, frames * 1152 (MPEG-1) or * 576 (MPEG-2/2.5)
  uint16_t min_kbps = 0, max_kbps = 0;
  bool has_id3v2 = false, has_tail_tag = false, has_vbr_header = false;
  size_t audio_offset = 0;    // first frame
  size_t audio_end = 0;       // end of the last frame (trailing ID3v1/APEv2 tags and zero padding excluded)

  uint32_t durationMs() const { return sample_rate ? static_cast<uint32_t>(pcm_frames * 1000u / sample_rate) : 0; }
};

enum class Mp3Error : uint8_t {
  kOk,
  kTooShort,
  kBadId3,
  kNoFrame,        // no frame header where the first frame must start
  kBadHeader,      // reserved version/bitrate/sample-rate values
  kNotLayer3,
  kFreeFormat,     // bitrate index 0: frame length cannot be derived, refused
  kFormatChanged,  // sample rate, MPEG version or channel layout differs from the first frame
  kTruncatedFrame,
  kTrailingData,   // bytes after the last frame that are not a tag or zero padding
  kDecode,         // the decoder found no frame where the header walk did, or produced no samples
};

// Short stable code for logs and command reason details, e.g. "mp3_not_layer3".
const char* mp3ErrorCode(Mp3Error e);

// Never reads outside [buf, buf + len).
Mp3Error inspectMp3(const uint8_t* buf, size_t len, Mp3Info* out);

// Decodes the frames of an inspected stream one at a time into interleaved int16 PCM.
class Mp3Decoder {
 public:
  static constexpr size_t kMaxPcmSamples = 1152 * 2;  // one MPEG-1 stereo frame
  static size_t stateBytes();                         // decoder state incl. scratch (~23 KB); allocate in PSRAM on the device

  // `state`: stateBytes() bytes, malloc-aligned, owned by the caller. `data`/`info`: the buffer that passed inspectMp3.
  void begin(void* state, const uint8_t* data, const Mp3Info& info);
  // Decodes the next audio frame into `pcm` (capacity kMaxPcmSamples). Returns samples per channel (> 0), 0 at the clean
  // end of the stream, or -1 on error (*err set). Every call either advances through the buffer or ends.
  int next(int16_t* pcm, Mp3Error* err);
  uint32_t framesDecoded() const { return frames_; }
  uint64_t pcmFramesDecoded() const { return pcm_frames_; }
  uint32_t framesSkipped() const { return skipped_; }

 private:
  void* state_ = nullptr;
  const uint8_t* data_ = nullptr;
  size_t pos_ = 0, end_ = 0;
  uint32_t rate_ = 0;
  uint16_t channels_ = 0;
  uint32_t frames_ = 0, skipped_ = 0;
  uint64_t pcm_frames_ = 0;
};

}  // namespace carelens
