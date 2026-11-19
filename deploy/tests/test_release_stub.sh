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
  'run services describe '*) echo 'https://service.example.test' ;;
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
grep -Fq "gcloud run jobs update team123-migrate --image=$EXPECTED_DIGEST " "$CALL_LOG"
grep -Fq "gcloud run services update team123 --image=$EXPECTED_DIGEST " "$CALL_LOG"
grep -q 'SERVICE_URL=https://service.example.test' "$GITHUB_ENV"
grep -q 'Deployed commit: 1111111111111111111111111111111111111111' "$TASK_TMP/normal-output"
echo 'PASS normal release resolves digest, waits for migration, then updates the service'

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
