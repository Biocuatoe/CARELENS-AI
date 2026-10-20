// HTTPS client for the device API (ESP-IDF esp_http_client over mbedTLS). The server certificate and host name are
// always verified: against the provisioned trust anchor when one is set (local test CA), otherwise against the
// ESP-IDF certificate bundle. There is no option to skip verification and plain http:// is refused. One instance,
// used only by the cloud task; the connection is kept alive between requests.
#pragma once

#include <esp_http_client.h>
#include <stddef.h>
#include <stdint.h>

namespace carelens {

struct HttpResult {
  int status = 0;          // HTTP status, 0 when the exchange did not complete
  esp_err_t err = ESP_OK;  // transport error (connect, TLS, timeout)
  size_t body_len = 0;
  bool body_truncated = false;
  uint32_t retry_after_s = 0;
  char content_range[64] = {0};
  bool ok() const { return err == ESP_OK && status >= 200 && status < 300; }
  bool transport() const { return err != ESP_OK || status == 0; }
};

class Https {
 public:
  // base: "https://host[:port]"; token: device bearer; ca_pem: nullptr/empty for the bundle. Strings must outlive this.
  bool begin(const char* base, const char* token, const char* ca_pem);
  // Sends one request. body may be nullptr. The response body is written to resp (up to resp_cap bytes, NUL
  // terminated when it fits). range: optional "bytes=a-b".
  HttpResult request(esp_http_client_method_t method, const char* path, const char* content_type, const uint8_t* body, size_t body_len, uint8_t* resp,
                     size_t resp_cap, const char* range = nullptr, uint32_t timeout_ms = 15000);
  void reset();  // drops the connection (after transport errors)
  uint32_t requests() const { return requests_; }
  uint32_t transportErrors() const { return transport_errors_; }

 private:
  static esp_err_t onEvent(esp_http_client_event_t* evt);
  bool ensure();

  esp_http_client_handle_t h_ = nullptr;
  const char* base_ = nullptr;
  const char* token_ = nullptr;
  const char* ca_ = nullptr;
  char auth_[240] = {0};
  // per-request sink
  uint8_t* sink_ = nullptr;
  size_t sink_cap_ = 0;
  HttpResult* cur_ = nullptr;
  uint32_t requests_ = 0;
  uint32_t transport_errors_ = 0;
};

}  // namespace carelens
