// Command ledger: the device-side memory of recent command ids and how far each got, persisted in NVS so that a
// redelivered or post-reboot command is never played twice (docs/DEVICE_API.md §8.2 rule 1, ADR-022 rule 5).
// Pure C++ (host-tested). The cloud task owns the only instance.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

enum class CmdState : uint8_t {
  kNone = 0,
  kReceived = 1,   // stored on the device, nothing played
  kAccepted = 2,   // audio downloaded and verified, nothing played
  kStarted = 3,    // playback was handed to I2S: never start this command again
  kCompleted = 4,  // played to the end
  kFailed = 5,
  kRejected = 6,
  kCancelled = 7,
};

bool isFinal(CmdState s);
// Status word of command-status.v2 for a state ("received", "accepted", ...); nullptr for kNone.
const char* cmdStateWire(CmdState s);

struct LedgerEntry {
  static constexpr size_t kIdLen = 72;
  static constexpr size_t kReasonLen = 32;
  char id[kIdLen] = {0};
  CmdState state = CmdState::kNone;
  CmdState reported = CmdState::kNone;  // last state the server acknowledged (2xx or duplicate)
  char reason[kReasonLen] = {0};        // reason_code that goes with a failed/rejected/cancelled state
  uint32_t order = 0;                   // insertion counter, for eviction
};

// What to do when GET /commands/next hands out a command id.
enum class DeliveryAction : uint8_t {
  kProcess,         // unknown, or known but never played: (re)process from the start
  kIgnore,          // the device is working on it right now
  kResendFinal,     // already finished: report the final state again (idempotent)
  kFailNotReplay,   // was started before (e.g. before a reboot) but not finished: never replay, report failed
};

DeliveryAction decideDelivery(const LedgerEntry* known, bool active_now);

class CommandLedger {
 public:
  static constexpr size_t kCapacity = 8;
  static constexpr size_t kBlobSize = 4 + kCapacity * (LedgerEntry::kIdLen + 2 + LedgerEntry::kReasonLen + 4) + 4;

  LedgerEntry* find(const char* id);
  // Returns the entry for id, creating it (evicting the oldest finished-and-reported entry, else the oldest) if absent.
  LedgerEntry* upsert(const char* id);
  void clear();
  size_t size() const;
  const LedgerEntry& at(size_t i) const { return entries_[i]; }

  // Versioned, CRC-protected byte image for NVS. deserialize() leaves the ledger empty on any corruption.
  size_t serialize(uint8_t* out, size_t cap) const;
  bool deserialize(const uint8_t* in, size_t len);

 private:
  LedgerEntry entries_[kCapacity];
  uint32_t next_order_ = 1;
};

uint32_t crc32(const uint8_t* data, size_t len);

}  // namespace carelens
