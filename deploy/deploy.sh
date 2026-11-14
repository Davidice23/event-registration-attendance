#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Event Registration — one-time GCP setup and first Cloud Run deploy (Lab 5 Step 5, #20)
# Adapted from the CPE334 Lab 5 Starter Kit (TokTickIT). Run from the REPO ROOT in Cloud Shell.
#
# Usage:
#   DRY_RUN=1 PROJECT_ID=YOUR_PROJECT_ID bash deploy/deploy.sh --demo   # print the plan, no gcloud calls
#   PROJECT_ID=YOUR_PROJECT_ID bash deploy/deploy.sh --demo             # create everything and deploy
#
# Who may run it: the project OWNER only. A preflight (step 0) checks that the active gcloud
# account is a direct Owner and that billing is enabled, and stops before anything is created.
#
# Environment: PROJECT_ID (default: active gcloud project), REGION (default asia-southeast1), DRY_RUN=1.
# --demo creates a demo-account password in Secret Manager and seeds the four synthetic
#        example.test accounts (needed for Lab 6 UAT). Without it, only migrations run.
#
# Steps: 0 preflight · 1 APIs · 2 Artifact Registry · 3 Cloud SQL instance · 4 database · 5 service accounts
#        6 DB user + DATABASE_URL secret · 7 demo password secret · secret access per secret
#        8 image build · 9 migration job (migrate, optional seed) · 10 Cloud Run service · 11 APP_ORIGIN
#
# Safe to re-run: existing resources and secrets are reused, credentials are never replaced.
# Passwords are generated here, stored only in Secret Manager, and never printed.
# Offline test: bash deploy/tests/test_deploy_stub.sh (CI runs it).
# Routine releases after this are done by .github/workflows/deploy.yml (Step 7, #22).
# ==============================================================================

DRY_RUN="${DRY_RUN:-0}"
REGION="${REGION:-asia-southeast1}"
SEED_DEMO_DATA="false"

for arg in "$@"; do
  case "$arg" in
    --demo) SEED_DEMO_DATA="true" ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--demo]" >&2
      exit 1
      ;;
  esac
done

# Prints the command (redacting --password=...) and runs it unless DRY_RUN=1.
run_cmd() {
  local arg
  if [ "$DRY_RUN" = "1" ]; then printf '[DRY_RUN] '; else printf '+ '; fi
  for arg in "$@"; do
    case "$arg" in
      --password=*) printf '%s ' '--password=<REDACTED>' ;;
      *) printf '%q ' "$arg" ;;
    esac
  done
  printf '\n'
  if [ "$DRY_RUN" != "1" ]; then "$@"; fi
}

if [ "$DRY_RUN" = "1" ]; then
  PROJECT_ID="${PROJECT_ID:-example-gcp-project}"
else
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is not set and no active gcloud project was found." >&2
    echo "Run: gcloud config set project YOUR_PROJECT_ID" >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# Resource names. release.sh, deploy.yml and teardown.sh must use the same names.
# ------------------------------------------------------------------------------
REPO_NAME="event-reg"
SQL_INSTANCE="event-reg-pg"
DB_NAME="event_registration"
DB_USER="event_app"
SERVICE_NAME="event-reg"
MIGRATE_JOB_NAME="event-reg-migrate"
# Two identities so the public service can never read the demo password:
#   event-reg-runner   = Cloud Run service (public): Cloud SQL client + DATABASE_URL only
#   event-reg-migrator = migration/seed job:         Cloud SQL client + DATABASE_URL + demo password
SA_NAME="event-reg-runner"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
JOB_SA_NAME="event-reg-migrator"
JOB_SA_EMAIL="${JOB_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONN_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
APP_PORT="3001"   # must match EXPOSE/PORT in the Dockerfile

# Secret Manager names (values never appear in this repository or in the output).
SECRET_DB_URL="event-reg-database-url"
SECRET_DEMO_PASS="event-reg-demo-password"

echo "=================================================================="
echo "Event Registration — Cloud Run deployment"
echo "Project : ${PROJECT_ID}"
echo "Region  : ${REGION}"
echo "Demo    : ${SEED_DEMO_DATA}"
echo "Dry Run : ${DRY_RUN}"
echo "=================================================================="

fail() {
  printf 'Preflight failed: %s\n' "$1" >&2
  printf '%s\n' "Nothing was created or changed." >&2
  exit 1
}

# 0. Preflight: nothing is created until the operator and billing are confirmed. ---------
#    The script grants IAM roles (projects/secrets add-iam-policy-binding), which needs
#    setIamPolicy. The Editor role the Student Guide gives teammates (1.3) does NOT include it,
#    so an Editor would fail halfway, after the billable Cloud SQL instance exists. Only a
#    project Owner (the member who created the project) may run this script.
if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY_RUN] preflight: would confirm the active gcloud account holds roles/owner on ${PROJECT_ID}"
  echo "[DRY_RUN] preflight: would confirm billing is enabled for ${PROJECT_ID}"
else
  OPERATOR="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1 || true)"
  [ -n "$OPERATOR" ] || fail "no active gcloud account. Run: gcloud auth login"
  case "$OPERATOR" in
    *.gserviceaccount.com) OPERATOR_MEMBER="serviceAccount:${OPERATOR}" ;;
    *) OPERATOR_MEMBER="user:${OPERATOR}" ;;
  esac
  if ! OWNERS="$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
      --filter='bindings.role=roles/owner' --format='value(bindings.members)' 2>/dev/null)"; then
    fail "cannot read the IAM policy of ${PROJECT_ID} as ${OPERATOR}. Check the project ID and your access."
  fi
  if ! printf '%s\n' "$OWNERS" | grep -qxF "$OPERATOR_MEMBER"; then
    fail "${OPERATOR} is not a direct Owner of ${PROJECT_ID}. This script grants IAM roles, which the Editor role cannot do. Ask the project Owner (the member who created the project) to run it in their Cloud Shell."
  fi
  BILLING_ENABLED="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
  [ "$BILLING_ENABLED" = "True" ] || fail "billing is not enabled for ${PROJECT_ID} (Student Guide 1.4). Link the Free Trial billing account first; never prepay or click Upgrade."
  echo "Preflight OK: ${OPERATOR} is an Owner of ${PROJECT_ID}, and billing is enabled."
fi

# 1. APIs ----------------------------------------------------------------------
run_cmd gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID"

# 2. Artifact Registry repository -------------------------------------------------
if [ "$DRY_RUN" = "1" ] || ! gcloud artifacts repositories describe "$REPO_NAME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  run_cmd gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location "$REGION" \
    --description="Event Registration container images" \
    --project "$PROJECT_ID"
fi

# 3. Cloud SQL for PostgreSQL (billed every hour it exists) ---------------------------
#    Smallest tier; db-f1-micro needs --edition=enterprise. Storage auto-increase is off
#    from the start (Student Guide 5.4). PostgreSQL 16 is the version the course kit was
#    rehearsed with; the app's migrations are plain SQL and run on 16 and on 18 locally.
if [ "$DRY_RUN" = "1" ] || ! gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  run_cmd gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition=enterprise \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=10GB \
    --storage-type=SSD \
    --no-storage-auto-increase \
    --backup-start-time=03:00 \
    --project "$PROJECT_ID"
fi

# 4. Database ---------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ] || ! gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  run_cmd gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" --project "$PROJECT_ID"
fi

# 5. Service accounts: Cloud SQL client only; secrets are granted one by one below.
ensure_service_account() {
  local name="$1" email="$2" display="$3"
  if [ "$DRY_RUN" = "1" ] || ! gcloud iam service-accounts describe "$email" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud iam service-accounts create "$name" --display-name="$display" --project "$PROJECT_ID"
  fi
  run_cmd gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${email}" \
    --role="roles/cloudsql.client" \
    --condition=None \
    --quiet
}
ensure_service_account "$SA_NAME" "$SA_EMAIL" "Event Registration Cloud Run service (public)"
ensure_service_account "$JOB_SA_NAME" "$JOB_SA_EMAIL" "Event Registration migration and seed job"

# 6. DB user + DATABASE_URL secret (only when the secret does not exist yet) --------------
#    The URL uses the Cloud SQL unix socket that Cloud Run mounts at /cloudsql/<connection>.
if [ "$DRY_RUN" = "1" ]; then
  run_cmd gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="<GENERATED_HEX_PASSWORD>" --project "$PROJECT_ID"
  run_cmd gcloud secrets create "$SECRET_DB_URL" --replication-policy="automatic" --project "$PROJECT_ID"
  run_cmd gcloud secrets versions add "$SECRET_DB_URL" --data-file=- --project "$PROJECT_ID"
elif ! gcloud secrets describe "$SECRET_DB_URL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  DB_PASS="$(openssl rand -hex 24)"
  if gcloud sql users list --instance="$SQL_INSTANCE" --project "$PROJECT_ID" --format="value(name)" | grep -qx "$DB_USER"; then
    run_cmd gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS" --project "$PROJECT_ID"
  else
    run_cmd gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS" --project "$PROJECT_ID"
  fi
  run_cmd gcloud secrets create "$SECRET_DB_URL" --replication-policy="automatic" --project "$PROJECT_ID"
  printf '%s' "postgresql://${DB_USER}:${DB_PASS}@localhost/${DB_NAME}?host=/cloudsql/${SQL_CONN_NAME}&schema=public" \
    | gcloud secrets versions add "$SECRET_DB_URL" --data-file=- --project "$PROJECT_ID"
  unset DB_PASS
fi

# 7. Demo-account password (only with --demo, only when the secret does not exist yet) ----
#    Read it privately with: gcloud secrets versions access latest --secret=event-reg-demo-password
JOB_SECRETS="DATABASE_URL=${SECRET_DB_URL}:latest"
JOB_ENV="NODE_ENV=production,ALLOW_NON_LOCAL_DATABASE=1"
JOB_COMMAND="./node_modules/.bin/prisma migrate deploy"
if [ "$SEED_DEMO_DATA" = "true" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    run_cmd gcloud secrets create "$SECRET_DEMO_PASS" --replication-policy="automatic" --project "$PROJECT_ID"
    run_cmd gcloud secrets versions add "$SECRET_DEMO_PASS" --data-file=- --project "$PROJECT_ID"
  elif ! gcloud secrets describe "$SECRET_DEMO_PASS" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run_cmd gcloud secrets create "$SECRET_DEMO_PASS" --replication-policy="automatic" --project "$PROJECT_ID"
    # 20 URL-safe characters (the seed requires at least 12).
    openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20 \
      | gcloud secrets versions add "$SECRET_DEMO_PASS" --data-file=- --project "$PROJECT_ID"
  fi
  JOB_SECRETS="${JOB_SECRETS},DEMO_SEED_PASSWORD=${SECRET_DEMO_PASS}:latest"
  JOB_ENV="${JOB_ENV},ALLOW_DEMO_SEED=1"
  JOB_COMMAND="${JOB_COMMAND} && node server/dist/seed.js"
fi

# Secret access per secret and per identity (never project-wide secretAccessor).
# The public service reads DATABASE_URL only; the demo password is readable by the job alone.
grant_secret() {
  run_cmd gcloud secrets add-iam-policy-binding "$1" \
    --member="serviceAccount:$2" \
    --role="roles/secretmanager.secretAccessor" \
    --project "$PROJECT_ID" --quiet
}
grant_secret "$SECRET_DB_URL" "$SA_EMAIL"
grant_secret "$SECRET_DB_URL" "$JOB_SA_EMAIL"
if [ "$SEED_DEMO_DATA" = "true" ]; then grant_secret "$SECRET_DEMO_PASS" "$JOB_SA_EMAIL"; fi

# 8. Build and push the image with Cloud Build (root Dockerfile). `latest` is only for this
#    first manual setup; the pipeline tags every image with the full commit SHA.
run_cmd gcloud builds submit --tag "$IMAGE_URI" --project "$PROJECT_ID"

# 9. Migration job (migrate, then the idempotent demo seed with --demo). If it fails, stop
#    before touching the service so a broken migration never reaches users.
run_cmd gcloud run jobs deploy "$MIGRATE_JOB_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --service-account "$JOB_SA_EMAIL" \
  --set-cloudsql-instances "$SQL_CONN_NAME" \
  --set-secrets "$JOB_SECRETS" \
  --set-env-vars "$JOB_ENV" \
  --command "sh" \
  --args "-c,${JOB_COMMAND}" \
  --max-retries 1 \
  --task-timeout 300s \
  --project "$PROJECT_ID"

if ! run_cmd gcloud run jobs execute "$MIGRATE_JOB_NAME" --region "$REGION" --wait --project "$PROJECT_ID"; then
  printf '%s\n' "ERROR: migration job '${MIGRATE_JOB_NAME}' failed. The service was not deployed." >&2
  printf '%s\n' "Logs: gcloud logging read \"resource.type=cloud_run_job AND resource.labels.job_name=${MIGRATE_JOB_NAME}\" --project \"${PROJECT_ID}\" --limit 50 --format=\"value(textPayload)\"" >&2
  exit 1
fi

# 10. Cloud Run service. APP_ORIGIN starts as the deterministic URL
#     https://SERVICE-PROJECT_NUMBER.REGION.run.app and is completed in step 11.
if [ "$DRY_RUN" = "1" ]; then
  PROJECT_NUMBER="000000000000"
else
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
fi
DETERMINISTIC_URL="https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"

run_cmd gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$SA_EMAIL" \
  --add-cloudsql-instances "$SQL_CONN_NAME" \
  --set-secrets "DATABASE_URL=${SECRET_DB_URL}:latest" \
  --set-env-vars "NODE_ENV=production,ALLOW_NON_LOCAL_DATABASE=1,APP_ORIGIN=${DETERMINISTIC_URL}" \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --port "$APP_PORT" \
  --project "$PROJECT_ID"

# 11. Allow every URL Cloud Run serves this service on (exact origins only), so sign-in
#     works from either the deterministic or the hash-style URL.
if [ "$DRY_RUN" = "1" ]; then
  SERVICE_URLS="${DETERMINISTIC_URL}"
else
  SERVICE_URLS="$( {
    echo "$DETERMINISTIC_URL"
    gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)'
    gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" \
      --format='value(metadata.annotations."run.googleapis.com/urls")' | grep -oE 'https://[^",]+' || true
  } | grep -E '^https://[^/]+$' | sort -u | paste -sd, - )"
  if [ "$SERVICE_URLS" != "$DETERMINISTIC_URL" ]; then
    # "^@^" makes @ the pair separator so the comma-separated value stays one variable.
    run_cmd gcloud run services update "$SERVICE_NAME" \
      --region "$REGION" \
      --update-env-vars "^@^APP_ORIGIN=${SERVICE_URLS}" \
      --project "$PROJECT_ID"
  fi
fi

printf '\n'
printf '%s\n' "=================================================================="
if [ "$DRY_RUN" = "1" ]; then
  printf '%s\n' "DRY RUN ONLY: no gcloud command was executed."
  printf '%s\n' "Nothing was created, changed or deployed, and nothing was billed."
  printf '%s\n' "The URLs below are placeholders (project number 000000000000)."
  printf '%s\n' "To deploy for real, run the same command without DRY_RUN=1 as the project Owner."
  printf '%s\n' "------------------------------------------------------------------"
  printf '%s\n' "Planned service URL: ${DETERMINISTIC_URL}"
  printf '%s\n' "=================================================================="
  exit 0
fi
printf '%s\n' "Deployment completed"
printf '%s\n' "Service URL    : ${DETERMINISTIC_URL}"
printf '%s\n' "Allowed origins: ${SERVICE_URLS}"
printf '%s\n' "Readiness      : ${DETERMINISTIC_URL}/api/ready"
printf '%s\n' "Database URL   : stored in Secret Manager '${SECRET_DB_URL}' (not printed)"
if [ "$SEED_DEMO_DATA" = "true" ]; then
  printf '%s\n' "Demo accounts  : organizer-a/-b@example.test, participant-a/-b@example.test"
  printf '%s\n' "Demo password  : stored in Secret Manager '${SECRET_DEMO_PASS}' (not printed; readable only by ${JOB_SA_NAME} and project Owners)"
fi
printf '%s\n' "Next           : check the resources in the Console (Student Guide 5.7) and that storage auto-increase is off (5.4)."
printf '%s\n' "=================================================================="
