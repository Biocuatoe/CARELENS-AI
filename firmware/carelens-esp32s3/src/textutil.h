// Small text helpers shared by firmware and host tests: base64 decoding for the provisioning console, JSON string
// escaping, and the identifier/path checks applied to values the server hands to the device. Pure C++.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

// Standard base64 (RFC 4648, '=' padding optional). Returns the decoded length, or -1 on bad input or overflow.
int base64Decode(const char* in, size_t in_len, uint8_t* out, size_t out_cap);

// Writes s as a JSON string literal (with quotes) into out. Returns chars written (excluding NUL), or -1 if it
// does not fit. Control characters are escaped as \u00XX.
int jsonQuote(const char* s, char* out, size_t cap);

// True for 1..max_len characters of [A-Za-z0-9._:-] (the DeviceId/RecordId pattern of the contracts).
bool isRecordId(const char* s, size_t max_len);

// True for a server-supplied device path such as "/api/device/v1/commands/<id>/audio": it must start with
// prefix, contain only [A-Za-z0-9._:/-] and no "..", so a response can never point the device elsewhere.
bool isSafeDevicePath(const char* path, const char* prefix, size_t max_len);

// Lowercase hex of len bytes into out (2*len+1 bytes).
void toHex(const uint8_t* bytes, size_t len, char* out);

}  // namespace carelens
