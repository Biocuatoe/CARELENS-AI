// Host unit tests for the hardware-independent firmware modules. Built and run by tools/run_host_tests.py with the
// PC's g++; the same source files are compiled into the firmware.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <vector>

#include "../../src/jpeg.h"
#include "../../src/ledger.h"
#include "../../src/mp3.h"
#include "../../src/pcm.h"
#include "../../src/textutil.h"
#include "../../src/wav.h"

using namespace carelens;

static int g_failures = 0;
static int g_checks = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    g_checks++;                                                         \
    if (!(cond)) {                                                      \
      g_failures++;                                                     \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);   \
    }                                                                   \
  } while (0)

/* ------------------------------------------------------------------ WAV */

static void put16(std::vector<uint8_t>& v, uint16_t x) { v.push_back(x & 0xFF); v.push_back(x >> 8); }
static void put32(std::vector<uint8_t>& v, uint32_t x) { for (int i = 0; i < 4; i++) v.push_back((x >> (8 * i)) & 0xFF); }
static void putTag(std::vector<uint8_t>& v, const char* t) { v.insert(v.end(), t, t + 4); }

struct WavSpec {
  uint16_t format = 1, channels = 1, bits = 16;
  uint32_t rate = 16000;
  int32_t block_align = -1, byte_rate = -1;
  uint32_t fmt_size = 16;
  uint32_t data_bytes = 3200;
  int32_t data_size_field = -1;  // override the declared data size
  const char* extra_chunk = nullptr;  // inserted before fmt
  uint32_t extra_size = 0;
  bool data_before_fmt = false;
};

static std::vector<uint8_t> makeWav(const WavSpec& s) {
  std::vector<uint8_t> fmt;
  putTag(fmt, "fmt ");
  put32(fmt, s.fmt_size);
  put16(fmt, s.format);
  put16(fmt, s.channels);
  put32(fmt, s.rate);
  const uint16_t ba = s.block_align >= 0 ? static_cast<uint16_t>(s.block_align) : static_cast<uint16_t>(s.channels * s.bits / 8);
  put32(fmt, s.byte_rate >= 0 ? static_cast<uint32_t>(s.byte_rate) : s.rate * ba);
  put16(fmt, ba);
  put16(fmt, s.bits);
  for (uint32_t i = 16; i < s.fmt_size; i++) fmt.push_back(0);
  std::vector<uint8_t> data;
  putTag(data, "data");
  put32(data, s.data_size_field >= 0 ? static_cast<uint32_t>(s.data_size_field) : s.data_bytes);
  for (uint32_t i = 0; i < s.data_bytes; i++) data.push_back(static_cast<uint8_t>(i * 7));
  std::vector<uint8_t> v;
  putTag(v, "RIFF");
  put32(v, 0);
  putTag(v, "WAVE");
  if (s.extra_chunk) {
    putTag(v, s.extra_chunk);
    put32(v, s.extra_size);
    for (uint32_t i = 0; i < s.extra_size + (s.extra_size & 1); i++) v.push_back(0xAA);
  }
  if (s.data_before_fmt) {
    v.insert(v.end(), data.begin(), data.end());
    v.insert(v.end(), fmt.begin(), fmt.end());
  } else {
    v.insert(v.end(), fmt.begin(), fmt.end());
    v.insert(v.end(), data.begin(), data.end());
  }
  const uint32_t riff = static_cast<uint32_t>(v.size() - 8);
  memcpy(&v[4], &riff, 4);
  return v;
}

static WavError parse(const std::vector<uint8_t>& v, WavInfo* info) { return parseWav(v.data(), v.size(), info); }

static void testWav(const char* greeting_path) {
  WavInfo w;
  {
    WavSpec s;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kOk);
    CHECK(w.channels == 1 && w.sample_rate == 16000 && w.bits_per_sample == 16 && w.block_align == 2);
    CHECK(w.data_offset == 44 && w.data_bytes == 3200 && w.frames() == 1600 && w.durationMs() == 100);
  }
  {
    WavSpec s;
    s.channels = 2;
    s.rate = 48000;
    s.data_bytes = 4000;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kOk && w.channels == 2 && w.frames() == 1000);
  }
  {  // odd-sized LIST chunk before fmt: the pad byte must be skipped
    WavSpec s;
    s.extra_chunk = "LIST";
    s.extra_size = 5;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kOk && w.data_offset == 12 + 8 + 6 + 24 + 8);
  }
  {  // fmt with extension bytes (size 18)
    WavSpec s;
    s.fmt_size = 18;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kOk);
  }
  {  // trailing half frame is dropped, never played
    WavSpec s;
    s.channels = 2;
    s.data_bytes = 4002;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kOk && w.data_bytes == 4000);
  }
  {  // declared data longer than the buffer
    WavSpec s;
    s.data_size_field = 9999;
    auto v = makeWav(s);
    CHECK(parse(v, &w) == WavError::kChunkTruncated);
  }
  {  // a chunk size near 4 GiB must not wrap around the bounds check
    WavSpec s;
    s.extra_chunk = "junk";
    s.extra_size = 0;
    auto v = makeWav(s);
    const uint32_t huge = 0xFFFFFFF8u;
    memcpy(&v[16], &huge, 4);
    CHECK(parse(v, &w) == WavError::kChunkTruncated);
  }
  { WavSpec s; s.fmt_size = 14; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kFmtTooShort); }
  { WavSpec s; s.format = 3; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kNotPcm); }
  { WavSpec s; s.bits = 8; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadBits); }
  { WavSpec s; s.channels = 3; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadChannels); }
  { WavSpec s; s.channels = 0; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadChannels); }
  { WavSpec s; s.block_align = 4; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadBlockAlign); }
  { WavSpec s; s.byte_rate = 1234; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadByteRate); }
  { WavSpec s; s.rate = 96000; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kBadRate); }
  { WavSpec s; s.data_bytes = 0; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kEmptyData); }
  { WavSpec s; s.data_before_fmt = true; auto v = makeWav(s); CHECK(parse(v, &w) == WavError::kNoFmt); }
  {
    WavSpec s;
    auto v = makeWav(s);
    std::vector<uint8_t> fmt_only(v.begin(), v.begin() + 36);  // complete fmt chunk, no data chunk
    CHECK(parse(fmt_only, &w) == WavError::kNoData);
    v.resize(30);  // cut inside the fmt chunk body
    CHECK(parse(v, &w) == WavError::kChunkTruncated);
    std::vector<uint8_t> riff_only(v.begin(), v.begin() + 12);
    CHECK(parse(riff_only, &w) == WavError::kNoFmt);
  }
  {
    auto v = makeWav(WavSpec());
    v[0] = 'X';
    CHECK(parse(v, &w) == WavError::kNotRiff);
    v[0] = 'R';
    v[8] = 'X';
    CHECK(parse(v, &w) == WavError::kNotWave);
    CHECK(parseWav(v.data(), 8, &w) == WavError::kTooShort);
    CHECK(parseWav(nullptr, 100, &w) == WavError::kTooShort);
  }
  // Every prefix of a valid file is either rejected or parsed within bounds (no out-of-range read is possible).
  {
    WavSpec s;
    s.extra_chunk = "LIST";
    s.extra_size = 7;
    auto v = makeWav(s);
    for (size_t n = 0; n <= v.size(); n++) {
      std::vector<uint8_t> p(v.begin(), v.begin() + n);
      WavInfo t;
      const WavError e = parseWav(p.data(), p.size(), &t);
      if (e == WavError::kOk) CHECK(t.data_offset + t.data_bytes <= n);
    }
  }
  if (greeting_path) {  // the real startup greeting asset
    FILE* f = fopen(greeting_path, "rb");
    CHECK(f != nullptr);
    if (f) {
      std::vector<uint8_t> v(1 << 20);
      v.resize(fread(v.data(), 1, v.size(), f));
      fclose(f);
      WavInfo g;
      CHECK(parse(v, &g) == WavError::kOk);
      CHECK(g.channels == 1 && g.sample_rate == 16000 && g.bits_per_sample == 16);
      CHECK(g.durationMs() >= 500 && g.durationMs() <= 3000);
      printf("greeting asset: %u ms, %u frames\n", g.durationMs(), g.frames());
    }
  }
}

/* ------------------------------------------------------------------ PCM */

static void testPcm() {
  // FW-1 regression: 1024 bytes of mono input (512 frames) into a 256-frame block never writes past the block.
  std::vector<uint8_t> mono(1024);
  for (size_t i = 0; i < mono.size(); i += 2) { mono[i] = 0x10; mono[i + 1] = 0x00; }
  std::vector<int16_t> out(256 * 2 + 8, 0x5A5A);
  size_t n = pcmToStereo(mono.data(), 512, 1, 1.0f, out.data(), 256);
  CHECK(n == 256);
  bool guard_ok = true;
  for (size_t i = 512; i < out.size(); i++) guard_ok &= out[i] == 0x5A5A;
  CHECK(guard_ok);
  CHECK(out[0] == 16 && out[1] == 16 && out[511] == 16);
  // stereo keeps channels; volume scales; saturation
  const uint8_t st[8] = {0xFF, 0x7F, 0x00, 0x80, 0x10, 0x00, 0xF0, 0xFF};  // L=32767 R=-32768 | L=16 R=-16
  int16_t o[4];
  CHECK(pcmToStereo(st, 2, 2, 1.0f, o, 2) == 2);
  CHECK(o[0] == 32767 && o[1] == -32768 && o[2] == 16 && o[3] == -16);
  CHECK(pcmToStereo(st, 2, 2, 0.25f, o, 2) == 2);
  CHECK(o[0] == 8191 && o[1] == -8192 && o[2] == 4 && o[3] == -4);
  CHECK(pcmToStereo(st, 2, 2, 2.0f, o, 2) == 2 && o[0] == 32767 && o[1] == -32768);
  CHECK(pcmToStereo(st, 2, 0, 1.0f, o, 2) == 0);
  CHECK(pcmToStereo(st, 2, 3, 1.0f, o, 2) == 0);
  // unaligned input pointer
  uint8_t un[5] = {0x00, 0x34, 0x12, 0x00, 0x00};
  CHECK(pcmToStereo(un + 1, 1, 1, 1.0f, o, 1) == 1 && o[0] == 0x1234);
  // tone generator: exact length, bounded amplitude, envelope starts at 0
  ToneGen t(1000.0f, 16000, 1600, 0.5f, 80);
  int16_t blk[256 * 2];
  size_t total = 0;
  int peak = 0;
  bool first = true;
  while (size_t k = t.next(blk, 256, 1.0f)) {
    if (first) { CHECK(blk[0] == 0); first = false; }
    for (size_t i = 0; i < 2 * k; i++) peak = peak > abs(blk[i]) ? peak : abs(blk[i]);
    total += k;
  }
  CHECK(total == 1600 && t.done());
  CHECK(peak <= 16384 && peak > 15000);
}

/* ------------------------------------------------------------------ JPEG */

static std::vector<uint8_t> makeJpeg(uint16_t w, uint16_t h, bool sof_first = true) {
  std::vector<uint8_t> v = {0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0};
  std::vector<uint8_t> sof = {0xFF, 0xC0, 0x00, 0x0B, 0x08, static_cast<uint8_t>(h >> 8), static_cast<uint8_t>(h), static_cast<uint8_t>(w >> 8), static_cast<uint8_t>(w), 0x01, 0x01, 0x11, 0x00};
  std::vector<uint8_t> sos = {0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x12, 0x34};
  if (sof_first) { v.insert(v.end(), sof.begin(), sof.end()); v.insert(v.end(), sos.begin(), sos.end()); }
  else { v.insert(v.end(), sos.begin(), sos.end()); v.insert(v.end(), sof.begin(), sof.end()); }
  v.push_back(0xFF);
  v.push_back(0xD9);
  return v;
}

static void testJpeg() {
  JpegInfo j;
  auto v = makeJpeg(640, 480);
  CHECK(inspectJpeg(v.data(), v.size(), &j) && j.width == 640 && j.height == 480);
  auto padded = v;
  padded.push_back(0);
  padded.push_back(0);
  CHECK(inspectJpeg(padded.data(), padded.size(), &j));
  auto no_eoi = v;
  no_eoi.pop_back();
  CHECK(!inspectJpeg(no_eoi.data(), no_eoi.size(), &j));
  auto sos_first = makeJpeg(320, 240, false);
  CHECK(!inspectJpeg(sos_first.data(), sos_first.size(), &j));
  auto zero = makeJpeg(0, 240);
  CHECK(!inspectJpeg(zero.data(), zero.size(), &j));
  auto bad_len = v;
  bad_len[4] = 0x7F;  // APP0 length beyond the buffer
  CHECK(!inspectJpeg(bad_len.data(), bad_len.size(), &j));
  CHECK(!inspectJpeg(v.data(), 3, &j));
  for (size_t n = 0; n < v.size(); n++) inspectJpeg(v.data(), n, &j);  // no out-of-range read on any prefix
}

/* ------------------------------------------------------------------ ledger */

static void testLedger() {
  CommandLedger l;
  CHECK(l.size() == 0 && l.find("cmd_a") == nullptr);
  LedgerEntry* a = l.upsert("cmd_a");
  CHECK(a && a->state == CmdState::kReceived && l.find("cmd_a") == a && l.upsert("cmd_a") == a);
  CHECK(l.upsert("") == nullptr && l.upsert(nullptr) == nullptr);
  std::string long_id(80, 'x');
  CHECK(l.upsert(long_id.c_str()) == nullptr);

  // decideDelivery
  CHECK(decideDelivery(nullptr, false) == DeliveryAction::kProcess);
  CHECK(decideDelivery(a, true) == DeliveryAction::kIgnore);
  a->state = CmdState::kAccepted;
  CHECK(decideDelivery(a, false) == DeliveryAction::kProcess);
  a->state = CmdState::kStarted;
  CHECK(decideDelivery(a, false) == DeliveryAction::kFailNotReplay);
  for (CmdState s : {CmdState::kCompleted, CmdState::kFailed, CmdState::kRejected, CmdState::kCancelled}) {
    a->state = s;
    CHECK(decideDelivery(a, false) == DeliveryAction::kResendFinal);
  }

  // eviction prefers the oldest finished-and-reported entry over unfinished ones
  l.clear();
  char id[16];
  for (int i = 0; i < 8; i++) {
    snprintf(id, sizeof id, "cmd_%d", i);
    l.upsert(id)->state = CmdState::kStarted;
  }
  l.find("cmd_5")->state = CmdState::kCompleted;
  l.find("cmd_5")->reported = CmdState::kCompleted;
  l.find("cmd_3")->state = CmdState::kCompleted;  // final but not yet acknowledged: must survive
  CHECK(l.upsert("cmd_new") != nullptr);
  CHECK(l.find("cmd_5") == nullptr && l.find("cmd_3") != nullptr && l.find("cmd_0") != nullptr && l.size() == 8);
  CHECK(l.upsert("cmd_new2") != nullptr && l.find("cmd_0") == nullptr);  // then the oldest overall

  // round trip and corruption
  l.find("cmd_3")->reported = CmdState::kStarted;
  strcpy(l.find("cmd_3")->reason, "playback_error");
  std::vector<uint8_t> blob(CommandLedger::kBlobSize);
  CHECK(l.serialize(blob.data(), blob.size()) == CommandLedger::kBlobSize);
  CommandLedger r;
  CHECK(r.deserialize(blob.data(), blob.size()) && r.size() == 8);
  CHECK(r.find("cmd_3") && r.find("cmd_3")->state == CmdState::kCompleted && r.find("cmd_3")->reported == CmdState::kStarted);
  CHECK(strcmp(r.find("cmd_3")->reason, "playback_error") == 0);
  CHECK(r.upsert("cmd_after") != nullptr);  // order counter continues after reload
  blob[10] ^= 0x01;
  CHECK(!r.deserialize(blob.data(), blob.size()) && r.size() == 0);
  CHECK(!r.deserialize(blob.data(), blob.size() - 1));
  CHECK(l.serialize(blob.data(), 10) == 0);
  CHECK(strcmp(cmdStateWire(CmdState::kStarted), "started") == 0 && cmdStateWire(CmdState::kNone) == nullptr);
  CHECK(isFinal(CmdState::kCancelled) && !isFinal(CmdState::kStarted));
}

/* ------------------------------------------------------------------ text */

static void testText() {
  uint8_t out[64];
  CHECK(base64Decode("", 0, out, sizeof out) == 0);
  CHECK(base64Decode("Zg==", 4, out, sizeof out) == 1 && out[0] == 'f');
  CHECK(base64Decode("Zm9vYmFy", 8, out, sizeof out) == 6 && memcmp(out, "foobar", 6) == 0);
  CHECK(base64Decode("Zm9vYg", 6, out, sizeof out) == 4 && memcmp(out, "foob", 4) == 0);
  CHECK(base64Decode("Zm9v!mFy", 8, out, sizeof out) == -1);
  CHECK(base64Decode("Z", 1, out, sizeof out) == -1);
  CHECK(base64Decode("Zm9vYmFy", 8, out, 5) == -1);
  char q[64];
  CHECK(jsonQuote("a\"b\\c\n", q, sizeof q) > 0 && strcmp(q, "\"a\\\"b\\\\c\\u000a\"") == 0);
  CHECK(jsonQuote("abc", q, 5) == -1);
  CHECK(jsonQuote(nullptr, q, sizeof q) == 2 && strcmp(q, "\"\"") == 0);
  CHECK(isRecordId("cap-b1a2.c3:4_5", 128) && !isRecordId("", 128) && !isRecordId("a b", 128) && !isRecordId("abcd", 3));
  const char* pre = "/api/device/v1/commands/";
  CHECK(isSafeDevicePath("/api/device/v1/commands/cmd_1/audio", pre, 200));
  CHECK(!isSafeDevicePath("/api/device/v1/commands/../../admin", pre, 200));
  CHECK(!isSafeDevicePath("https://evil.example/api/device/v1/commands/x", pre, 200));
  CHECK(!isSafeDevicePath("/api/device/v1/commands/x?y=1", pre, 200));
  CHECK(!isSafeDevicePath("/api/device/v1/commands/x", pre, 10));
  char hex[9];
  const uint8_t b[4] = {0x00, 0x9F, 0xA0, 0xFF};
  toHex(b, 4, hex);
  CHECK(strcmp(hex, "009fa0ff") == 0);
}

/* ------------------------------------------------------------------ MP3 */

static std::vector<uint8_t> readFile(const std::string& path) {
  std::vector<uint8_t> v;
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return v;
  uint8_t buf[4096];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, f)) > 0) v.insert(v.end(), buf, buf + n);
  fclose(f);
  return v;
}

struct DecodeResult {
  Mp3Error err = Mp3Error::kOk;
  uint64_t pcm_frames = 0;
  uint32_t calls = 0;
  std::vector<int16_t> left, right;
};

// Decodes a whole inspected stream; keeps the channels for the signal checks. Bounded: every call must advance.
static DecodeResult decodeAll(const std::vector<uint8_t>& v, const Mp3Info& info) {
  DecodeResult r;
  std::vector<uint8_t> state(Mp3Decoder::stateBytes());
  Mp3Decoder d;
  d.begin(state.data(), v.data(), info);
  int16_t pcm[Mp3Decoder::kMaxPcmSamples];
  for (;;) {
    if (++r.calls > v.size()) {  // more calls than bytes: no progress
      r.err = Mp3Error::kDecode;
      break;
    }
    Mp3Error e;
    const int n = d.next(pcm, &e);
    if (n < 0) {
      r.err = e;
      break;
    }
    if (n == 0) break;
    for (int i = 0; i < n; i++) {
      r.left.push_back(pcm[i * info.channels]);
      if (info.channels == 2) r.right.push_back(pcm[i * 2 + 1]);
    }
  }
  r.pcm_frames = d.pcmFramesDecoded();
  return r;
}

// Frequency of the middle half of a tone from its zero crossings, and its RMS.
static void toneStats(const std::vector<int16_t>& s, uint32_t rate, double* hz, double* rms) {
  const size_t a = s.size() / 4, b = s.size() * 3 / 4;
  size_t crossings = 0;
  double sum = 0;
  for (size_t i = a + 1; i < b; i++) {
    if ((s[i - 1] < 0) != (s[i] < 0)) crossings++;
    sum += static_cast<double>(s[i]) * s[i];
  }
  *hz = b > a ? crossings / 2.0 / ((b - a) / static_cast<double>(rate)) : 0;
  *rms = b > a ? sqrt(sum / (b - a)) : 0;
}

static Mp3Error inspect(const std::vector<uint8_t>& v, Mp3Info* info) { return inspectMp3(v.data(), v.size(), info); }

static void testMp3(const char* dir) {
  if (!dir) {
    fprintf(stderr, "FAIL: no MP3 fixture directory given\n");
    g_failures++;
    return;
  }
  struct Fixture {
    const char* file;
    uint32_t rate;
    uint16_t channels;
    uint8_t version;
    double seconds;
  };
  const Fixture fixtures[] = {
      {"mpeg25_8k_mono_16k.mp3", 8000, 1, 25, 1.0},    {"mpeg2_16k_mono_32k.mp3", 16000, 1, 2, 1.0},
      {"mpeg2_22k_mono_48k.mp3", 22050, 1, 2, 1.0},    {"mpeg2_24k_stereo_64k.mp3", 24000, 2, 2, 1.0},
      {"mpeg1_32k_stereo_96k.mp3", 32000, 2, 1, 1.0},  {"mpeg1_44k_stereo_128k.mp3", 44100, 2, 1, 1.5},
      {"mpeg1_48k_stereo_320k.mp3", 48000, 2, 1, 1.0}, {"mpeg1_44k_mono_vbr.mp3", 44100, 1, 1, 1.5},
      {"tagged_16k_mono_32k.mp3", 16000, 1, 2, 1.0},
  };
  printf("mp3 decoder state: %u bytes\n", static_cast<unsigned>(Mp3Decoder::stateBytes()));
  std::vector<uint8_t> mono16, stereo44;
  for (const Fixture& f : fixtures) {
    const std::vector<uint8_t> v = readFile(std::string(dir) + "/" + f.file);
    CHECK(!v.empty());
    Mp3Info info;
    const Mp3Error e = inspect(v, &info);
    CHECK(e == Mp3Error::kOk);
    if (e != Mp3Error::kOk) {
      fprintf(stderr, "  %s: %s\n", f.file, mp3ErrorCode(e));
      continue;
    }
    CHECK(info.sample_rate == f.rate && info.channels == f.channels && info.mpeg_version == f.version);
    // LAME adds an encoder delay and pads to whole frames: the stream is at most ~0.4 s longer than the source.
    CHECK(info.durationMs() >= f.seconds * 1000 && info.durationMs() <= f.seconds * 1000 + 400);
    CHECK(info.audio_end > info.audio_offset && info.audio_end <= v.size());
    const DecodeResult r = decodeAll(v, info);
    CHECK(r.err == Mp3Error::kOk);
    CHECK(r.pcm_frames == info.pcm_frames);
    double hz = 0, rms = 0;
    toneStats(r.left, f.rate, &hz, &rms);
    CHECK(fabs(hz - 440.0) < 440.0 * 0.03);
    CHECK(rms > 8000 && rms < 14000);  // 0.5 full scale sine: RMS ~ 11585
    if (f.channels == 2) {
      toneStats(r.right, f.rate, &hz, &rms);
      CHECK(fabs(hz - 660.0) < 660.0 * 0.03);
    }
    printf("  %-28s %5u Hz %u ch %5u ms %4u frames %3u-%3u kbps%s%s%s decoded %llu pcm frames, %.1f Hz\n", f.file, info.sample_rate,
           info.channels, info.durationMs(), info.frames, info.min_kbps, info.max_kbps, info.has_vbr_header ? " vbr-header" : "",
           info.has_id3v2 ? " id3v2" : "", info.has_tail_tag ? " tail-tag" : "", static_cast<unsigned long long>(r.pcm_frames), hz);
    if (strcmp(f.file, "mpeg2_16k_mono_32k.mp3") == 0) mono16 = v;
    if (strcmp(f.file, "mpeg1_44k_stereo_128k.mp3") == 0) stereo44 = v;
    if (strcmp(f.file, "tagged_16k_mono_32k.mp3") == 0) CHECK(info.has_id3v2 && info.has_tail_tag);
    if (strcmp(f.file, "mpeg1_44k_mono_vbr.mp3") == 0) CHECK(info.min_kbps < info.max_kbps);  // lameenc writes no Xing frame
  }
  if (mono16.empty() || stereo44.empty()) return;

  Mp3Info info;
  {  // a LAME "Info" metadata frame before the audio: recognised, not counted, not decoded
    Mp3Info plain;
    CHECK(inspect(stereo44, &plain) == Mp3Error::kOk);
    const uint32_t first_bytes = 144000u * 128 / 44100;  // 128 kbps, 44.1 kHz, no padding bit set below
    std::vector<uint8_t> v(first_bytes, 0);
    v[0] = 0xFF, v[1] = 0xFB, v[2] = 0x90, v[3] = 0x44;  // MPEG-1 Layer III, no CRC, 128 kbps, 44.1 kHz, joint stereo
    memcpy(&v[4 + 32], "Info", 4);
    v.insert(v.end(), stereo44.begin(), stereo44.end());
    CHECK(inspect(v, &info) == Mp3Error::kOk && info.has_vbr_header && info.frames == plain.frames && info.audio_offset == first_bytes);
    CHECK(decodeAll(v, info).pcm_frames == plain.pcm_frames);
  }
  {  // truncated in the middle of the last frame (an interrupted upload or download)
    std::vector<uint8_t> v(mono16.begin(), mono16.end() - 40);
    CHECK(inspect(v, &info) == Mp3Error::kTruncatedFrame);
  }
  {  // trailing bytes that are neither a tag nor zero padding
    std::vector<uint8_t> v = mono16;
    v.insert(v.end(), {'j', 'u', 'n', 'k', 'j', 'u', 'n', 'k'});
    CHECK(inspect(v, &info) == Mp3Error::kTrailingData);
  }
  {  // zero padding after the last frame is accepted and not decoded
    std::vector<uint8_t> v = mono16;
    v.insert(v.end(), 500, 0);
    CHECK(inspect(v, &info) == Mp3Error::kOk && info.audio_end == mono16.size());
  }
  {  // two streams spliced together: the sample rate and layout change
    std::vector<uint8_t> v = mono16;
    v.insert(v.end(), stereo44.begin(), stereo44.end());
    CHECK(inspect(v, &info) == Mp3Error::kFormatChanged);
  }
  {  // not MP3 at all: a WAV header, random text, empty
    WavSpec s;
    const std::vector<uint8_t> wav = makeWav(s);
    CHECK(inspect(wav, &info) == Mp3Error::kNoFrame);
    const std::vector<uint8_t> text = {'h', 'e', 'l', 'l', 'o', ' ', 'm', 'p', '3'};
    CHECK(inspect(text, &info) == Mp3Error::kNoFrame);
    CHECK(inspectMp3(nullptr, 0, &info) == Mp3Error::kTooShort);
    CHECK(inspectMp3(mono16.data(), 3, &info) == Mp3Error::kTooShort);
  }
  {  // Layer II, free format, reserved version and sample rate
    std::vector<uint8_t> v = {0xFF, 0xFD, 0x90, 0x00, 0, 0, 0, 0};
    CHECK(inspect(v, &info) == Mp3Error::kNotLayer3);
    v = {0xFF, 0xFB, 0x00, 0x00, 0, 0, 0, 0};
    CHECK(inspect(v, &info) == Mp3Error::kFreeFormat);
    v = {0xFF, 0xEB, 0x90, 0x00, 0, 0, 0, 0};
    CHECK(inspect(v, &info) == Mp3Error::kBadHeader);
    v = {0xFF, 0xFB, 0x9C, 0x00, 0, 0, 0, 0};
    CHECK(inspect(v, &info) == Mp3Error::kBadHeader);
  }
  {  // ID3v2 with a size that is not syncsafe, or larger than the file
    std::vector<uint8_t> v = {'I', 'D', '3', 3, 0, 0, 0, 0, 0x80, 0};
    v.insert(v.end(), mono16.begin(), mono16.end());
    CHECK(inspect(v, &info) == Mp3Error::kBadId3);
    v = {'I', 'D', '3', 3, 0, 0, 0x7F, 0x7F, 0x7F, 0x7F};
    CHECK(inspect(v, &info) == Mp3Error::kBadId3);
  }
  {  // corrupted payloads: inspection may pass (headers intact), decoding must stay bounded and never crash
    uint32_t seed = 12345, passed = 0, decoded_ok = 0;
    for (int round = 0; round < 300; round++) {
      std::vector<uint8_t> v = stereo44;
      for (int k = 0; k < 40; k++) {
        seed = seed * 1103515245u + 12345u;
        v[(seed >> 8) % v.size()] ^= static_cast<uint8_t>(1u << ((seed >> 4) & 7));
      }
      if (inspect(v, &info) != Mp3Error::kOk) continue;
      passed++;
      const DecodeResult r = decodeAll(v, info);
      CHECK(r.calls <= v.size());
      CHECK(r.pcm_frames <= info.pcm_frames);
      if (r.err == Mp3Error::kOk) decoded_ok++;
    }
    printf("  fuzz: 300 corrupted copies, %u passed the header walk, %u decoded to the end\n", passed, decoded_ok);
  }
}

int main(int argc, char** argv) {
  testWav(argc > 1 ? argv[1] : nullptr);
  testPcm();
  testJpeg();
  testLedger();
  testText();
  testMp3(argc > 2 ? argv[2] : nullptr);
  printf("%s: %d checks, %d failures\n", g_failures ? "FAIL" : "PASS", g_checks, g_failures);
  return g_failures ? 1 : 0;
}
