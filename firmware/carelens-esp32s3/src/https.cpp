#include "https.h"

#include <esp_crt_bundle.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "log.h"

namespace carelens {

bool Https::begin(const char* base, const char* token, const char* ca_pem) {
  if (base == nullptr || strncmp(base, "https://", 8) != 0 || token == nullptr) return false;
  base_ = base;
  token_ = token;
  ca_ = (ca_pem && ca_pem[0]) ? ca_pem : nullptr;
  snprintf(auth_, sizeof auth_, "Bearer %s", token_);
  return ensure();
}

bool Https::ensure() {
  if (h_) return true;
  char url[160];
  snprintf(url, sizeof url, "%s/health", base_);
  esp_http_client_config_t cfg = {};
  cfg.url = url;
  cfg.timeout_ms = 15000;
  cfg.event_handler = &Https::onEvent;
  cfg.user_data = this;
  cfg.buffer_size = 4096;
  cfg.buffer_size_tx = 2048;
  cfg.disable_auto_redirect = true;
  cfg.keep_alive_enable = true;
  if (ca_) {
    cfg.cert_pem = ca_;
  } else {
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
  }
  h_ = esp_http_client_init(&cfg);
  if (!h_) {
    logf("https", "client init failed");
    return false;
  }
  esp_http_client_set_header(h_, "Authorization", auth_);
  esp_http_client_set_header(h_, "Accept", "application/json");
  esp_http_client_set_header(h_, "User-Agent", "carelens-esp32s3");
  return true;
}

void Https::reset() {
  if (h_) {
    esp_http_client_cleanup(h_);
    h_ = nullptr;
  }
}

esp_err_t Https::onEvent(esp_http_client_event_t* evt) {
  Https* self = static_cast<Https*>(evt->user_data);
  if (self == nullptr || self->cur_ == nullptr) return ESP_OK;
  HttpResult* r = self->cur_;
  if (evt->event_id == HTTP_EVENT_ON_HEADER && evt->header_key && evt->header_value) {
    if (strcasecmp(evt->header_key, "Retry-After") == 0) r->retry_after_s = static_cast<uint32_t>(strtoul(evt->header_value, nullptr, 10));
    if (strcasecmp(evt->header_key, "Content-Range") == 0) strncpy(r->content_range, evt->header_value, sizeof r->content_range - 1);
  } else if (evt->event_id == HTTP_EVENT_ON_DATA && evt->data_len > 0) {
    const size_t n = static_cast<size_t>(evt->data_len);
    if (self->sink_ && r->body_len + n <= self->sink_cap_) {
      memcpy(self->sink_ + r->body_len, evt->data, n);
    } else if (self->sink_) {
      const size_t room = self->sink_cap_ > r->body_len ? self->sink_cap_ - r->body_len : 0;
      if (room) memcpy(self->sink_ + r->body_len, evt->data, room);
      r->body_truncated = true;
    }
    r->body_len += n;
  }
  return ESP_OK;
}

HttpResult Https::request(esp_http_client_method_t method, const char* path, const char* content_type, const uint8_t* body, size_t body_len, uint8_t* resp,
                          size_t resp_cap, const char* range, uint32_t timeout_ms) {
  HttpResult r;
  if (!ensure()) {
    r.err = ESP_FAIL;
    transport_errors_++;
    return r;
  }
  char url[256];
  if (snprintf(url, sizeof url, "%s%s", base_, path) >= static_cast<int>(sizeof url)) {
    r.err = ESP_ERR_INVALID_SIZE;
    return r;
  }
  esp_http_client_set_url(h_, url);
  esp_http_client_set_method(h_, method);
  esp_http_client_set_timeout_ms(h_, static_cast<int>(timeout_ms));
  if (content_type) {
    esp_http_client_set_header(h_, "Content-Type", content_type);
  } else {
    esp_http_client_delete_header(h_, "Content-Type");
  }
  if (range) {
    esp_http_client_set_header(h_, "Range", range);
  } else {
    esp_http_client_delete_header(h_, "Range");
  }
  esp_http_client_set_post_field(h_, reinterpret_cast<const char*>(body), static_cast<int>(body ? body_len : 0));
  sink_ = resp;
  sink_cap_ = resp ? resp_cap : 0;
  cur_ = &r;
  requests_++;
  r.err = esp_http_client_perform(h_);
  cur_ = nullptr;
  if (r.err == ESP_OK) {
    r.status = esp_http_client_get_status_code(h_);
  } else {
    transport_errors_++;
    logf("https", "%s %s transport error %s", method == HTTP_METHOD_GET ? "GET" : method == HTTP_METHOD_PUT ? "PUT" : "POST", path, esp_err_to_name(r.err));
    reset();  // a fresh connection (and TLS session) for the next request
  }
  if (resp && r.body_len < resp_cap) resp[r.body_len] = '\0';  // text bodies; binary callers use body_len
  sink_ = nullptr;
  return r;
}

}  // namespace carelens
