# Deploying CareLens + EcoPatch Demo to Cloud Run

This guide covers deploying the demo infrastructure to Google Cloud Run.

## Prerequisites

1. **GCP Project** with billing enabled
2. **Google Cloud SDK** installed and configured
3. **Docker** installed locally
4. **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
5. **Telegram Chat ID** from [@userinfobot](https://t.me/userinfobot)

## One-Time Setup

### 1. Enable Required APIs

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

### 2. Create Secrets

Create secrets in Secret Manager for sensitive values:

```bash
# Create secret for Telegram bot token
echo -n "YOUR_BOT_TOKEN" | gcloud secrets create TELEGRAM_BOT_TOKEN --data-file=-

# Grant Cloud Build access to secrets
./deploy/grant.sh YOUR_PROJECT_ID
```

### 3. Configure Artifact Registry

```bash
gcloud artifacts repositories create carelens-demo \
  --repository-format=docker \
  --location=asia-southeast1

gcloud auth configure-docker asia-southeast1-docker.pkg.dev
```

## Deploying

### Deploy Web App

```bash
gcloud builds submit --config=cloudbuild-web.yaml
```

This will:
1. Build the Docker image
2. Push to Artifact Registry
3. Deploy to Cloud Run (us-central1)
4. Set environment variable for bridge URL

### Deploy Bridge Service

```bash
gcloud builds submit --config=cloudbuild-bridge.yaml \
  --substitutions=\
  _TELEGRAM_ALLOWED_CHAT_ID=YOUR_CHAT_ID,\
  _SM_ENABLED=1
```

This will:
1. Build the Docker image
2. Push to Artifact Registry
3. Deploy to Cloud Run (no public access)
4. Mount Telegram bot token from Secret Manager
5. Set environment variables

## URLs

After deployment, you'll get URLs like:

- **Web App:** `https://carelens-demo-web-<hash>-as.a.run.app`
- **Bridge:** `https://carelens-demo-bridge-<hash>-as.a.run.app`

Note the bridge URL — you'll use it as `WEB_ORIGIN` in the next step.

## Verification

### 1. Verify Web App

Open the web app URL and verify:
- Page loads with "Bản demo · Dữ liệu mô phỏng" banner
- No console errors
- Demo login works

### 2. Verify Bridge

Check the bridge health:

```bash
curl https://carelens-demo-bridge-<hash>-as.a.run.app/healthz
# Should return: ok
```

### 3. Verify Telegram Bot

1. Open Telegram and find your bot
2. Send `/start`
3. Send `/who` to verify connection
4. Send `/safe_check` to print safety checklist

## Switching Modes

### Long Polling (Default)

Long polling works out of the box without any additional setup.

```bash
# In cloudbuild-bridge.yaml:
--set-env-vars=BRIDGE_MODE=polling
```

### Webhook (Requires Domain)

If you have a domain, use webhook mode for faster updates:

1. Set up your domain with Cloud Run
2. Configure Telegram webhook:

```bash
# Set webhook URL in Telegram
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/telegram/webhook" \
  -d "secret_token=YOUR_SECRET"
```

3. Update environment:

```bash
# In cloudbuild-bridge.yaml:
--set-env-vars=BRIDGE_MODE=webhook,TELEGRAM_WEBHOOK_PUBLIC_URL=https://your-domain.com
```

## Troubleshooting

### Build Failures

**Problem:** `docker: unauthorized` error

**Solution:**
```bash
gcloud auth configure-docker asia-southeast1-docker.pkg.dev
```

### Secret Not Found

**Problem:** `Secret version not found`

**Solution:**
```bash
# Verify secret exists
gcloud secrets list

# Check secret value
echo -n $(gcloud secrets versions access latest --secret=TELEGRAM_BOT_TOKEN)
```

### Bridge Not Connecting

**Problem:** WebSocket connection fails

**Solution:**
1. Check bridge logs:
```bash
gcloud run logs read carelens-demo-bridge --region=asia-southeast1
```

2. Verify environment variables:
```bash
gcloud run services describe carelens-demo-bridge --region=asia-southeast1 --format=json | jq '.spec.template.spec.containerConcurrency'
```

### Permission Denied

**Problem:** Cloud Build can't access secrets

**Solution:**
```bash
# Re-run grant script
./deploy/grant.sh YOUR_PROJECT_ID

# Or manually:
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"
```

## Cleanup

### Delete Services

```bash
gcloud run services delete carelens-demo-web --region=asia-southeast1 --quiet
gcloud run services delete carelens-demo-bridge --region=asia-southeast1 --quiet
```

### Delete Images

```bash
gcloud artifacts docker images delete asia-southeast1-docker.pkg.dev/YOUR_PROJECT_ID/carelens-demo-web:latest --quiet
gcloud artifacts docker images delete asia-southeast1-docker.pkg.dev/YOUR_PROJECT_ID/carelens-demo-bridge:latest --quiet
```

### Delete Secrets

```bash
gcloud secrets delete TELEGRAM_BOT_TOKEN --quiet
```

## Cost Estimate

Cloud Run has a generous free tier:

| Service | Free Tier | Estimated Cost |
|---------|------------|----------------|
| Web App | 2M requests/month | $0 (under free tier) |
| Bridge | 2M requests/month | $0 (under free tier) |
| Cloud Build | 120 min/day | ~$0 |
| Secret Manager | 10k secret versions | ~$0.03/month |
| Artifact Registry | 0.5 GB | ~$0.025/month |

**Total estimated cost:** ~$0.06/month for moderate demo usage

## Security Considerations

- Bridge service has **no-allow-unauthenticated** — only Cloud Build and web app can access
- Telegram bot token stored in Secret Manager, never in environment variables
- All data is in-memory only — no persistence
- No PII stored — all demo data is synthetic
- Cloud Build has limited permissions via IAM

## Environment Variables Reference

### Web App (Cloud Run)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_BRIDGE_PUBLIC_URL` | WebSocket URL for bridge | `wss://carelens-demo-bridge-xxx.a.run.app/ws` |

### Bridge Service (Cloud Run)

| Variable | Description | Example |
|----------|-------------|---------|
| `BRIDGE_MODE` | `polling` or `webhook` | `polling` |
| `TELEGRAM_BOT_TOKEN` | Bot token (from Secret) | Secret Manager |
| `TELEGRAM_ALLOWED_CHAT_ID` | Your Telegram chat ID | `123456789` |
| `WEB_ORIGIN` | Web app URL for CORS | `https://carelens-demo-web-xxx.a.run.app` |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook verification secret | Random string |
| `TELEGRAM_WEBHOOK_PUBLIC_URL` | Public webhook URL | `https://your-domain.com` |
| `SM_ENABLED` | Use Secret Manager | `1` or `0` |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | `carelens-demo` |

## Files Reference

| File | Purpose |
|------|---------|
| `cloudbuild-web.yaml` | Cloud Build config for web app |
| `cloudbuild-bridge.yaml` | Cloud Build config for bridge |
| `deploy/grant.sh` | IAM permissions script |
| `frontend/Dockerfile` | Web app container |
| `frontend/nginx.conf` | Nginx configuration |
| `backend/services/demo-bridge/Dockerfile` | Bridge container |
| `backend/services/demo-bridge/.env.example` | Environment template |
