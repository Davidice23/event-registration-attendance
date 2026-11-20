#!/usr/bin/env bash
set -euo pipefail

# First application deployment against resources that the CPE334 Cloud Portal
# has already provisioned. This script never creates/deletes cloud resources,
# enables APIs, changes IAM/billing, or reads secret values.
#
# Required values come from the portal's Team resources tab:
#   PROJECT_ID=cpe-se-course-2026 REGION=asia-southeast1
#   TEAM_PREFIX SERVICE_NAME MIGRATE_JOB_NAME ARTIFACT_REGISTRY_REPOSITORY
#   IMAGE (the exact image reference from Team resources), IMAGE_TAG (HEAD)
#   APP_ORIGIN (comma-separated exact Cloud Run service URL origins)
# DRY_RUN=1 prints a plan without invoking gcloud or Docker.
# For a real deployment set CONFIRM_DEPLOY to exactly TEAM_PREFIX.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT_ID:-cpe-se-course-2026}}"
REGION="${REGION:-${GCP_REGION:-asia-southeast1}}"
TEAM_PREFIX="${TEAM_PREFIX:-}"
SERVICE_NAME="${SERVICE_NAME:-}"
MIGRATE_JOB_NAME="${MIGRATE_JOB_NAME:-}"
ARTIFACT_REGISTRY_REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-}"
PORTAL_IMAGE="${IMAGE:-}"
APP_ORIGIN="${APP_ORIGIN:-}"
DRY_RUN="${DRY_RUN:-0}"
CONFIRM_DEPLOY="${CONFIRM_DEPLOY:-}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
is_team_resource() {
  local name="$1"
  [[ "$name" == "$TEAM_PREFIX" || "$name" == "$TEAM_PREFIX"-* ]]
}

[[ "$PROJECT_ID" == cpe-se-course-2026 ]] || fail 'PROJECT_ID must be cpe-se-course-2026.'
[[ "$REGION" == asia-southeast1 ]] || fail 'REGION must be asia-southeast1.'
[[ "$TEAM_PREFIX" =~ ^[a-z][a-z0-9-]*$ ]] || fail 'Set TEAM_PREFIX exactly as shown in Team resources.'
is_team_resource "$SERVICE_NAME" || fail 'SERVICE_NAME must be an exact portal resource equal to TEAM_PREFIX or followed by a hyphen suffix.'
is_team_resource "$MIGRATE_JOB_NAME" || fail 'MIGRATE_JOB_NAME must be an exact portal resource equal to TEAM_PREFIX or followed by a hyphen suffix.'
is_team_resource "$ARTIFACT_REGISTRY_REPOSITORY" || fail 'ARTIFACT_REGISTRY_REPOSITORY must be an exact portal resource equal to TEAM_PREFIX or followed by a hyphen suffix.'
[[ "$PORTAL_IMAGE" =~ ^asia-southeast1-docker\.pkg\.dev/cpe-se-course-2026/([^/]+)/([^/:]+)(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$ ]] || fail 'Set IMAGE to the exact image reference from Team resources.'
IMAGE_REPOSITORY="${BASH_REMATCH[1]}"
is_team_resource "$IMAGE_REPOSITORY" || fail 'IMAGE must use a repository owned by this team.'
[[ "$IMAGE_REPOSITORY" == "$ARTIFACT_REGISTRY_REPOSITORY" ]] || fail 'IMAGE repository must match ARTIFACT_REGISTRY_REPOSITORY from Team resources.'
IMAGE_BASE="${PORTAL_IMAGE%:*}"
[[ "$DRY_RUN" == 0 || "$DRY_RUN" == 1 ]] || fail 'DRY_RUN must be 0 or 1.'
validate_app_origin() {
  [[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9.-]+\.run\.app(,https://[A-Za-z0-9.-]+\.run\.app)*$ ]] || fail 'APP_ORIGIN must be comma-separated HTTPS Cloud Run run.app origins without paths or trailing slashes.'
}
if [[ "$DRY_RUN" == 1 ]]; then
  validate_app_origin
fi

IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse HEAD 2>/dev/null)}"
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || fail 'IMAGE_TAG must be the full 40-character commit SHA.'
TAGGED_IMAGE="$IMAGE_BASE:$IMAGE_TAG"

run_cmd() {
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '[DRY_RUN] '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY RUN ONLY: no gcloud or Docker command will run and no cloud resource will change.\n'
  printf 'Target: project=%s region=%s prefix=%s service=%s job=%s registry=%s image-tag=%s\n' \
    "$PROJECT_ID" "$REGION" "$TEAM_PREFIX" "$SERVICE_NAME" "$MIGRATE_JOB_NAME" \
    "$ARTIFACT_REGISTRY_REPOSITORY" "$IMAGE_TAG"
  printf 'Exact portal image reference: %s\n' "$PORTAL_IMAGE"
  printf 'Allowed browser origins: %s\n' "$APP_ORIGIN"
  printf 'Plan: verify these existing named resources, build and push the image, migrate, then update the service.\n'
else
  [[ "$(git branch --show-current 2>/dev/null)" == main ]] || fail 'Run a real first deployment from a clean checkout of main.'
  [[ -z "$(git status --porcelain)" ]] || fail 'The working tree must be clean before deployment.'
  [[ "$CONFIRM_DEPLOY" == "$TEAM_PREFIX" ]] || fail 'For a real deploy, set CONFIRM_DEPLOY to the exact TEAM_PREFIX shown by the portal.'
  command -v gcloud >/dev/null 2>&1 || fail 'gcloud is not installed or not on PATH.'
  command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or not on PATH.'

  ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
  [[ -n "$ACTIVE_ACCOUNT" ]] || fail 'Sign in to the intended course account with gcloud auth login first.'
  ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  [[ "$ACTIVE_PROJECT" == "$PROJECT_ID" ]] || fail 'The active gcloud project must be cpe-se-course-2026; this script will not change it.'

  # Describe only the exact names supplied by the portal. Do not list or touch
  # resources belonging to other teams.
  gcloud artifacts repositories describe "$ARTIFACT_REGISTRY_REPOSITORY" \
    --project="$PROJECT_ID" --location="$REGION" --format='value(name)' >/dev/null
  gcloud run jobs describe "$MIGRATE_JOB_NAME" \
    --project="$PROJECT_ID" --region="$REGION" --format='value(metadata.name)' >/dev/null
  gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT_ID" --region="$REGION" --format='value(metadata.name)' >/dev/null

  SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" \
    --region="$REGION" --format='value(status.url)')"
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  [[ "$SERVICE_URL" =~ ^https://[A-Za-z0-9.-]+\.run\.app$ ]] || fail 'Cloud Run did not return a valid HTTPS run.app service URL.'
  [[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]] || fail 'Google Cloud did not return a valid project number.'
  EXPECTED_APP_ORIGIN="$SERVICE_URL,https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"
  [[ -z "$APP_ORIGIN" || "$APP_ORIGIN" == "$EXPECTED_APP_ORIGIN" ]] || fail 'APP_ORIGIN must exactly match the existing service URLs.'
  APP_ORIGIN="$EXPECTED_APP_ORIGIN"
  validate_app_origin

  [[ -n "$CONFIRM_DEPLOY" ]] || fail 'Deployment confirmation is required.'
fi

run_cmd gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
run_cmd docker build --tag "$TAGGED_IMAGE" .
run_cmd docker push "$TAGGED_IMAGE"

PROJECT_ID="$PROJECT_ID" \
REGION="$REGION" \
TEAM_PREFIX="$TEAM_PREFIX" \
SERVICE_NAME="$SERVICE_NAME" \
MIGRATE_JOB_NAME="$MIGRATE_JOB_NAME" \
ARTIFACT_REGISTRY_REPOSITORY="$ARTIFACT_REGISTRY_REPOSITORY" \
IMAGE="$PORTAL_IMAGE" \
IMAGE_TAG="$IMAGE_TAG" \
APP_ORIGIN="$APP_ORIGIN" \
DRY_RUN="$DRY_RUN" \
  bash "$SCRIPT_DIR/release.sh"

if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY RUN ONLY: nothing was built, pushed, migrated, or deployed. Review the plan before running for real.\n'
fi
