#!/usr/bin/env bash
set -euo pipefail

# Offline regression tests: the fake gcloud records calls and never accesses GCP.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
export CALL_LOG="$TASK_TMP/calls" GITHUB_ENV="$TASK_TMP/github-env"
export PROJECT_ID=cpe-se-course-2026 REGION=asia-southeast1 TEAM_PREFIX=team123
export SERVICE_NAME=team123 MIGRATE_JOB_NAME=team123-migrate
export ARTIFACT_REGISTRY_REPOSITORY=team123
export IMAGE=asia-southeast1-docker.pkg.dev/cpe-se-course-2026/team123/event-registration-attendance:portal-tag
export IMAGE_TAG=1111111111111111111111111111111111111111
export APP_ORIGIN=https://team123-hash-uc.a.run.app,https://team123-123456789.asia-southeast1.run.app
export PATH="$TASK_TMP:$PATH"

cat > "$TASK_TMP/gcloud" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud %s\n' "$*" >> "$CALL_LOG"
case "$*" in
  'artifacts docker images describe '*)
    [[ "${FAIL_AT:-}" != image ]] || exit 1
    printf '%s@sha256:%064d\n' "${IMAGE%:*}" 0 ;;
  'run jobs execute '*) [[ "${FAIL_AT:-}" != migration ]] || exit 1 ;;
  'run services describe '*)
    if [[ "$*" == *'status.url'* ]]; then
      echo 'https://team123-hash-uc.a.run.app'
    else
      echo 'team123'
    fi ;;
  'projects describe '*) echo '123456789' ;;
esac
STUB
chmod +x "$TASK_TMP/gcloud"

export ROLLBACK=false DRY_RUN=0
bash "$ROOT/deploy/release.sh" > "$TASK_TMP/normal-output"
grep -q 'artifacts docker images describe .*:1111111111111111111111111111111111111111' "$CALL_LOG"
grep -q 'run jobs update team123-migrate .*@sha256:' "$CALL_LOG"
grep -q 'run jobs execute team123-migrate --wait' "$CALL_LOG"
grep -q 'run services update team123 .*@sha256:' "$CALL_LOG"
grep -q 'run services update-traffic team123 --to-latest' "$CALL_LOG"
EXPECTED_DIGEST="${IMAGE%:*}@sha256:$(printf '%064d' 0)"
MIGRATION_EXEC_LINE="$(grep -nF 'gcloud run jobs execute team123-migrate --wait' "$CALL_LOG" | cut -d: -f1)"
SERVICE_UPDATE_LINE="$(grep -nF "gcloud run services update team123 --image=$EXPECTED_DIGEST" "$CALL_LOG" | cut -d: -f1)"
test -n "$MIGRATION_EXEC_LINE" && test -n "$SERVICE_UPDATE_LINE"
test "$MIGRATION_EXEC_LINE" -lt "$SERVICE_UPDATE_LINE"
grep -Fq "gcloud run jobs update team123-migrate --image=$EXPECTED_DIGEST --command=./node_modules/.bin/prisma --args=migrate,deploy " "$CALL_LOG"
grep -Fq "gcloud run services update team123 --image=$EXPECTED_DIGEST --update-env-vars=^@^ALLOW_NON_LOCAL_DATABASE=1@APP_ORIGIN=$APP_ORIGIN@APP_COMMIT_SHA=$IMAGE_TAG " "$CALL_LOG"
grep -q 'SERVICE_URL=https://team123-hash-uc.a.run.app' "$GITHUB_ENV"
grep -q 'Deployed commit: 1111111111111111111111111111111111111111' "$TASK_TMP/normal-output"
echo 'PASS normal release resolves digest, waits for migration, then updates the service'

: > "$CALL_LOG"
env -u APP_ORIGIN PROJECT_NUMBER=123456789 bash "$ROOT/deploy/release.sh" > "$TASK_TMP/portal-project-number-output"
if grep -q 'gcloud projects describe ' "$CALL_LOG"; then
  echo 'A portal-supplied project number must avoid the project-wide metadata lookup.' >&2
  exit 1
fi
grep -q 'gcloud run services describe team123 .*status.url' "$CALL_LOG"
grep -Fq -- '--update-env-vars=^@^ALLOW_NON_LOCAL_DATABASE=1@APP_ORIGIN=https://team123-hash-uc.a.run.app,https://team123-123456789.asia-southeast1.run.app@APP_COMMIT_SHA=$IMAGE_TAG' "$CALL_LOG"
echo 'PASS portal-supplied project number avoids resourcemanager.projects.get and derives both origins'

: > "$CALL_LOG"
export ROLLBACK=true
bash "$ROOT/deploy/release.sh" > "$TASK_TMP/rollback-output"
if grep -q 'run jobs ' "$CALL_LOG"; then
  echo 'Rollback must not modify or execute the migration job.' >&2
  exit 1
fi
grep -q 'run services update team123 ' "$CALL_LOG"
grep -q 'skipping migration' "$TASK_TMP/rollback-output"
echo 'PASS rollback updates the service without touching the migration job'

: > "$CALL_LOG"
env -u APP_ORIGIN ROLLBACK=true bash "$ROOT/deploy/release.sh" > "$TASK_TMP/derived-origin-output"
grep -q 'gcloud run services describe team123 .*status.url' "$CALL_LOG"
grep -q 'gcloud projects describe cpe-se-course-2026 .*projectNumber' "$CALL_LOG"
grep -Fq -- "--update-env-vars=^@^ALLOW_NON_LOCAL_DATABASE=1@APP_ORIGIN=https://team123-hash-uc.a.run.app,https://team123-123456789.asia-southeast1.run.app" "$CALL_LOG"
echo 'PASS release derives both Cloud Run origins with read-only metadata calls when APP_ORIGIN is unset'

for failure in image migration; do
  : > "$CALL_LOG"
  if ROLLBACK=false FAIL_AT="$failure" bash "$ROOT/deploy/release.sh" >"$TASK_TMP/failure-output" 2>&1; then
    echo "Expected $failure failure." >&2
    exit 1
  fi
  if grep -q 'run services update team123 ' "$CALL_LOG"; then
    echo "Service updated after $failure failure." >&2
    exit 1
  fi
  echo "PASS $failure failure prevents service update"
done

: > "$CALL_LOG"
if IMAGE_TAG='not-a-commit' bash "$ROOT/deploy/release.sh" >"$TASK_TMP/invalid-tag" 2>&1; then
  echo 'Expected an invalid image tag to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS invalid image tag rejected before any gcloud call'

: > "$CALL_LOG"
if APP_ORIGIN='https://not-cloud-run.example.test' bash "$ROOT/deploy/release.sh" >"$TASK_TMP/invalid-origin" 2>&1; then
  echo 'Expected a non-Cloud-Run origin to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS invalid browser origin rejected before any gcloud call'

: > "$CALL_LOG"
if APP_ORIGIN='https://another-service.run.app' bash "$ROOT/deploy/release.sh" >"$TASK_TMP/mismatched-origin" 2>&1; then
  echo 'Expected a valid but unrelated Cloud Run origin to be rejected.' >&2
  exit 1
fi
if grep -Eq 'artifacts docker images describe|run jobs update|run jobs execute|run services update' "$CALL_LOG"; then
  echo 'Release changed cloud resources after an APP_ORIGIN mismatch.' >&2
  exit 1
fi
echo 'PASS origin list that does not match the exact service URLs is rejected before image or resource changes'

: > "$CALL_LOG"
if SERVICE_NAME=othertm bash "$ROOT/deploy/release.sh" >"$TASK_TMP/invalid-prefix" 2>&1; then
  echo 'Expected a service outside the team prefix to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS resource outside the portal prefix rejected before any gcloud call'

: > "$CALL_LOG"
if TEAM_PREFIX=team12 bash "$ROOT/deploy/release.sh" >"$TASK_TMP/lookalike-prefix" 2>&1; then
  echo 'Expected an overlapping but different team prefix to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS lookalike prefix rejected before any gcloud call'

: > "$CALL_LOG"
if IMAGE=asia-southeast1-docker.pkg.dev/cpe-se-course-2026/other-team/app bash "$ROOT/deploy/release.sh" >"$TASK_TMP/foreign-image" 2>&1; then
  echo 'Expected an image path outside the team repository to be rejected.' >&2
  exit 1
fi
test ! -s "$CALL_LOG"
echo 'PASS image path outside the portal-provided team repository rejected before any gcloud call'

