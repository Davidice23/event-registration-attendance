#!/usr/bin/env bash
# Offline checks for deploy/deploy.sh: `gcloud` and `openssl` are local stubs, so this
# makes no GCP calls and costs nothing. Adapted from the Lab 5 Starter Kit.
#
# Scenarios (asserted on the recorded gcloud calls):
#   first_run : nothing exists      -> everything created, auto-increase off, enterprise edition
#   rerun     : everything exists   -> no secret or DB credential is replaced
#   partial   : DB secret missing   -> existing DB user's password reset + secret created
#   job-fail  : migration fails     -> exit 1 and the service is NOT deployed
#   demo      : --demo              -> demo secret created/granted, seed runs after migrate
# Always: no project-wide secretAccessor, DB password == password inside DATABASE_URL,
# no generated value in the output, both Cloud Run URLs become APP_ORIGIN, and
# DRY_RUN=1 makes zero gcloud calls.
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

for MODE in first_run rerun partial job-fail demo; do
  export STUB_MODE="$MODE"
  [ "$MODE" != demo ] || export STUB_MODE=first_run
  export GCLOUD_LOG="$TEST_STATE_DIR/gcloud-$MODE.log"
  rm -f "$TEST_STATE_DIR/sql-pass" "$TEST_STATE_DIR"/payload-*
  args=()
  if [ "$MODE" = demo ]; then args+=(--demo); fi
  result=0
  bash "$DEPLOY_SCRIPT" "${args[@]}" > "$TEST_STATE_DIR/output" 2>&1 || result=$?
  expected=0
  if [ "$MODE" = job-fail ]; then expected=1; fi
  [ "$result" -eq "$expected" ] || { cat "$TEST_STATE_DIR/output"; fail "exit $result (wanted $expected)"; }

  if [ "$MODE" = job-fail ]; then
    if grep -q '^run deploy ' "$GCLOUD_LOG"; then fail 'service deployed after migration failure'; fi
  else
    grep -q '^run deploy event-reg .*--port 3001' "$GCLOUD_LOG" || fail 'service not deployed on port 3001'
    grep -q '^run deploy .*ALLOW_NON_LOCAL_DATABASE=1' "$GCLOUD_LOG" || fail 'service lacks ALLOW_NON_LOCAL_DATABASE=1'
    grep -q '^run deploy .*DATABASE_URL=event-reg-database-url:latest' "$GCLOUD_LOG" || fail 'service lacks the DATABASE_URL secret'
    grep -Fq 'run services update event-reg --region asia-southeast1 --update-env-vars ^@^APP_ORIGIN=https://event-reg-123456789012.asia-southeast1.run.app,https://event-reg-abc123-as.a.run.app' "$GCLOUD_LOG" \
      || fail 'APP_ORIGIN does not list both Cloud Run URLs'
  fi
  grep -q '^run jobs deploy event-reg-migrate .*prisma migrate deploy' "$GCLOUD_LOG" || fail 'migration job does not run prisma migrate deploy'
  if grep -q '^projects add-iam-policy-binding .*roles/secretmanager.secretAccessor' "$GCLOUD_LOG"; then
    fail 'runtime has project-wide secret access'
  fi
  grep -q '^secrets add-iam-policy-binding event-reg-database-url .*roles/secretmanager.secretAccessor' "$GCLOUD_LOG" \
    || fail 'runtime cannot read the DATABASE_URL secret'

  if [ "$MODE" = demo ]; then
    grep -q '^secrets add-iam-policy-binding event-reg-demo-password ' "$GCLOUD_LOG" || fail 'demo secret not granted'
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
      grep -q '^sql users create event_app ' "$GCLOUD_LOG" || fail 'DB user not created' ;;
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
DRY_RUN=1 bash "$DEPLOY_SCRIPT" --demo > "$TEST_STATE_DIR/dry-run-output"
if [ -f "$GCLOUD_LOG" ]; then fail 'dry run called gcloud'; fi
grep -q '^\[DRY_RUN\] gcloud sql users create event_app .*--password=<REDACTED>' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run did not show the plan'
grep -q '^\[DRY_RUN\] gcloud run deploy event-reg ' "$TEST_STATE_DIR/dry-run-output" || fail 'dry run plan has no service deploy'
echo 'PASS: dry run makes no gcloud calls'
