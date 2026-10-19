# Deploying the CareLens + EcoPatch Web Demo to Cloud Run

This guide covers deploying the static web demo (`frontend/`) to Google Cloud Run (ADR-011, still **Proposed**). Do not deploy publicly unless the user asks (AGENTS.md §6).

The former Telegram bridge service and its Cloud Build config were removed (ADR-014).

This guide deploys only the frontend. The CareLens cloud backend (`backend/care-monitoring`, Cloudflare Worker, ADR-016 Proposed) is deployed with [docs/DEPLOYMENT_RUNBOOK.md](../docs/DEPLOYMENT_RUNBOOK.md); it has not been deployed. Keep `LEGACY_STREAM_RECIPIENT_ID` and `LEGACY_STREAM_ALLOWED_IPS` empty on any public deployment: they expose one recipient without sign-in and exist for local development only (D12).

For Vercel (the intended frontend host), follow [docs/DEPLOYMENT_RUNBOOK.md](../docs/DEPLOYMENT_RUNBOOK.md) §8: Root Directory `frontend`, build-time variable `VITE_API_BASE_URL=https://care-monitoring.<subdomain>.workers.dev`, and the Worker's `ALLOWED_ORIGINS` must contain the Vercel origin. `frontend/vercel.json` rewrites every path to `index.html` so deep links such as `/login` work. The Live Demo persona signs in through the existing login form with owner-issued credentials and opens `/api/demo/stream` with a single-use ticket (ADR-018); the other personas keep the in-browser demo adapter (`VITE_DATA_MODE` unset or `demo`). A production build without `VITE_API_BASE_URL` never calls localhost; the Live Demo then reports its stream as unavailable.

## Prerequisites

1. **GCP Project** with billing enabled
2. **Google Cloud SDK** installed and configured
3. **Docker** installed locally

## One-Time Setup

### 1. Enable Required APIs

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

### 2. Configure Artifact Registry

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
2. Push to the registry
3. Deploy to Cloud Run (asia-southeast1)

`cloudbuild-web.yaml` still sets `VITE_BRIDGE_PUBLIC_URL`, which pointed at the removed bridge. Vite variables are read at build time, so this Cloud Run runtime variable has no effect on the static bundle.

## URLs

After deployment, you'll get a URL like `https://carelens-demo-web-<hash>-as.a.run.app`.

## Verification

Open the web app URL and verify:
- Page loads with "Bản demo · Dữ liệu mô phỏng" banner
- No console errors
- Demo login works

## Troubleshooting

**Problem:** `docker: unauthorized` error

**Solution:**
```bash
gcloud auth configure-docker asia-southeast1-docker.pkg.dev
```

## Cleanup

```bash
gcloud run services delete carelens-demo-web --region=asia-southeast1 --quiet
gcloud artifacts docker images delete asia-southeast1-docker.pkg.dev/YOUR_PROJECT_ID/carelens-demo-web:latest --quiet
```

## Security Considerations

- All data is in-memory only — no persistence
- No PII stored — all demo data is synthetic
- Cloud Build has limited permissions via IAM

## Files Reference

| File | Purpose |
|------|---------|
| `cloudbuild-web.yaml` | Cloud Build config for web app |
| `frontend/Dockerfile` | Web app container |
| `frontend/nginx.conf` | Nginx configuration |
