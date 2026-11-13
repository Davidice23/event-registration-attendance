# Event Registration and Attendance

CPE334 Group Project — Theme 3. This repository starts with the approved Sprint 1 design baseline. The current scaffold intentionally provides a health-check UI/API and database tooling only; it does not implement login or event workflows yet.

## Prerequisites

- Node.js **24.14.0** and npm **11.9.0** (the versions used to verify this scaffold).
- Docker Desktop with its Linux container engine running for the isolated PostgreSQL services.

The npm workspaces and root `package-lock.json` are the single dependency installation boundary.

## First-time setup (PowerShell)

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
docker compose up -d postgres-dev postgres-test
npm run db:migrate
```

The Compose services bind only to `127.0.0.1`: development PostgreSQL uses port `5433` and database `event_registration_dev`; test PostgreSQL uses port `5434` and database `event_registration_test`. They have separate containers and named volumes. Compose uses `COMPOSE_PROJECT_NAME` from `.env` so the same commands work regardless of checkout folder; the checked-in example uses the shared project name, while a worktree may choose a distinct local name. The committed `.env.example` credentials are explicitly local-only placeholders; replace them in `.env` for local use and never reuse them outside this machine. `.env` is ignored by Git.

## Run the app

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. The Vite server forwards `/api` to Express at `127.0.0.1:3001`; both are loopback-only in development. The landing page checks `GET /api/health` and displays the API response.

## Build and tests

```powershell
npm test
npm run build
```

`npm test` runs local-database safety tests plus client/server unit tests and does not connect to a database. `npm run build` generates the Prisma client and builds both workspaces. The opt-in PostgreSQL integration smoke test is:

```powershell
npm run test:integration
```

It validates the `TEST_DATABASE_URL`, applies checked-in migrations to that dedicated local test database, then checks Prisma connectivity. It will fail closed if the test URL is missing, remote, not exactly the expected test database, or equal to `DATABASE_URL`.

Browser E2E tests (Playwright, `e2e/`) use the same guarded test database:

```powershell
npx playwright install chromium   # once; or set E2E_BROWSER_CHANNEL=chrome / msedge to use an installed browser
npm run test:e2e
```

The runner applies migrations to `event_registration_test`, then Playwright starts its own API on `127.0.0.1:3101` and Vite on `127.0.0.1:5174` (so a running dev server is not affected). Each test wipes the test database and inserts synthetic `example.test` users with a password generated per run. Roster steps of T-13/T-14 are marked `fixme` until F-04 lands.

## Database safety commands

- `npm run db:validate` validates the checked-in Prisma schema without connecting to a database.
- `npm run db:migrate` applies migrations only to loopback `event_registration_dev`.
- `npm run db:migrate:test` applies migrations only to loopback `event_registration_test`.
- `npm run db:reset:test` is the only reset command. It requires `ALLOW_TEST_DB_RESET=1` and revalidates the loopback host, exact test database name, configured test port, and distinction from `DATABASE_URL` before invoking Prisma reset. There is no development/production reset script.
- `npm run db:seed` creates four synthetic `example.test` users in the local development database only. It requires `ALLOW_DEMO_SEED=1`, a local-only `DATABASE_URL` targeting `event_registration_dev`, and a non-empty `DEMO_SEED_PASSWORD` of at least 12 characters. The password is hashed with Argon2id and is never printed. Re-running does not overwrite existing credentials. This command is not part of app startup or tests.

No command in this scaffold configures GCP, billing, IAM, production secrets, or a production database. Do not point any scaffold command at production.

## Current scope

Included: React/Vite client, Express/TypeScript API health endpoint, Prisma/PostgreSQL schema and first migration for the approved baseline entities, isolated local/test database configuration, guarded local seed/reset commands, and reproducible workspace scripts. Authentication (F-01), event publishing (F-02) and registration with My Registrations (F-03, API and UI at `/events` and `/my/registrations`) are implemented; the organizer roster (F-04, Issue #6) is not yet.
