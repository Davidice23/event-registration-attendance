#!/usr/bin/env bash
set -euo pipefail

# Safe local test: DRY_RUN=1 must not execute gcloud or Docker.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
mkdir -p "$TASK_TMP/bin"
export CALL_LOG="$TASK_TMP/calls"
cat > "$TASK_TMP/bin/gcloud" <<'STUB'
#!/usr/bin/env bash
printf 'gcloud %s\n' "$*" >> "$CALL_LOG"
STUB
cat > "$TASK_TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALL_LOG"
STUB
chmod +x "$TASK_TMP/bin/gcloud" "$TASK_TMP/bin/docker"
export PATH="$TASK_TMP/bin:$PATH"

export PROJECT_ID=cpe-se-course-2026 REGION=asia-southeast1
export TEAM_PREFIX=team123
export SERVICE_NAME=team123
export MIGRATE_JOB_NAME=team123-migrate
export ARTIFACT_REGISTRY_REPOSITORY=team123
export IMAGE=asia-southeast1-docker.pkg.dev/cpe-se-course-2026/team123/event-registration-attendance:portal-tag
export IMAGE_TAG=1111111111111111111111111111111111111111
export APP_ORIGIN=https://team123-hash-uc.a.run.app,https://team123-123456789.asia-southeast1.run.app
export DRY_RUN=1

bash "$ROOT/deploy/deploy.sh" > "$TASK_TMP/output"
grep -q 'DRY RUN ONLY: no gcloud or Docker command will run' "$TASK_TMP/output"
grep -q '\[DRY_RUN\] docker build' "$TASK_TMP/output"
grep -q 'docker build --tag asia-southeast1-docker.pkg.dev/cpe-se-course-2026/team123/event-registration-attendance:1111111111111111111111111111111111111111' "$TASK_TMP/output"
grep -q '\[DRY_RUN\] docker push' "$TASK_TMP/output"
grep -q '\[DRY_RUN\] gcloud run jobs update team123-migrate' "$TASK_TMP/output"
grep -q '\[DRY_RUN\] gcloud run services update team123' "$TASK_TMP/output"
grep -Fq 'ALLOW_NON_LOCAL_DATABASE=1@APP_ORIGIN=https://team123-hash-uc.a.run.app' "$TASK_TMP/output"
grep -Fq 'https://team123-123456789.asia-southeast1.run.app' "$TASK_TMP/output"
grep -q 'nothing was built, pushed, migrated, or deployed' "$TASK_TMP/output"
test ! -s "$CALL_LOG"
if grep -Eq 'services enable| run (deploy|jobs deploy)|sql instances create| projects add-iam-policy-binding|secrets create|teardown' "$TASK_TMP/output"; then
  echo 'Unexpected resource creation/deletion command in the dry-run plan.' >&2
  exit 1
fi
echo 'PASS dry-run prints the existing-resource plan and calls no gcloud or Docker command'

if TEAM_PREFIX=team123 SERVICE_NAME=toktickit bash "$ROOT/deploy/deploy.sh" >"$TASK_TMP/bad-name" 2>&1; then
  echo 'Expected a resource outside the team prefix to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS resource names outside the portal prefix are rejected before side effects'

if TEAM_PREFIX=team12 bash "$ROOT/deploy/deploy.sh" >"$TASK_TMP/lookalike-prefix" 2>&1; then
  echo 'Expected an overlapping but different team prefix to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS a lookalike prefix without a hyphen boundary is rejected before side effects'

if IMAGE=asia-southeast1-docker.pkg.dev/cpe-se-course-2026/other-team/app bash "$ROOT/deploy/deploy.sh" >"$TASK_TMP/foreign-image" 2>&1; then
  echo 'Expected an image path outside the team repository to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS an image path outside the portal-provided repository is rejected before side effects'
