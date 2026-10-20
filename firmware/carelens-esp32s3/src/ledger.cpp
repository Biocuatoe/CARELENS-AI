#include "ledger.h"

#include <string.h>

namespace carelens {
namespace {

constexpr uint32_t kMagic = 0x4C434C31;  // "LCL1"

void put32(uint8_t* p, uint32_t v) {
  p[0] = static_cast<uint8_t>(v);
  p[1] = static_cast<uint8_t>(v >> 8);
  p[2] = static_cast<uint8_t>(v >> 16);
  p[3] = static_cast<uint8_t>(v >> 24);
}
uint32_t get32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}
bool validState(uint8_t v) { return v <= static_cast<uint8_t>(CmdState::kCancelled); }

}  // namespace

bool isFinal(CmdState s) {
  return s == CmdState::kCompleted || s == CmdState::kFailed || s == CmdState::kRejected || s == CmdState::kCancelled;
}

const char* cmdStateWire(CmdState s) {
  switch (s) {
    case CmdState::kReceived: return "received";
    case CmdState::kAccepted: return "accepted";
    case CmdState::kStarted: return "started";
    case CmdState::kCompleted: return "completed";
    case CmdState::kFailed: return "failed";
    case CmdState::kRejected: return "rejected";
    case CmdState::kCancelled: return "cancelled";
    case CmdState::kNone: break;
  }
  return nullptr;
}

DeliveryAction decideDelivery(const LedgerEntry* known, bool active_now) {
  if (known == nullptr || known->state == CmdState::kNone) return DeliveryAction::kProcess;
  if (active_now) return DeliveryAction::kIgnore;
  if (isFinal(known->state)) return DeliveryAction::kResendFinal;
  if (known->state == CmdState::kStarted) return DeliveryAction::kFailNotReplay;
  return DeliveryAction::kProcess;  // received/accepted but never played (e.g. reboot during download)
}

LedgerEntry* CommandLedger::find(const char* id) {
  if (id == nullptr || id[0] == '\0') return nullptr;
  for (auto& e : entries_) {
    if (e.state != CmdState::kNone && strncmp(e.id, id, LedgerEntry::kIdLen) == 0) return &e;
  }
  return nullptr;
}

LedgerEntry* CommandLedger::upsert(const char* id) {
  if (id == nullptr || id[0] == '\0' || strlen(id) >= LedgerEntry::kIdLen) return nullptr;
  if (LedgerEntry* e = find(id)) return e;
  LedgerEntry* slot = nullptr;
  for (auto& e : entries_) {
    if (e.state == CmdState::kNone) {
      slot = &e;
      break;
    }
  }
  if (slot == nullptr) {  // evict: oldest entry whose final state the server already has, else the oldest entry
    for (auto& e : entries_) {
      if (isFinal(e.state) && e.reported == e.state && (slot == nullptr || e.order < slot->order)) slot = &e;
    }
  }
  if (slot == nullptr) {
    for (auto& e : entries_) {
      if (slot == nullptr || e.order < slot->order) slot = &e;
    }
  }
  *slot = LedgerEntry();
  strncpy(slot->id, id, LedgerEntry::kIdLen - 1);
  slot->state = CmdState::kReceived;
  slot->order = next_order_++;
  return slot;
}

void CommandLedger::clear() {
  for (auto& e : entries_) e = LedgerEntry();
  next_order_ = 1;
}

size_t CommandLedger::size() const {
  size_t n = 0;
  for (const auto& e : entries_) n += e.state != CmdState::kNone;
  return n;
}

size_t CommandLedger::serialize(uint8_t* out, size_t cap) const {
  if (out == nullptr || cap < kBlobSize) return 0;
  uint8_t* p = out;
  put32(p, kMagic);
  p += 4;
  for (const auto& e : entries_) {
    memcpy(p, e.id, LedgerEntry::kIdLen);
    p += LedgerEntry::kIdLen;
    *p++ = static_cast<uint8_t>(e.state);
    *p++ = static_cast<uint8_t>(e.reported);
    memcpy(p, e.reason, LedgerEntry::kReasonLen);
    p += LedgerEntry::kReasonLen;
    put32(p, e.order);
    p += 4;
  }
  put32(p, crc32(out, static_cast<size_t>(p - out)));
  p += 4;
  return static_cast<size_t>(p - out);
}

bool CommandLedger::deserialize(const uint8_t* in, size_t len) {
  clear();
  if (in == nullptr || len != kBlobSize || get32(in) != kMagic) return false;
  if (crc32(in, kBlobSize - 4) != get32(in + kBlobSize - 4)) return false;
  CommandLedger tmp;
  const uint8_t* p = in + 4;
  uint32_t max_order = 0;
  for (auto& e : tmp.entries_) {
    memcpy(e.id, p, LedgerEntry::kIdLen);
    e.id[LedgerEntry::kIdLen - 1] = '\0';
    p += LedgerEntry::kIdLen;
    if (!validState(p[0]) || !validState(p[1])) return false;
    e.state = static_cast<CmdState>(*p++);
    e.reported = static_cast<CmdState>(*p++);
    memcpy(e.reason, p, LedgerEntry::kReasonLen);
    e.reason[LedgerEntry::kReasonLen - 1] = '\0';
    p += LedgerEntry::kReasonLen;
    e.order = get32(p);
    p += 4;
    if (e.order > max_order) max_order = e.order;
  }
  tmp.next_order_ = max_order + 1;
  *this = tmp;
  return true;
}

uint32_t crc32(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

}  // namespace carelens
