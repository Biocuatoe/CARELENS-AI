#include "textutil.h"

#include <stdio.h>
#include <string.h>

namespace carelens {
namespace {

int b64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

}  // namespace

int base64Decode(const char* in, size_t in_len, uint8_t* out, size_t out_cap) {
  if (in == nullptr || out == nullptr) return -1;
  while (in_len > 0 && in[in_len - 1] == '=') in_len--;
  if (in_len % 4 == 1) return -1;
  size_t n = 0;
  uint32_t acc = 0;
  int bits = 0;
  for (size_t i = 0; i < in_len; i++) {
    const int v = b64Value(in[i]);
    if (v < 0) return -1;
    acc = (acc << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (n >= out_cap) return -1;
      out[n++] = static_cast<uint8_t>((acc >> bits) & 0xFF);
    }
  }
  return static_cast<int>(n);
}

int jsonQuote(const char* s, char* out, size_t cap) {
  if (out == nullptr || cap < 3) return -1;
  size_t n = 0;
  out[n++] = '"';
  for (const unsigned char* p = reinterpret_cast<const unsigned char*>(s ? s : ""); *p; p++) {
    char esc[8];
    size_t len = 0;
    if (*p == '"' || *p == '\\') {
      esc[0] = '\\';
      esc[1] = static_cast<char>(*p);
      len = 2;
    } else if (*p < 0x20) {
      len = static_cast<size_t>(snprintf(esc, sizeof esc, "\\u%04x", *p));
    } else {
      esc[0] = static_cast<char>(*p);
      len = 1;
    }
    if (n + len + 2 > cap) return -1;
    memcpy(out + n, esc, len);
    n += len;
  }
  out[n++] = '"';
  out[n] = '\0';
  return static_cast<int>(n);
}

bool isRecordId(const char* s, size_t max_len) {
  if (s == nullptr) return false;
  size_t n = 0;
  for (; s[n]; n++) {
    const char c = s[n];
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == ':' || c == '-';
    if (!ok || n >= max_len) return false;
  }
  return n > 0;
}

bool isSafeDevicePath(const char* path, const char* prefix, size_t max_len) {
  if (path == nullptr || prefix == nullptr) return false;
  const size_t n = strlen(path);
  if (n == 0 || n > max_len || strncmp(path, prefix, strlen(prefix)) != 0 || strstr(path, "..") != nullptr) return false;
  for (size_t i = 0; i < n; i++) {
    const char c = path[i];
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == ':' || c == '-' || c == '/';
    if (!ok) return false;
  }
  return true;
}

void toHex(const uint8_t* bytes, size_t len, char* out) {
  static const char kHex[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[2 * i] = kHex[bytes[i] >> 4];
    out[2 * i + 1] = kHex[bytes[i] & 0x0F];
  }
  out[2 * len] = '\0';
}

}  // namespace carelens
