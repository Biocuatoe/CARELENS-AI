// JPEG header check that mirrors the backend's inspectJpeg (worker/src/media.ts): SOI, marker walk to the first SOF
// for the dimensions, EOI at the end (trailing zero padding tolerated). Pixels are never decoded. Pure C++.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

struct JpegInfo {
  uint16_t width = 0;
  uint16_t height = 0;
};

// Returns false for anything that is not a well-formed baseline or progressive JPEG header.
bool inspectJpeg(const uint8_t* bytes, size_t len, JpegInfo* out);

}  // namespace carelens
