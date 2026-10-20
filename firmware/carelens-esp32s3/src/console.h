// Line console on UART0 (115200 8N1) for provisioning and diagnostics. Lines are never echoed; values of secret keys
// are never printed (only their length). Commands: help.
#pragma once

#include "settings.h"

namespace carelens {

void consoleBegin(Settings* live);
void consolePoll();  // call from loop()
bool consoleWifiHeld();  // a wifidrop test is keeping Wi-Fi off: do not reconnect

}  // namespace carelens
