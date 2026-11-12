#!/usr/bin/env bash
# One-time Google Cloud setup for .github/workflows/alerts-deploy.yml (docs/RELEASE.md, "Alerts server"): a service
# account that can deploy the alerts functions and nothing else, and Workload Identity Federation so GitHub Actions
# signs in as it with a short-lived token (no key file anywhere), trusted only from this repo's main branch.
# Run it in Cloud Shell (console.cloud.google.com, project nomad-pocket) as the owner; safe to run again.
# It prints the two repo variables the workflow reads (Settings › Secrets and variables › Actions › Variables).
set -euo pipefail

PROJECT=nomad-pocket
REGION=europe-west1
REPO=franlindebl/nomad-pocket
SA_ID=github-deploy
SA="$SA_ID@$PROJECT.iam.gserviceaccount.com"
POOL=github
PROVIDER=github-actions

gcloud config set project "$PROJECT" --quiet
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

# The token exchange (STS) and impersonation (IAM Credentials) behind Workload Identity Federation.
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com

gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_ID" --display-name="GitHub Actions: alerts server deploy"

# What `firebase deploy --only functions` needs for 2nd-gen HTTPS and scheduled functions. A missing one shows up
# as a 403 naming the permission in the first run's log: add that role here, never Editor.
for role in \
  roles/cloudfunctions.developer \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/cloudscheduler.admin \
  roles/secretmanager.viewer \
  roles/firebase.viewer \
  roles/serviceusage.serviceUsageConsumer \
  roles/serviceusage.serviceUsageViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet >/dev/null
  echo "granted $role"
done

# Deploying a function means acting as the account it runs as (the default compute one): only that account.
RUNTIME=$(gcloud functions describe api --region="$REGION" --format='value(serviceConfig.serviceAccountEmail)' 2>/dev/null || true)
RUNTIME=${RUNTIME:-"$NUM-compute@developer.gserviceaccount.com"}
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser --condition=None --quiet >/dev/null
echo "granted roles/iam.serviceAccountUser on $RUNTIME"

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"

CONDITION="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --attribute-condition="$CONDITION" --quiet >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub Actions" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
    --attribute-condition="$CONDITION"
fi

gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser --condition=None --quiet \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" >/dev/null
echo "GitHub ($REPO, main) may act as $SA"

echo
echo "Repo variables for the workflow:"
echo "GCP_WIF_PROVIDER=projects/$NUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "GCP_DEPLOY_SA=$SA"
