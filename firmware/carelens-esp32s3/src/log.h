// Diagnostic log on UART0 (Serial0 -> CH343 bridge -> COM6), the interface verified on this board. `Serial` is the
// native USB CDC port (ARDUINO_USB_CDC_ON_BOOT=1, kept from the baseline) and is not connected to the PC.
// Never pass tokens, passwords, Wi-Fi credentials, image bytes or URLs with secrets to logf.
#pragma once

#include <stdarg.h>

namespace carelens {

void logBegin();
void logf(const char* tag, const char* fmt, ...) __attribute__((format(printf, 2, 3)));

}  // namespace carelens
