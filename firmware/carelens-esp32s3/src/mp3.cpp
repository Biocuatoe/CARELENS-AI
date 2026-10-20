#include "mp3.h"

#include <string.h>

#define DR_MP3_NO_STDIO
#include "third_party/dr_mp3/dr_mp3.h"

namespace carelens {
namespace {

// Layer III bitrates in kbps (index 0 = free format, 15 = reserved).
const uint16_t kKbpsV1[16] = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0};
const uint16_t kKbpsV2[16] = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0};
// Sample rates by version bits (0 = MPEG-2.5, 2 = MPEG-2, 3 = MPEG-1) and index.
const uint32_t kRate[4][3] = {{11025, 12000, 8000}, {0, 0, 0}, {22050, 24000, 16000}, {44100, 48000, 32000}};

struct Header {
  uint8_t version_bits;  // 0, 2, 3
  uint32_t rate;
  uint16_t channels;
  uint16_t kbps;
  uint32_t bytes;    // whole frame incl. header
  uint32_t samples;  // per channel
  bool crc;
};

// Reads a frame header at p (4 bytes available). Returns kOk or the reason it is not a usable Layer III header.
Mp3Error readHeader(const uint8_t* p, Header* h) {
  if (p[0] != 0xFF || (p[1] & 0xE0) != 0xE0) return Mp3Error::kNoFrame;
  const uint8_t ver = (p[1] >> 3) & 3, layer = (p[1] >> 1) & 3, br = p[2] >> 4, sr = (p[2] >> 2) & 3;
  if (ver == 1 || sr == 3 || br == 15 || layer == 0) return Mp3Error::kBadHeader;
  if (layer != 1) return Mp3Error::kNotLayer3;
  if (br == 0) return Mp3Error::kFreeFormat;
  h->version_bits = ver;
  h->rate = kRate[ver][sr];
  h->channels = (p[3] >> 6) == 3 ? 1 : 2;
  h->kbps = ver == 3 ? kKbpsV1[br] : kKbpsV2[br];
  const uint32_t pad = (p[2] >> 1) & 1;
  h->bytes = (ver == 3 ? 144000u : 72000u) * h->kbps / h->rate + pad;
  h->samples = ver == 3 ? 1152 : 576;
  h->crc = (p[1] & 1) == 0;
  return Mp3Error::kOk;
}

// A Xing/Info (LAME) or VBRI (Fraunhofer) frame carries stream metadata, not audio.
bool isVbrHeaderFrame(const uint8_t* f, const Header& h) {
  const size_t side = h.version_bits == 3 ? (h.channels == 1 ? 17 : 32) : (h.channels == 1 ? 9 : 17);
  const size_t at = 4 + (h.crc ? 2 : 0) + side;
  if (at + 4 <= h.bytes && (memcmp(f + at, "Xing", 4) == 0 || memcmp(f + at, "Info", 4) == 0)) return true;
  return 36 + 4 <= h.bytes && memcmp(f + 36, "VBRI", 4) == 0;
}

bool allZero(const uint8_t* p, size_t n) {
  for (size_t i = 0; i < n; i++) {
    if (p[i] != 0) return false;
  }
  return true;
}

}  // namespace

const char* mp3ErrorCode(Mp3Error e) {
  switch (e) {
    case Mp3Error::kOk: return "ok";
    case Mp3Error::kTooShort: return "mp3_too_short";
    case Mp3Error::kBadId3: return "mp3_bad_id3";
    case Mp3Error::kNoFrame: return "mp3_no_frame";
    case Mp3Error::kBadHeader: return "mp3_bad_header";
    case Mp3Error::kNotLayer3: return "mp3_not_layer3";
    case Mp3Error::kFreeFormat: return "mp3_free_format";
    case Mp3Error::kFormatChanged: return "mp3_format_changed";
    case Mp3Error::kTruncatedFrame: return "mp3_truncated_frame";
    case Mp3Error::kTrailingData: return "mp3_trailing_data";
    case Mp3Error::kDecode: return "mp3_decode_error";
  }
  return "mp3_unknown";
}

Mp3Error inspectMp3(const uint8_t* buf, size_t len, Mp3Info* out) {
  *out = Mp3Info();
  if (!buf || len < 4) return Mp3Error::kTooShort;
  size_t pos = 0;
  if (len >= 10 && memcmp(buf, "ID3", 3) == 0) {
    const uint8_t major = buf[3], flags = buf[5];
    if (major < 2 || major > 4 || (buf[6] | buf[7] | buf[8] | buf[9]) & 0x80) return Mp3Error::kBadId3;
    const size_t size = (static_cast<size_t>(buf[6]) << 21) | (static_cast<size_t>(buf[7]) << 14) | (static_cast<size_t>(buf[8]) << 7) | buf[9];
    const size_t tag = 10 + size + ((flags & 0x10) ? 10 : 0);
    if (tag > len) return Mp3Error::kBadId3;
    pos = tag;
    out->has_id3v2 = true;
  }
  // End of the audio region: an ID3v1 tag (exactly the last 128 bytes), then an APEv2 tag before it.
  size_t end = len;
  if (end - pos >= 128 && memcmp(buf + end - 128, "TAG", 3) == 0) {
    end -= 128;
    out->has_tail_tag = true;
  }
  if (end - pos >= 32 && memcmp(buf + end - 32, "APETAGEX", 8) == 0) {
    const uint8_t* f = buf + end - 32;
    const uint32_t size = static_cast<uint32_t>(f[12]) | (static_cast<uint32_t>(f[13]) << 8) | (static_cast<uint32_t>(f[14]) << 16) | (static_cast<uint32_t>(f[15]) << 24);
    const bool has_header = (f[23] & 0x80) != 0;
    const size_t tag = static_cast<size_t>(size) + (has_header ? 32 : 0);
    if (tag < 32 || tag > end - pos) return Mp3Error::kTrailingData;
    end -= tag;
    out->has_tail_tag = true;
  }
  while (pos < end && buf[pos] == 0) pos++;  // zero padding after an ID3v2 tag
  out->audio_offset = pos;
  Header first{};
  bool have_first = false;
  while (pos < end) {
    if (end - pos < 4) {
      if (!allZero(buf + pos, end - pos)) return have_first ? Mp3Error::kTrailingData : Mp3Error::kNoFrame;
      break;
    }
    Header h{};
    const Mp3Error e = readHeader(buf + pos, &h);
    if (e != Mp3Error::kOk) {
      if (!have_first) return e;
      if (allZero(buf + pos, end - pos)) break;  // zero padding after the last frame
      return e == Mp3Error::kNoFrame ? Mp3Error::kTrailingData : e;
    }
    if (h.bytes > end - pos) return Mp3Error::kTruncatedFrame;
    if (!have_first) {
      first = h;
      have_first = true;
      out->mpeg_version = h.version_bits == 3 ? 1 : h.version_bits == 2 ? 2 : 25;
      out->sample_rate = h.rate;
      out->channels = h.channels;
      out->min_kbps = out->max_kbps = h.kbps;
      if (isVbrHeaderFrame(buf + pos, h)) {
        out->has_vbr_header = true;
        pos += h.bytes;
        out->audio_offset = pos;  // the decoder starts at the first audio frame
        continue;
      }
    } else if (h.version_bits != first.version_bits || h.rate != first.rate || h.channels != first.channels) {
      return Mp3Error::kFormatChanged;
    }
    if (h.kbps < out->min_kbps) out->min_kbps = h.kbps;
    if (h.kbps > out->max_kbps) out->max_kbps = h.kbps;
    out->frames++;
    out->pcm_frames += h.samples;
    pos += h.bytes;
    out->audio_end = pos;
  }
  if (!have_first) return Mp3Error::kNoFrame;
  if (out->frames == 0) return Mp3Error::kNoFrame;
  return Mp3Error::kOk;
}

size_t Mp3Decoder::stateBytes() { return sizeof(drmp3dec); }

void Mp3Decoder::begin(void* state, const uint8_t* data, const Mp3Info& info) {
  state_ = state;
  data_ = data;
  pos_ = info.audio_offset;
  end_ = info.audio_end;
  rate_ = info.sample_rate;
  channels_ = info.channels;
  frames_ = skipped_ = 0;
  pcm_frames_ = 0;
  drmp3dec_init(static_cast<drmp3dec*>(state_));
}

int Mp3Decoder::next(int16_t* pcm, Mp3Error* err) {
  *err = Mp3Error::kOk;
  while (pos_ < end_) {
    const size_t left = end_ - pos_;
    drmp3dec_frame_info fi{};
    const int n = drmp3dec_decode_frame(static_cast<drmp3dec*>(state_), data_ + pos_, left > 0x7FFFFFFF ? 0x7FFFFFFF : static_cast<int>(left), pcm, &fi);
    if (fi.frame_bytes <= 0 || static_cast<size_t>(fi.frame_bytes) > left) {
      *err = Mp3Error::kDecode;
      return -1;
    }
    pos_ += static_cast<size_t>(fi.frame_bytes);
    if (n == 0) {  // metadata frame, or a frame the decoder could not use (no samples): skipped, never invented
      skipped_++;
      continue;
    }
    if (static_cast<uint32_t>(fi.sample_rate) != rate_ || static_cast<uint16_t>(fi.channels) != channels_ || n < 0 ||
        static_cast<size_t>(n) * static_cast<size_t>(fi.channels) > kMaxPcmSamples) {
      *err = Mp3Error::kFormatChanged;
      return -1;
    }
    frames_++;
    pcm_frames_ += static_cast<uint64_t>(n);
    return n;
  }
  if (frames_ == 0) {
    *err = Mp3Error::kDecode;
    return -1;
  }
  return 0;
}

}  // namespace carelens
