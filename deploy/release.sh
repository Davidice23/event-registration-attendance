#!/usr/bin/env bash
set -euo pipefail

# Release an already-built image to existing portal-provisioned resources only.
# Normal release: verify immutable digest -> update/execute migration job ->
# update service. Rollback: update service only; never rerun old migrations.

PROJECT_ID="${PROJECT_ID:-${GCP_PROJECT_ID:-}}"
REGION="${REGION:-${GCP_REGION:-}}"
PROJECT_NUMBER="${PROJECT_NUMBER:-}"
TEAM_PREFIX="${TEAM_PREFIX:-}"
SERVICE_NAME="${SERVICE_NAME:-}"
MIGRATE_JOB_NAME="${MIGRATE_JOB_NAME:-}"
ARTIFACT_REGISTRY_REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-}"
PORTAL_IMAGE="${IMAGE:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
APP_ORIGIN="${APP_ORIGIN:-}"
ROLLBACK="${ROLLBACK:-false}"
DRY_RUN="${DRY_RUN:-0}"
SERVICE_URL=""

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
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || fail 'IMAGE_TAG must be a full 40-character commit SHA.'
[[ "$ROLLBACK" == true || "$ROLLBACK" == false ]] || fail 'ROLLBACK must be true or false.'
[[ "$DRY_RUN" == 0 || "$DRY_RUN" == 1 ]] || fail 'DRY_RUN must be 0 or 1.'

if [[ -n "$APP_ORIGIN" ]]; then
  [[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9.-]+\.run\.app(,https://[A-Za-z0-9.-]+\.run\.app)*$ ]] || fail 'APP_ORIGIN must be comma-separated HTTPS Cloud Run run.app origins without paths or trailing slashes.'
fi
if [[ "$DRY_RUN" == 1 ]]; then
  [[ -n "$APP_ORIGIN" ]] || fail 'Set APP_ORIGIN to the exact Cloud Run URL(s) before previewing a dry run.'
else
  SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" \
    --region="$REGION" --format='value(status.url)')"
  # The GitHub deployer can be scoped to the team's resources and may not have
  # project-wide resourcemanager.projects.get. CI supplies the verified project
  # number from the Cloud Portal; retain the read-only lookup for manual runs.
  if [[ -z "$PROJECT_NUMBER" ]]; then
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  fi
  [[ "$SERVICE_URL" =~ ^https://[A-Za-z0-9.-]+\.run\.app$ ]] || fail 'Cloud Run did not return a valid HTTPS run.app service URL.'
  [[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]] || fail 'Google Cloud did not return a valid project number.'
  EXPECTED_APP_ORIGIN="$SERVICE_URL,https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"
  [[ -z "$APP_ORIGIN" || "$APP_ORIGIN" == "$EXPECTED_APP_ORIGIN" ]] || fail 'APP_ORIGIN must exactly match the existing service URLs.'
  APP_ORIGIN="$EXPECTED_APP_ORIGIN"
fi
[[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9.-]+\.run\.app(,https://[A-Za-z0-9.-]+\.run\.app)*$ ]] || fail 'APP_ORIGIN must be comma-separated HTTPS Cloud Run run.app origins without paths or trailing slashes.'

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
  DIGEST_IMAGE="$IMAGE_BASE@sha256:$(printf '%064d' 0 | tr '0' '0')"
  printf '[DRY_RUN] resolve image digest for %s\n' "$TAGGED_IMAGE"
else
  DIGEST_IMAGE="$(gcloud artifacts docker images describe "$TAGGED_IMAGE" \
    --project="$PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
  [[ "$DIGEST_IMAGE" == "$IMAGE_BASE@sha256:"* && "$DIGEST_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || fail 'The tagged image did not resolve to a digest in the portal-provided repository.'
fi

if [[ "$ROLLBACK" == false ]]; then
  # The Cloud Portal's pre-provisioned job has a placeholder command that
  # intentionally exits. Set both fields explicitly so the immutable image
  # runs this repository's Prisma migration instead of retaining that override.
  run_cmd gcloud run jobs update "$MIGRATE_JOB_NAME" --image="$DIGEST_IMAGE" \
    --command=./node_modules/.bin/prisma --args=migrate,deploy \
    --project="$PROJECT_ID" --region="$REGION" --quiet
  run_cmd gcloud run jobs execute "$MIGRATE_JOB_NAME" --wait \
    --project="$PROJECT_ID" --region="$REGION" --quiet
else
  printf 'Rollback mode: skipping migration; only the existing service image will change.\n'
fi

run_cmd gcloud run services update "$SERVICE_NAME" --image="$DIGEST_IMAGE" \
  "--update-env-vars=^@^ALLOW_NON_LOCAL_DATABASE=1@APP_ORIGIN=$APP_ORIGIN" \
  --project="$PROJECT_ID" --region="$REGION" --quiet
run_cmd gcloud run services update-traffic "$SERVICE_NAME" --to-latest \
  --project="$PROJECT_ID" --region="$REGION" --quiet

if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY RUN ONLY: service URL and deployed digest are not resolved.\n'
  exit 0
fi

if [[ -z "$SERVICE_URL" ]]; then
  SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" \
    --region="$REGION" --format='value(status.url)')"
fi
[[ "$SERVICE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || fail 'Cloud Run did not return a valid HTTPS service URL.'
printf 'Deployed commit: %s\nImage digest: %s\nService URL: %s\n' "$IMAGE_TAG" "$DIGEST_IMAGE" "$SERVICE_URL"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'SERVICE_URL=%s\nDEPLOYED_IMAGE=%s\n' "$SERVICE_URL" "$DIGEST_IMAGE" >> "$GITHUB_ENV"
fi

