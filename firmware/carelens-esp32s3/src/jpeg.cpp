#include "jpeg.h"

namespace carelens {

bool inspectJpeg(const uint8_t* b, size_t len, JpegInfo* out) {
  if (b == nullptr || out == nullptr || len < 4 || b[0] != 0xFF || b[1] != 0xD8) return false;
  size_t end = len;
  while (end > 2 && b[end - 1] == 0x00) end--;
  if (b[end - 2] != 0xFF || b[end - 1] != 0xD9) return false;
  size_t i = 2;
  while (i + 4 <= end) {
    if (b[i] != 0xFF) return false;
    uint8_t marker = b[i + 1];
    while (marker == 0xFF && i + 2 < end) {
      i++;
      marker = b[i + 1];
    }
    if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2;
      continue;
    }
    if (i + 4 > end) return false;
    const size_t length = (static_cast<size_t>(b[i + 2]) << 8) | b[i + 3];
    if (length < 2 || i + 2 + length > end) return false;
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
    if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
      if (length < 7) return false;
      const uint16_t height = static_cast<uint16_t>((b[i + 5] << 8) | b[i + 6]);
      const uint16_t width = static_cast<uint16_t>((b[i + 7] << 8) | b[i + 8]);
      if (width == 0 || height == 0) return false;
      out->width = width;
      out->height = height;
      return true;
    }
    if (marker == 0xDA || marker == 0xD9) return false;  // scan data before any frame header
    i += 2 + length;
  }
  return false;
}

}  // namespace carelens
