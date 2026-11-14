#!/usr/bin/env bash
# Offline checks for deploy/deploy.sh: `gcloud` and `openssl` are local stubs, so this
# makes no GCP calls and costs nothing. Adapted from the Lab 5 Starter Kit.
#
# Scenarios (asserted on the recorded gcloud calls):
#   first_run   : nothing exists      -> everything created, auto-increase off, enterprise edition
#   rerun       : everything exists   -> no secret or DB credential is replaced
#   partial     : DB secret missing   -> existing DB user's password reset + secret created
#   job-fail    : migration fails     -> exit 1 and the service is NOT deployed
#   demo        : --demo              -> demo secret readable by the job identity only; seed after migrate
#   not_owner   : operator is Editor  -> exit 1 before any resource-creating or billable call
#   billing_off : billing disabled    -> exit 1 before any resource-creating or billable call
# Always: no project-wide secretAccessor, the public service never gets the demo secret,
# DB password == password inside DATABASE_URL, no generated value in the output, both
# Cloud Run URLs become APP_ORIGIN, and DRY_RUN=1 makes zero gcloud calls and says so.
#
# Run from anywhere: bash deploy/tests/test_deploy_stub.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="${SCRIPT_DIR}/../deploy.sh"
export TEST_STATE_DIR
TEST_STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_STATE_DIR"' EXIT
mkdir -p "$TEST_STATE_DIR/bin"

fail() { echo "FAIL ${MODE:-}: $*"; exit 1; }

RUNNER="event-reg-runner@stub-gcp-project.iam.gserviceaccount.com"
MIGRATOR="event-reg-migrator@stub-gcp-project.iam.gserviceaccount.com"

cat > "$TEST_STATE_DIR/bin/openssl" <<'STUB'
#!/usr/bin/env bash
if [ "$2" = "-hex" ]; then
  printf '%s\n' '0123456789abcdef0123456789abcdef0123456789abcdef'
else
  printf '%s\n' 'TESTONLYGENERATEDDEMOPASSWORDVALUE'
fi
STUB

cat > "$TEST_STATE_DIR/bin/gcloud" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
redacted=()
for arg in "$@"; do
  case "$arg" in
    --password=*)
      printf '%s' "${arg#--password=}" > "$TEST_STATE_DIR/sql-pass"
      redacted+=("--password=<REDACTED>") ;;
    *) redacted+=("$arg") ;;
  esac
done
printf '%s\n' "${redacted[*]}" >> "$GCLOUD_LOG"
case "$*" in
  "auth list"*) echo owner@example.test; exit 0 ;;
  "projects get-iam-policy"*)
    if [ "$STUB_MODE" = not_owner ]; then echo user:someone-else@example.test; else printf 'user:owner@example.test\nuser:other-owner@example.test\n'; fi
    exit 0 ;;
  "billing projects describe"*)
    if [ "$STUB_MODE" = billing_off ]; then echo False; else echo True; fi
    exit 0 ;;
esac
case "${1:-} ${2:-} ${3:-}" in
  "config get-value project") echo stub-gcp-project; exit 0 ;;
  "projects describe stub-gcp-project") echo 123456789012; exit 0 ;;
  "run services describe")
    case "$*" in
      *annotations*) echo '["https://event-reg-123456789012.asia-southeast1.run.app","https://event-reg-abc123-as.a.run.app"]' ;;
      *) echo https://event-reg-abc123-as.a.run.app ;;
    esac
    exit 0 ;;
  "run jobs execute") [ "$STUB_MODE" != job-fail ]; exit $? ;;
  "secrets versions add") cat > "$TEST_STATE_DIR/payload-${4}"; exit 0 ;;
  "sql users list")
    if [ "$STUB_MODE" = first_run ]; then echo postgres; else printf 'postgres\nevent_app\n'; fi
    exit 0 ;;
esac
for word in "$@"; do
  if [ "$word" = describe ]; then
    case "$STUB_MODE" in
      first_run) exit 1 ;;
      partial) if [ "${1:-} ${3:-}" = 'secrets event-reg-database-url' ]; then exit 1; fi ;;
    esac
  fi
done
STUB
chmod +x "$TEST_STATE_DIR/bin/openssl" "$TEST_STATE_DIR/bin/gcloud"
export PATH="$TEST_STATE_DIR/bin:$PATH"
export PROJECT_ID=stub-gcp-project
export REGION=asia-southeast1
export DRY_RUN=0

for MODE in first_run rerun partial job-fail demo not_owner billing_off; do
  export STUB_MODE="$MODE"
  [ "$MODE" != demo ] || export STUB_MODE=first_run
  export GCLOUD_LOG="$TEST_STATE_DIR/gcloud-$MODE.log"
  rm -f "$TEST_STATE_DIR/sql-pass" "$TEST_STATE_DIR"/payload-* "$GCLOUD_LOG"
  args=()
  if [ "$MODE" = demo ]; then args+=(--demo); fi
  result=0
  bash "$DEPLOY_SCRIPT" "${args[@]}" > "$TEST_STATE_DIR/output" 2>&1 || result=$?
  expected=0
  case "$MODE" in job-fail|not_owner|billing_off) expected=1 ;; esac
  [ "$result" -eq "$expected" ] || { cat "$TEST_STATE_DIR/output"; fail "exit $result (wanted $expected)"; }

  # Preflight failures must stop before anything is enabled, created, built or deployed.
  if [ "$MODE" = not_owner ] || [ "$MODE" = billing_off ]; then
    if grep -Eq '^(services|artifacts|sql|iam|secrets|builds|run) |^projects add-iam-policy-binding' "$GCLOUD_LOG"; then
      fail 'a resource-changing gcloud call ran after a failed preflight'
    fi
    grep -q 'Nothing was created or changed' "$TEST_STATE_DIR/output" || fail 'preflight failure does not say nothing was created'
    if [ "$MODE" = not_owner ]; then
      grep -q 'is not a direct Owner' "$TEST_STATE_DIR/output" || fail 'non-owner message missing'
    else
      grep -q 'billing is not enabled' "$TEST_STATE_DIR/output" || fail 'billing message missing'
    fi
    echo "PASS: $MODE"
    continue
  fi
  grep -q 'Preflight OK: owner@example.test is an Owner of stub-gcp-project' "$TEST_STATE_DIR/output" || fail 'preflight did not run first'
  first_change="$(grep -n -E '^(services enable|sql instances create)' "$GCLOUD_LOG" | head -n 1 | cut -d: -f1)"
  preflight_line="$(grep -n '^billing projects describe' "$GCLOUD_LOG" | cut -d: -f1)"
  [ -n "$first_change" ] && [ -n "$preflight_line" ] && [ "$preflight_line" -lt "$first_change" ] || fail 'preflight is not before the first change'

  if [ "$MODE" = job-fail ]; then
    if grep -q '^run deploy ' "$GCLOUD_LOG"; then fail 'service deployed after migration failure'; fi
  else
    grep -q "^run deploy event-reg .*--service-account $RUNNER .*--port 3001" "$GCLOUD_LOG" || fail 'service not deployed as event-reg-runner on port 3001'
    grep -q '^run deploy .*ALLOW_NON_LOCAL_DATABASE=1' "$GCLOUD_LOG" || fail 'service lacks ALLOW_NON_LOCAL_DATABASE=1'
    grep -q '^run deploy .*DATABASE_URL=event-reg-database-url:latest' "$GCLOUD_LOG" || fail 'service lacks the DATABASE_URL secret'
    if grep -q '^run deploy .*event-reg-demo-password' "$GCLOUD_LOG"; then fail 'service mounts the demo password'; fi
    grep -Fq 'run services update event-reg --region asia-southeast1 --update-env-vars ^@^APP_ORIGIN=https://event-reg-123456789012.asia-southeast1.run.app,https://event-reg-abc123-as.a.run.app' "$GCLOUD_LOG" \
      || fail 'APP_ORIGIN does not list both Cloud Run URLs'
  fi
  grep -q "^run jobs deploy event-reg-migrate .*--service-account $MIGRATOR .*prisma migrate deploy" "$GCLOUD_LOG" || fail 'migration job does not run prisma migrate deploy as event-reg-migrator'
  if grep -q '^projects add-iam-policy-binding .*roles/secretmanager.secretAccessor' "$GCLOUD_LOG"; then
    fail 'project-wide secret access granted'
  fi
  for member in "$RUNNER" "$MIGRATOR"; do
    grep -q "^secrets add-iam-policy-binding event-reg-database-url --member=serviceAccount:$member --role=roles/secretmanager.secretAccessor" "$GCLOUD_LOG" \
      || fail "$member cannot read the DATABASE_URL secret"
  done
  if grep -q "^secrets add-iam-policy-binding event-reg-demo-password --member=serviceAccount:$RUNNER" "$GCLOUD_LOG"; then
    fail 'public service identity can read the demo password'
  fi

  if [ "$MODE" = demo ]; then
    grep -q "^secrets add-iam-policy-binding event-reg-demo-password --member=serviceAccount:$MIGRATOR " "$GCLOUD_LOG" || fail 'demo secret not granted to the job identity'
    grep -q '^run jobs deploy .*ALLOW_DEMO_SEED=1' "$GCLOUD_LOG" || fail 'seed not enabled with --demo'
    grep -q '^run jobs deploy .*DEMO_SEED_PASSWORD=event-reg-demo-password:latest' "$GCLOUD_LOG" || fail 'seed password secret missing'
    grep -q '^run jobs deploy .*prisma migrate deploy && node server/dist/seed.js' "$GCLOUD_LOG" || fail 'seed does not run after migrate'
    demo_pass="$(cat "$TEST_STATE_DIR/payload-event-reg-demo-password")"
    [ "${#demo_pass}" -ge 12 ] || fail 'demo password shorter than 12 characters'
  else
    if grep -q 'event-reg-demo-password\|ALLOW_DEMO_SEED\|seed.js' "$GCLOUD_LOG"; then fail 'demo seed configured without --demo'; fi
  fi

  case "$MODE" in
    first_run)
      grep -q -- '--edition=enterprise' "$GCLOUD_LOG" || fail 'missing --edition=enterprise'
      grep -q -- '--no-storage-auto-increase' "$GCLOUD_LOG" || fail 'storage auto-increase not disabled'
      grep -q '^iam service-accounts create event-reg-runner ' "$GCLOUD_LOG" || fail 'runtime identity not created'
      grep -q '^iam service-accounts create event-reg-migrator ' "$GCLOUD_LOG" || fail 'job identity not created'
      grep -q '^sql users create event_app ' "$GCLOUD_LOG" || fail 'DB user not created'
      grep -q '^Deployment completed' "$TEST_STATE_DIR/output" || fail 'real run does not report completion' ;;
    partial) grep -q '^sql users set-password event_app ' "$GCLOUD_LOG" || fail 'DB password not reset' ;;
    rerun)
      if grep -Eq '^(secrets create|sql users (create|set-password)|sql instances create) ' "$GCLOUD_LOG"; then
        fail 'rerun replaced existing resources or credentials'
      fi ;;
  esac

  if [ -f "$TEST_STATE_DIR/sql-pass" ]; then
    db_pass="$(cat "$TEST_STATE_DIR/sql-pass")"
    db_url="$(cat "$TEST_STATE_DIR/payload-event-reg-database-url")"
    case "$db_url" in
      "postgresql://event_app:${db_pass}@localhost/event_registration?host=/cloudsql/stub-gcp-project:asia-southeast1:event-reg-pg&schema=public") ;;
      *) fail 'DATABASE_URL does not match the DB user password and Cloud SQL socket' ;;
    esac
    if grep -Fq "$db_pass" "$TEST_STATE_DIR/output"; then fail 'DB password leaked to output'; fi
  fi
  for secret_file in "$TEST_STATE_DIR"/payload-*; do
    [ -f "$secret_file" ] || continue
    secret_value="$(cat "$secret_file")"
    if [ -n "$secret_value" ] && grep -Fq "$secret_value" "$TEST_STATE_DIR/output"; then fail 'secret value leaked to output'; fi
  done
  echo "PASS: $MODE"
done

MODE=dry_run
export GCLOUD_LOG="$TEST_STATE_DIR/dry-run-calls"
rm -f "$GCLOUD_LOG"
DRY_RUN=1 bash "$DEPLOY_SCRIPT" --demo > "$TEST_STATE_DIR/dry-run-output"
if [ -f "$GCLOUD_LOG" ]; then fail 'dry run called gcloud'; fi
grep -q '^\[DRY_RUN\] preflight: would confirm the active gcloud account holds roles/owner' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run plan does not show the preflight'
grep -q '^\[DRY_RUN\] gcloud sql users create event_app .*--password=<REDACTED>' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run did not show the plan'
grep -q '^\[DRY_RUN\] gcloud run deploy event-reg ' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run plan has no service deploy'
grep -q '^DRY RUN ONLY: no gcloud command was executed.' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run summary does not say nothing ran'
grep -q '^Nothing was created, changed or deployed' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run summary does not say nothing was created'
if grep -q 'Deployment completed' "$TEST_STATE_DIR/dry-run-output"; then fail 'dry run claims a completed deployment'; fi
echo 'PASS: dry run makes no gcloud calls and says nothing was created'
