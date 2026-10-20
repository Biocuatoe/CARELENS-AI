// Device side of the care-monitoring device contract v2 (docs/DEVICE_API.md): heartbeat, command delivery and
// acknowledgement, audio download with SHA-256 verification, raw IMU batches, firmware triggers and camera bursts.
// Runs as one task on CPU1; it is the only user of the HTTPS client.
#pragma once

#include <stddef.h>

#include "settings.h"

namespace carelens {

bool cloudStart(const Settings* cfg);  // no-op (false) when the cloud settings are incomplete
bool cloudRunning();
void cloudRequestBurst();              // console: one normal burst through the upload path
void cloudStatus(char* out, size_t cap);

}  // namespace carelens
