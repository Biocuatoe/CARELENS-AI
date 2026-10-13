# EcoPatch Demo Script

Demo infrastructure for presenting EcoPatch vital signs monitoring and patch lifecycle management.

> **⚠️ IMPORTANT: This is a demo with simulated data.**
> All measurements, vitals, and patch sessions are **simulated** for demonstration purposes.
> GSR is NOT hydration level; no medical claims are made.

## Core Technology

> **PRD Requirements — Not Yet Verified**
> The following describes the intended system as specified in the EcoPatch PRD:
>
> - **Hardware:** nRF52832 BLE chip + EcoPatch bio-patch
> - **Sensors:** ECG, GSR (Galvanic Skin Response)
> - **Connectivity:** BLE → phone/gateway → cloud backend
> - **Metrics:** Heart rate, HRV, stress index (from GSR)
> - **Patch Lifecycle:** 7-14 day wear time
>
> This demo uses **simulated data** until real hardware is integrated (M5).

## EcoPatch Commands

### Vital Signs

#### `/vitals`
Sends a normal heart rate measurement.

**Command:**
```
/vitals
```

**Demo Method:** `demoAdapter.ingestMeasurement()`
**Parameters:**
- value: 72 (simulated)
- quality: good
- metric: heart_rate
- unit: bpm

**Expected UI Response:**
- S06: Latest measurement updates to 72 bpm
- S07: Chart shows new data point
- Source freshness indicator updates

**Acceptance Criteria:** AC08

---

#### `/vitals_late`
Sends a measurement that arrived late.

**Command:**
```
/vitals_late
```

**Demo Method:** `demoAdapter.ingestMeasurement()` with late timestamp
**Parameters:**
- value: 71
- quality: fair
- observedAt: 55 minutes ago

**Expected UI Response:**
- S06: "Late measurement" indicator
- S07: Gap in chart with late data point
- Value does not replace latest measurement

**Acceptance Criteria:** AC08

---

#### `/vitals_gap`
Sends measurements after a data gap.

**Command:**
```
/vitals_gap
```

**Demo Method:** Creates gap in measurement stream, then sends data
**Parameters:**
- Creates 30-minute gap
- Sends measurements on either side

**Expected UI Response:**
- S07: Chart shows break/dotted line at gap
- "Gap in data" indicator
- Legend notes the discontinuity

**Acceptance Criteria:** AC08

---

### Patch Management

#### `/patch_replace`
Initiates a patch replacement workflow.

**Command:**
```
/patch_replace
```

**Expected UI Response:**
- S09: Patch replacement form opens
- Form pre-filled with:
  - Core device selected
  - Current date/time
  - Expected replacement date (7 days from now)

**Acceptance Criteria:** AC10

---

#### `/patch_idempotent`
Tests idempotent patch replacement.

**Command:**
```
/patch_idempotent
```

**Demo Method:** Sends same patch replacement twice
**Parameters:**
- Same idempotency key both times
- Same core device
- Same start time

**Expected UI Response:**
- Only one patch session created
- Second request returns existing session
- No duplicate entries in history

**Acceptance Criteria:** AC10

---

### ⚠️ BLOCKED: GSR Hydration

#### `/gsr_hydration`
**This command is intentionally blocked.**

**Command:**
```
/gsr_hydration
```

**Response:**
```
Error: GSR is not hydration level. No hydration metric is available.
AC14: Hydration prediction is not implemented (not verified).
```

**Why Blocked:**
- GSR (Galvanic Skin Response) measures electrical conductivity of skin
- It is NOT a validated measure of hydration or electrolytes
- No conversion method has been verified
- Making this claim would violate AGENTS.md §6 (medical safety)

**Acceptance Criteria:** AC14

---

### Demo Setup

#### `/stage_ecopatch`
Sets up the demo state for EcoPatch showcase.

**Command:**
```
/stage_ecopatch
```

**Actions:**
- Ensures core device is connected
- Generates 24 hours of simulated measurements
- Creates sample patch sessions

---

## Pitch Script (~3 minutes)

### Setup (30 seconds)
1. Open web app at https://carelens-demo-web-\<hash\>.a.run.app
2. Log in as u_minh
3. Select recipient profile
4. Navigate to EcoPatch tab (S06/S07)

### Vitals Overview (30 seconds)
1. Show the vitals screen
2. Point out the measurement chart
3. Highlight the quality indicator
4. Note the "Dữ liệu mô phỏng" label

### Real-time Update Demo (45 seconds)
1. Switch to Telegram on second device
2. Send `/vitals`
3. Watch web app update:
   - Chart adds new data point
   - Latest measurement updates
   - Source freshness resets

### Late Measurement Demo (30 seconds)
1. Send `/vitals_late`
2. Show the late indicator
3. Explain: "This is how the system handles delayed data"
4. Note: latest measurement unchanged

### Patch Replacement Demo (45 seconds)
1. Send `/patch_replace`
2. Show S09 form pre-filled
3. Fill in lot code (optional)
4. Submit and show new session in history

### Wrap-up (30 seconds)
1. Return to EcoPatch overview
2. Remind audience: "This is simulated data for demo purposes"
3. Clarify: "GSR is not hydration — we don't make unverified claims"
4. Mention real hardware integration planned for M5

---

## Suggested Speaking Points

### English Version

> "This is EcoPatch — a wearable biosensor for continuous vital signs monitoring.
>
> The patch contains sensors that measure heart rate and other biometrics.
> Data is transmitted via BLE to a phone or gateway, then to the cloud.
>
> The caregiver can monitor vitals trends and receive alerts for anomalies.
> They can also manage the patch lifecycle — when it's time for a new one.
>
> Important: GSR (Galvanic Skin Response) is not a validated measure of hydration.
> We don't make unverified health claims — this is a key safety principle.
>
> The patch is designed to be worn for 7-14 days.
> The system tracks when replacement is needed.
>
> This is currently a working demo with simulated data.
> Real hardware integration is planned for the next milestone."

### Vietnamese Version

> "Đây là EcoPatch — cảm biến sinh học đeo được để theo dõi các chỉ số quan trọng liên tục.
>
> Miếng dán chứa các cảm biến đo nhịp tim và các chỉ số sinh học khác.
> Dữ liệu được truyền qua BLE đến điện thoại hoặc gateway, sau đó lên đám mây.
>
> Người chăm sóc có thể theo dõi xu hướng chỉ số và nhận cảnh báo về bất thường.
> Họ cũng có thể quản lý vòng đời miếng dán — khi nào cần thay mới.
>
> Quan trọng: GSR (Phản ứng điện da) không phải là thước đo mức hydrat hóa được xác nhận.
> Chúng tôi không đưa ra các tuyên bố sức khỏe chưa được xác minh — đây là nguyên tắc an toàn quan trọng.
>
> Miếng dán được thiết kế để đeo trong 7-14 ngày.
> Hệ thống theo dõi khi nào cần thay mới.
>
> Hiện tại đây là demo đang hoạt động với dữ liệu mô phỏng.
> Tích hợp phần cứng thật được lên kế hoạch cho mốc tiếp theo."

---

## Maintenance

### Adding New EcoPatch Metrics

1. Define metric in `frontend/src/data/contracts.ts` (future)
2. Add to demo fixtures in `frontend/src/data/demo/fixtures.ts` (future)
3. Implement measurement handler in `frontend/src/data/demo/demoAdapter.ts` (future)
4. Add UI component in `frontend/src/features/ecopatch/` (future)
5. Update this document and `docs/DEMO_ECOPATCH.yaml`

### Adjusting Measurement Interval

Measurement interval is defined in:
`frontend/src/data/demo/fixtures.ts` → `MEASUREMENT_INTERVAL_MIN` (future)

Default: 5 minutes (configurable)

### Simulating Different Scenarios

| Scenario | Command | Notes |
|----------|---------|-------|
| High heart rate | Modify value in code | Future `/vitals_high` command |
| Poor signal | `/vitals` with quality=poor | Shows quality indicator |
| Multiple patches | `/patch_replace` x2 | Shows session history |
| Expired patch | Set endedAt in code | Future enhancement |

---

## Guardrail Compliance

This demo strictly follows AGENTS.md §6:

| Rule | Implementation |
|------|----------------|
| No hydration claims | `/gsr_hydration` blocked with error |
| No stroke prediction | Not implemented |
| No combined scores | Products shown separately |
| No medical thresholds | Only demo thresholds with `rule_version` |
| source_mode=simulated | All data labeled |
| No real notifications | Notification sink only |

---

## Files Reference

| File | Purpose |
|------|---------|
| `backend/services/demo-bridge/src/bot.ts` | Telegram command handling |
| `backend/services/demo-bridge/src/wsHub.ts` | WebSocket broadcast hub |
| `frontend/scripts/devBridge.ts` | Dev bridge integration (future) |
| `frontend/src/data/demo/demoAdapter.ts` | Demo state management (future) |
| `frontend/src/data/demo/fixtures.ts` | Demo data fixtures (future) |
| `frontend/src/features/ecopatch/` | EcoPatch UI components (future) |
| `docs/DEMO_ECOPATCH.yaml` | Command metadata schema |
