#include "log.h"

#include <Arduino.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <stdio.h>

namespace carelens {
namespace {
SemaphoreHandle_t g_mutex = nullptr;
}

void logBegin() {
  Serial0.setRxBufferSize(4096);  // provisioning lines (base64 CA certificate) are up to ~3 KB
  Serial0.begin(115200);
  g_mutex = xSemaphoreCreateMutex();
}

void logf(const char* tag, const char* fmt, ...) {
  char msg[300];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof msg, fmt, ap);
  va_end(ap);
  char line[340];
  const uint64_t ms = static_cast<uint64_t>(esp_timer_get_time()) / 1000ULL;
  const int n = snprintf(line, sizeof line, "[%7lu.%03lu] %s: %s\r\n", static_cast<unsigned long>(ms / 1000), static_cast<unsigned long>(ms % 1000), tag, msg);
  if (g_mutex) xSemaphoreTake(g_mutex, portMAX_DELAY);
  Serial0.write(reinterpret_cast<const uint8_t*>(line), n > 0 && n < static_cast<int>(sizeof line) ? n : sizeof line - 1);
  if (g_mutex) xSemaphoreGive(g_mutex);
}

}  // namespace carelens
