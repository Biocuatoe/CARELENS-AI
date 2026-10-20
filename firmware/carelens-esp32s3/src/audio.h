// Speaker path: one FreeRTOS task owns the I2S peripheral (MAX98357A) and plays jobs from a queue. Every result is
// measured, not assumed: "started" is reported only after the first block was accepted by the I2S driver, "finished"
// only after the last sample and a drain of silence were written, and any short write is a failure.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "ledger.h"
#include "mp3.h"

namespace carelens {

enum class AudioKind : uint8_t { kPcm, kTone, kSweep, kBuzzer, kChime, kDoReMi, kMp3 };

struct AudioJob {
  AudioKind kind = AudioKind::kTone;
  char tag[LedgerEntry::kIdLen] = {0};  // command id, or "local:<name>" for console/greeting jobs
  // kPcm: interleaved 16-bit LE frames. kMp3: the whole MP3 file (`bytes`) that passed inspectMp3 (`mp3`), decoded
  // frame by frame while it plays. Either way the data stays owned by the submitter until the job's final event.
  const uint8_t* data = nullptr;
  size_t frames = 0;
  size_t bytes = 0;
  Mp3Info mp3;
  uint16_t channels = 1;
  uint32_t rate = 16000;
  // kTone
  float tone_hz = 1000.0f;
  uint32_t tone_ms = 300;
  float tone_amp = 0.9f;
  // kBuzzer
  uint32_t on_ms = 500, off_ms = 500, total_ms = 30000;
};

enum class AudioEventKind : uint8_t { kStarted, kFinished, kFailed, kStopped };

struct AudioEvent {
  AudioEventKind kind;
  char tag[LedgerEntry::kIdLen];
  char reason[24];  // failure code, e.g. "i2s_write_short"
  uint32_t frames_written;
};

bool audioBegin(float volume);  // configures I2S at 16 kHz once; no retry loop
bool audioReady();
void audioSetVolume(float v);
float audioVolume();
bool audioSubmit(const AudioJob& job);  // false if the queue is full or audio is not ready
void audioStop();                        // asks the current job to stop (event kStopped)
bool audioBusy();
bool audioPollEvent(AudioEvent* ev, uint32_t wait_ms);  // events of command jobs only (tag not "local:")

// Measurements of the last MP3 job (decoder CPU time is wall time spent inside the decoder on the audio task).
struct Mp3PlayStats {
  uint32_t frames = 0, skipped = 0;
  uint32_t decode_us_total = 0, decode_us_max = 0;
  uint32_t play_ms = 0, stream_ms = 0;  // wall time of the job; duration of the stream from its headers
  uint32_t stack_free_bytes = 0;        // audio task stack high-water mark after the job
};
Mp3PlayStats audioLastMp3Stats();

}  // namespace carelens
