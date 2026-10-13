# CareLens Demo Script

Demo infrastructure for presenting CareLens hub and AI capabilities.

> **⚠️ IMPORTANT: This is a demo with simulated data.**
> All care events, care levels, and AI descriptions are **simulated** for demonstration purposes.
> Care level is an experimental AI score, not a medical probability.

## Core Technology

> **PRD Requirements — Not Yet Verified**
> The following describes the intended system as specified in the CareLens PRD:
>
> - **Hardware:** ESP32-S3 wearable camera → ESP32 hub
> - **Processing:** Local AI (YOLOv10 object detection → VLM for description)
> - **Privacy:** Images never leave the hub; only text events are sent to cloud
> - **Care Level:** 0–10 score from AI model, experimental only
>
> This demo uses **simulated data** until real hardware is integrated (M5).

## CareLens Commands

### Fall Detection

#### `/fall`
Simulates a fall detection event with moderate care level.

**Command:**
```
/fall
```

**Demo Method:** `demoAdapter.emitCareEvent()`
**Parameters:**
- severity: warning
- careLevel: 7
- category: posture
- summary: "AI ghi nhận tư thế bất thường."

**Expected UI Response:**
- S04: Alert badge increments
- S05: New timeline row appears with fall icon
- Alert created with care_level=7

**Acceptance Criteria:** AC04, AC05, AC06

---

#### `/fall_high`
Simulates a critical fall requiring immediate attention.

**Command:**
```
/fall_high
```

**Demo Method:** `demoAdapter.emitCareEvent()`
**Parameters:**
- severity: critical
- careLevel: 9
- category: posture
- summary: "Phát hiện té ngã nghiêm trọng."

**Expected UI Response:**
- S04: High-priority alert badge
- S05: Critical timeline row
- Alert created with care_level=9

**Acceptance Criteria:** AC04

---

#### `/fall_no_ai`
Simulates a fall event that falls below the alert threshold.

**Command:**
```
/fall_no_ai
```

**Demo Method:** `demoAdapter.emitCareEvent()`
**Parameters:**
- severity: info
- careLevel: 3
- category: posture
- summary: "Phát hiện chuyển động nhanh, không có té ngã."

**Expected UI Response:**
- S05: Timeline event logged
- No alert created (below threshold)

**Acceptance Criteria:** AC04

---

### Hub Connection

#### `/hub_off`
Simulates the CareLens hub going offline.

**Command:**
```
/hub_off
```

**Demo Method:** `demoAdapter.toggleHubConnection()`
**Parameters:** Toggles hub.online to false

**Expected UI Response:**
- S02: Source status shows "disconnected"
- S08: Hub status shows "offline"
- Event flow stops until reconnected

**Acceptance Criteria:** AC07

---

#### `/hub_on`
Simulates the CareLens hub reconnecting.

**Command:**
```
/hub_on
```

**Demo Method:** `demoAdapter.toggleHubConnection()`
**Parameters:** Toggles hub.online to true

**Expected UI Response:**
- S02: Source status shows "connected"
- S08: Hub status shows "online"
- Event flow resumes

**Acceptance Criteria:** AC07

---

### Privacy Tests

#### `/frame_leak`
Tests that frame data is properly blocked.

**Command:**
```
/frame_leak
```

**Expected Behavior:**
- Frame data is never sent to backend
- Logged as blocked privacy violation
- No UI impact (internal test)

**Acceptance Criteria:** AC16

---

#### `/face_id`
Tests that face recognition is blocked.

**Command:**
```
/face_id
```

**Expected Behavior:**
- Face ID is not performed
- Logged as blocked privacy violation
- No UI impact (internal test)

**Acceptance Criteria:** AC16

---

### Demo Setup

#### `/stage_carelens`
Sets up the demo state for CareLens showcase.

**Command:**
```
/stage_carelens
```

**Actions:**
- Ensures hub is connected
- Generates 24 hours of simulated events
- Creates sample alerts at various stages

---

## Pitch Script (~3 minutes)

### Setup (30 seconds)
1. Open web app at https://carelens-demo-web-\<hash\>.a.run.app
2. Log in as u_minh
3. Select recipient profile
4. Show the "Bản demo · Dữ liệu mô phỏng" banner

### Overview (30 seconds)
1. Show the S02 overview screen
2. Point out the Neumorphism design
3. Highlight the source freshness indicators
4. Note the hub connection status

### Fall Detection Demo (60 seconds)
1. Switch to Telegram on second device
2. Send `/fall`
3. Watch web app update in real-time:
   - Alert badge increments
   - New timeline event appears
   - Alert shows in S04 list
4. Acknowledge the alert in the web app
5. Resolve with "confirmed" outcome

### Hub Disconnection Demo (30 seconds)
1. Send `/hub_off` in Telegram
2. Show the "disconnected" status in web app
3. Explain: "This is what the caregiver sees if the hub loses power"
4. Send `/hub_on` to restore
5. Show connection restored

### Wrap-up (30 seconds)
1. Return to overview
2. Point out the AI description: "AI ghi nhận..."
3. Remind audience: "This is simulated data for demo purposes"
4. Explain care level is experimental
5. Mention real hardware integration planned for M5

---

## Suggested Speaking Points

### English Version

> "This is CareLens — an AI-powered fall detection system that respects privacy.
>
> The camera is embedded in a wearable device that communicates with a local hub.
> All image processing happens on-device — images never leave the home.
>
> When the AI detects a fall, it generates a care event with a care level score.
> This score is experimental and indicates the AI's confidence, not a medical diagnosis.
>
> The caregiver receives an alert and can acknowledge, investigate, or resolve it.
> They can also add notes and track the care timeline.
>
> The hub connection is monitored — if it goes offline, caregivers are notified.
>
> This is currently a working demo with simulated data.
> Real hardware integration is planned for the next milestone."

### Vietnamese Version

> "Đây là CareLens — hệ thống phát hiện té ngã bằng AI, tôn trọng quyền riêng tư.
>
> Camera được tích hợp trong thiết bị đeo và giao tiếp với hub cục bộ.
> Mọi xử lý hình ảnh diễn ra trên thiết bị — hình ảnh không bao giờ rời khỏi nhà.
>
> Khi AI phát hiện té ngã, nó tạo một sự kiện chăm sóc với điểm care level.
> Điểm này là thử nghiệm và chỉ ra độ tin cậy của AI, không phải chẩn đoán y khoa.
>
> Người chăm sóc nhận được cảnh báo và có thể tiếp nhận, điều tra hoặc đóng cảnh báo.
> Họ cũng có thể thêm ghi chú và theo dõi dòng thời gian chăm sóc.
>
> Kết nối hub được giám sát — nếu mất kết nối, người chăm sóc được thông báo.
>
> Hiện tại đây là demo đang hoạt động với dữ liệu mô phỏng.
> Tích hợp phần cứng thật được lên kế hoạch cho mốc tiếp theo."

---

## Maintenance

### Adding New CareLens Commands

1. Add command to whitelist in `backend/services/demo-bridge/src/bot.ts`
2. Implement handler in `frontend/scripts/devBridge.ts` (future)
3. Add demo method if needed in `frontend/src/data/demo/demoAdapter.ts` (future)
4. Update this document with command details
5. Update `docs/DEMO_CARELENS.yaml` with command metadata

### Adjusting Care Level Thresholds

Care level threshold for alerts is defined in:
`frontend/src/data/demo/fixtures.ts` → `DEMO_ALERT_THRESHOLD` (future)

Default: 7 (configurable)

### Simulating Different Scenarios

| Scenario | Command | Notes |
|----------|---------|-------|
| Multiple falls | `/fall` x3 | Each creates separate event |
| False alarm | `/fall` → resolve as false_alarm | Shows resolution flow |
| Night event | Modify `observedAt` in demo | Future enhancement |
| Slow network | Use `/vitals_gap` for timing | Reference for latency |

---

## Files Reference

| File | Purpose |
|------|---------|
| `backend/services/demo-bridge/src/bot.ts` | Telegram command handling |
| `backend/services/demo-bridge/src/wsHub.ts` | WebSocket broadcast hub |
| `frontend/scripts/devBridge.ts` | Dev bridge integration (future) |
| `frontend/src/data/demo/demoAdapter.ts` | Demo state management (future) |
| `frontend/src/data/demo/fixtures.ts` | Demo data fixtures (future) |
| `docs/DEMO_CARELENS.yaml` | Command metadata schema |
