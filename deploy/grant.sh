#!/bin/bash
# Grant Cloud Build service account access to Secret Manager
PROJECT_ID=$1
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"
echo "Granted secretmanager.secretAccessor to $SA"
