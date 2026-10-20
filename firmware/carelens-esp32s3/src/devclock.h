// Device clock of contract v2 (docs/DEVICE_API.md §2): a random boot_id per boot, 64-bit uptime from esp_timer, and
// SNTP wall time that is reported only after a successful sync in this boot.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace carelens {

void clockBegin();
const char* bootId();
uint64_t uptimeMs();
void sntpStart();
bool wallSynced();
// Writes the JSON object {"boot_id":..,"uptime_ms":..,"wall_clock_synced":..,"wall_time":..}. Returns length or -1.
int clockJson(char* out, size_t cap);

}  // namespace carelens
