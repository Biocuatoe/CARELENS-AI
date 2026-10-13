# Demo Scripts — CareLens + EcoPatch

Demo infrastructure for presenting CareLens + EcoPatch capabilities to investors and stakeholders.

## Overview

**Who sees this demo:**
- Investors evaluating the platform
- Potential partners exploring integration
- Product managers planning roadmap

**What is demonstrated:**
- End-to-end user flow: login → overview → care events → alerts → patch management
- CareLens hub connection status and simulated fall detection
- EcoPatch vitals monitoring and patch lifecycle
- Multi-caregiver collaboration on alerts
- Responsive, accessible UI with Neumorphism design

**Audience:** Business and technical stakeholders familiar with healthcare IoT concepts.

## Prerequisites

Before running the demo, you need:

1. **Cloud Run URLs** (after deploying to GCP):
   - Web app: `https://carelens-demo-web-<hash>.a.run.app`
   - Bridge: `https://carelens-demo-bridge-<hash>.a.run.app`

2. **Telegram Bot Setup:**
   - Create a bot via [@BotFather](https://t.me/BotFather)
   - Get your bot token: `TELEGRAM_BOT_TOKEN`
   - Get your chat ID from [@userinfobot](https://t.me/userinfobot): `TELEGRAM_ALLOWED_CHAT_ID`

3. **Two browser tabs:**
   - Tab 1: Web app (logged in as u_minh)
   - Tab 2: Web app (logged in as u_lan) or Telegram

## Running Locally

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Configure bridge

```bash
cd backend/services/demo-bridge
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID
```

### Step 3: Start bridge service (Terminal 1)

```bash
npm run bridge
# or for development with hot reload:
npm run dev:bridge
```

### Step 4: Start web app (Terminal 2)

```bash
npm run dev
# Opens http://localhost:5173
```

### Step 5: Open Telegram and confirm connection

1. Open Telegram and find your bot
2. Send `/start` to confirm connection
3. Send `/who` to verify bot is responding

### Step 6: Log in to web app

1. Open http://localhost:5173
2. Click "Vào bản demo"
3. Select a persona (u_minh, u_lan, or u_tuan)

## Running on Cloud Run

See [deploy/README.md](./deploy/README.md) for detailed deployment instructions.

Quick commands:

```bash
# Deploy web
gcloud builds submit --config=cloudbuild-web.yaml

# Deploy bridge (requires secrets setup)
gcloud builds submit --config=cloudbuild-bridge.yaml \
  --substitutions=_TELEGRAM_ALLOWED_CHAT_ID=your_chat_id,_SM_ENABLED=1
```

## Commands by Category

### Authentication & Session

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/login_minh` | Simulate login as u_minh | Persona switches | - |
| `/login_lan` | Simulate login as u_lan | Persona switches | - |
| `/login_tuan` | Simulate login as u_tuan | Persona switches | - |
| `/logout` | Log out current user | Redirect to login | - |
| `/expire` | Expire current session | Session expired error | AC11 |
| `/reset` | Reset all demo data | Fresh demo state | - |

### CareLens Commands

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/fall` | Simulate fall detection (care_level=7) | S04 alert badge + S05 timeline | AC04, AC05, AC06 |
| `/fall_high` | Critical fall (care_level=9) | S04 high priority alert | AC04 |
| `/fall_no_ai` | Fall with low care level (care_level=3) | Event logged, no alert | AC04 |
| `/hub_off` | Hub disconnects | S02 source shows "disconnected" | AC07 |
| `/hub_on` | Hub reconnects | S02 source shows "connected" | AC07 |
| `/frame_leak` | Simulate frame data exposure attempt | Blocked, logged | AC16 |
| `/face_id` | Simulate face recognition attempt | Blocked, logged | AC16 |

### EcoPatch Commands

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/vitals` | Send normal vitals | S06 shows new measurement | - |
| `/vitals_late` | Send late measurement | Shows with "late" indicator | AC08 |
| `/vitals_gap` | Send measurement after gap | Gap shown in chart | AC08 |
| `/patch_replace` | Replace EcoPatch | S09 form pre-filled | AC10 |
| `/patch_idempotent` | Retry same patch replacement | No duplicate session | AC10 |
| `/gsr_hydration` | Attempt GSR hydration claim | Error: metric not available | AC14 |

### Alert Commands

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/alert_list` | List all alerts | S04/S05 alert table | - |
| `/alert_ack` | Acknowledge oldest open alert | S04 alert assigned to you | AC05 |
| `/alert_start` | Start processing alert | S05 status → In Progress | AC05 |
| `/alert_resolve` | Resolve alert with outcome | S05 status → Resolved | AC06 |
| `/alert_claim_other` | Another caregiver claims alert | S05 shows conflict | AC05 |
| `/dup_event` | Send duplicate event | Only one alert created | AC04 |

### Sharing & Permissions

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/people` | List all accessible recipients | S03 shows recipient list | AC01, AC02 |
| `/open` | Open specific recipient profile | Navigate to S02 | AC03 |
| `/share` | Generate share invitation | S12 invitation created | - |
| `/revoke` | Revoke viewer access | Viewer loses access | AC11 |
| `/cross_tenant` | Attempt cross-tenant access | Blocked, 403 error | AC03 |

### Device Commands

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/devices` | List all devices | S08 device table | - |
| `/pair_fail` | Failed pairing attempt | S08 shows pairing error | AC17 |

### Reports & Exports

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/note` | Add care note | S10 note added to history | - |
| `/report_30d` | Request 30-day report | S11 report generated | AC15 |
| `/export` | Export data as CSV | S11 CSV download | AC15 |

### Admin & Diagnostics

| Command | Action | UI Response | AC |
|---------|--------|-------------|-----|
| `/admin` | Open admin diagnostics | S14 admin panel | - |
| `/audit` | Show recent audit log | S14 audit entries | - |
| `/stage_carelens` | Setup CareLens demo state | All CL devices ready | - |
| `/stage_ecopatch` | Setup EcoPatch demo state | All EP devices ready | - |

### Safety Commands

| Command | Action | UI Response |
|---------|--------|-------------|
| `/safe_check` | Print safety checklist | 4-point verification |
| `/help` | List all commands | Full command list |

## Guardrails

All demo data and operations are subject to the following safety rules (see AGENTS.md §6):

### Medical & AI Safety
- Care level is an **experimental AI score**, not a medical probability
- GSR is **not** hydration or electrolyte level
- No stroke prediction, dehydration detection, or combined health scores
- AI descriptions are **unconfirmed observations**, not diagnoses

### Privacy & Security
- CareLens images/video **never** leave the hub
- All data has `source_mode = "simulated"` with visible labels
- Server-side authorization is enforced for all operations
- No health data in web storage, logs, or exports

### Demo Constraints
- **No real notifications** are sent to real people
- **No real API** — all data is in-memory only
- **No real devices** — all events are simulated
- **No persistence** — refreshing the page resets demo state

## Safety Commands

### `/safe_check`

Prints a 4-item checklist confirming:
1. All data is simulated (source_mode=simulated)
2. No real notifications are sent
3. No images/videos from CareLens
4. No real API or database

### `/help`

Lists all available Telegram commands with brief descriptions.

## Troubleshooting

**Bot not responding:**
1. Check bot token is correct in `.env`
2. Verify chat ID is correct (only your chat can interact)
3. Check bridge logs for connection errors

**Web app not connecting to bridge:**
1. Verify bridge is running on port 8080
2. Check browser console for WebSocket errors
3. Try refreshing the page

**Commands not working:**
1. Ensure you're logged in to the web app
2. Check that a recipient profile is selected
3. Verify the device is properly assigned

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│  Demo Bridge     │────▶│  Web App        │
│   (commands)    │     │  (Node.js)       │     │  (Vite+React)   │
└─────────────────┘     │                  │     │                 │
                        │  - Telegram bot  │     │  - DemoAdapter  │
┌─────────────────┐     │  - WS hub        │     │  - Neumorphism  │
│   Investor      │     │  - Secret MGR    │     │  - S01-S14 UI   │
│   Browser       │◀────│                  │◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        │                       │                        │
   S01-S14 UI           Long polling or            In-memory
   Neumorphism          webhook                    demo state
```

## Files

| File | Purpose |
|------|---------|
| `frontend/Dockerfile` | Web app container (future) |
| `frontend/nginx.conf` | Nginx config for SPA routing (future) |
| `backend/services/demo-bridge/Dockerfile` | Bridge service container |
| `cloudbuild-web.yaml` | Cloud Build for web |
| `cloudbuild-bridge.yaml` | Cloud Build for bridge |
| `deploy/README.md` | Deployment guide |
| `docs/DEMO_CARELENS.md` | CareLens demo script |
| `docs/DEMO_ECOPATCH.md` | EcoPatch demo script |
