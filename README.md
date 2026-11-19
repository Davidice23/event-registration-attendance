# Event Registration and Attendance

CPE334 Group Project — Theme 3: Event Registration and Attendance System. Sprint 1 implements authenticated Organizer and Participant workflows for publishing/discovering events, registering with duplicate/capacity protection, viewing personal registrations, and reading an owner-scoped Organizer roster. The implementation is on `staging`; it is **not yet a reviewed release on `main`**.

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

Open <http://127.0.0.1:5173>. The Vite server forwards `/api` to Express at `127.0.0.1:3001`; both are loopback-only in development. Sign in with a seeded demo account to reach the role-specific event workspace. The health endpoint remains available at `GET /api/health`.

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

The runner applies migrations to `event_registration_test`, then Playwright starts its own API on `127.0.0.1:3101` and Vite on `127.0.0.1:5174` (so a running dev server is not affected). Each test wipes only the guarded test database and inserts synthetic `example.test` users with a password generated per run. Current browser tests include F-04 owner roster, empty roster, and access-denial flows.

## Database safety commands

- `npm run db:validate` validates the checked-in Prisma schema without connecting to a database.
- `npm run db:migrate` applies migrations only to loopback `event_registration_dev`.
- `npm run db:migrate:test` applies migrations only to loopback `event_registration_test`.
- `npm run db:reset:test` is the only reset command. It requires `ALLOW_TEST_DB_RESET=1` and revalidates the loopback host, exact test database name, configured test port, and distinction from `DATABASE_URL` before invoking Prisma reset. There is no development/production reset script.
- `npm run db:seed` creates four synthetic `example.test` users in the local development database only. It requires `ALLOW_DEMO_SEED=1`, a local-only `DATABASE_URL` targeting `event_registration_dev`, and a non-empty `DEMO_SEED_PASSWORD` of at least 12 characters. The password is hashed with Argon2id and is never printed. Re-running does not overwrite existing credentials. This command is not part of app startup or tests.

No command in this scaffold configures GCP, billing, IAM, production secrets, or a production database. Do not point any scaffold command at production.

## Current scope

Included: React/Vite client, Express/TypeScript API, Prisma/PostgreSQL schema and versioned migrations, isolated local/test database configuration, guarded local seed/reset commands, and reproducible workspace scripts. Implemented Sprint 1 features are F-01 authentication, F-02 publish/discover events, F-03 registration/My Registrations, and F-04 owner-scoped Organizer roster (PRs #8–#12 into `staging`). Release PR #14 is merged to `main`; Issues #2–#6 were closed by that merge.

## Sprint 1 release-readiness status (2026-11-14)

The latest `staging` merge commit is `8f71d7f51c8adbaa252fc43007ebda6ac503d8d6` (tree `172327270e61bb8ca3b24bc2b7951d6b28687a50`). Release verification was rerun on local commit `ac477dc3389ae5e108649a68a3c51d9d8b66ef9b`, which has the exact same tree as that staging merge commit. The runtime implementation is unchanged from `6b77db32506c08ec569b9ad795ca3cad9ffe5bda` (tree `37a1d25a2bbdaef7d5aa5ac0e0cc52d04308801b`); the intervening PR #13 changed only README/Sprint 1 documentation. Reviewed release PR [#14](https://github.com/Davidice23/event-registration-attendance/pull/14) merged on 2026-11-14; the resulting `main` release commit is `98c6c04cf72fa62f8f5be4bd699310f6bee734ad`. Environment: Node.js 24.14.0, npm 11.9.0, PostgreSQL 18.1 in the isolated test container, and Microsoft Edge (`E2E_BROWSER_CHANNEL=msedge`).

| Command | Result |
|---|---|
| `npm test` | Passed: safety 6/6, client 21/21, server 39/39 |
| `npm run test:integration` | Passed: 27/27 against loopback `event_registration_test` on port 5434 |
| `npm run test:e2e` | Passed: 8/8, including F-04 roster and authorization flows |
| `npm run build` | Passed: client TypeScript/Vite and server TypeScript builds |
| `npm run db:validate` | Passed: Prisma schema valid |

These are local results; GitHub reported no combined status checks or PR-triggered Actions runs for the release. Khawpun124 submitted an `APPROVED` review on PR #14, which merged to `main`; Issues #2–#6 are closed. No separate tag was created; the exact release SHA above is the Sprint 1 handoff identifier. Davidice23 reported in chat on 2026-11-14 that the work was rechecked before merge. No per-scenario visual checklist or screenshot files were attached, so that statement is recorded as user-reported and is not independently auditable from this repository. No instructor acceptance is claimed. Do not treat these local tests as Lab 5 Docker/CI/CD/deployment evidence.
