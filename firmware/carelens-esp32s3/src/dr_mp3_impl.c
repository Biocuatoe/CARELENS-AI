/* The single compilation of the vendored dr_mp3 decoder (src/third_party/dr_mp3/README.md). No file I/O, no SIMD paths
   (x86/ARM only); only the low-level push API is used, from mp3.cpp. Warnings of third-party code are not ours to fix. */
#if defined(__GNUC__)
#pragma GCC diagnostic ignored "-Wall"
#pragma GCC diagnostic ignored "-Wextra"
#pragma GCC diagnostic ignored "-Wunused-function"
#endif
#define DR_MP3_IMPLEMENTATION
#define DR_MP3_NO_STDIO
#define DR_MP3_NO_SIMD
#include "third_party/dr_mp3/dr_mp3.h"
