#include "devclock.h"

#include <Arduino.h>
#include <esp_random.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <stdio.h>
#include <sys/time.h>
#include <time.h>

#include "log.h"

namespace carelens {
namespace {

char g_boot_id[20] = {0};
volatile bool g_synced = false;
constexpr time_t kSaneEpoch = 1767225600;  // 2026-01-01T00:00:00Z: a clock before this is not synchronised

void onSync(struct timeval*) {
  if (!g_synced) logf("clock", "sntp synchronised");
  g_synced = true;
}

}  // namespace

void clockBegin() {
  uint8_t r[6];
  esp_fill_random(r, sizeof r);
  snprintf(g_boot_id, sizeof g_boot_id, "b-%02x%02x%02x%02x%02x%02x", r[0], r[1], r[2], r[3], r[4], r[5]);
}

const char* bootId() { return g_boot_id; }

uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000ULL; }

void sntpStart() {
  sntp_set_time_sync_notification_cb(onSync);
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
}

bool wallSynced() { return g_synced && time(nullptr) > kSaneEpoch; }

int clockJson(char* out, size_t cap) {
  const uint64_t up = uptimeMs();
  char wall[40] = "null";
  const bool synced = wallSynced();
  if (synced) {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    struct tm tm;
    gmtime_r(&tv.tv_sec, &tm);
    char base[24];
    strftime(base, sizeof base, "%Y-%m-%dT%H:%M:%S", &tm);
    snprintf(wall, sizeof wall, "\"%s.%03ldZ\"", base, static_cast<long>(tv.tv_usec / 1000));
  }
  const int n = snprintf(out, cap, "{\"boot_id\":\"%s\",\"uptime_ms\":%llu,\"wall_clock_synced\":%s,\"wall_time\":%s}", g_boot_id,
                         static_cast<unsigned long long>(up), synced ? "true" : "false", wall);
  return n > 0 && static_cast<size_t>(n) < cap ? n : -1;
}

}  // namespace carelens
