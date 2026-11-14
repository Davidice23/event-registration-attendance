# Lab 5 — Deployment

**Status:** draft started in #17 (cloud-ready). Sections marked _TBD_ are completed by later Lab 5 Issues (#18–#24).

## 1. Stack

| Part | Choice | Change from the reference stack |
|---|---|---|
| App | React 19 + Vite client, Express 5 + TypeScript API, Prisma 7 with `@prisma/adapter-pg` | None. The API also serves the built client from one container, as in the kit. |
| Database | PostgreSQL 18 locally; Cloud SQL for PostgreSQL in the cloud | None |
| Hosting | Cloud Run, images in Artifact Registry | None |
| Secrets | Secret Manager (runtime), GitHub Actions secrets/variables (pipeline) | None |
| CI/CD | GitHub Actions with Workload Identity Federation | None |

## 2. Cloud-ready checklist (#17)

| # | Check | Result |
|---|---|---|
| 1 | Uploaded files are not stored in the container | Already OK: the app has no file uploads. |
| 2 | The seed is safe for production | Changed: `server/src/seed.ts` (`npm run seed --workspace server`) creates the four synthetic `example.test` demo accounts. It needs `ALLOW_DEMO_SEED=1` and `DEMO_SEED_PASSWORD` (≥ 12 characters, from Secret Manager), never overwrites existing accounts, and never prints the password or connection details. The demo user list is shared with the local `npm run db:seed`. |
| 3 | No dev shortcuts in production | Changed: the login page's demo quick-fill buttons exist only in development builds (`import.meta.env.DEV`). No password is ever shown. |
| 4 | Sessions are stored in the database | Already OK: the `sessions` table stores SHA-256 token hashes. |
| 5 | The server reads `PORT` and can listen on all interfaces | Already OK for `PORT`; containers set `HOST=0.0.0.0`. In production, startup now fails if `DATABASE_URL` is missing or rejected. |
| 6 | `/api/ready` exists | Changed: `GET /api/ready` returns `200 {"data":{"status":"ready"}}` when `SELECT 1` succeeds within 3 s, otherwise `503 TEMPORARILY_UNAVAILABLE` with no internal details. |

Also changed:
- `CLIENT_DIST_DIR`: when set, Express serves `client/dist` (fingerprinted `assets/` cached for a year, everything else `no-cache`) and returns `index.html` for client routes such as `/events`. Unknown `/api/*` routes stay JSON `404`. UI and API share one origin, so the existing Origin/CSRF check and the `HttpOnly; Secure; SameSite` session cookie need no CORS.
- `ALLOW_NON_LOCAL_DATABASE=1`: by default the app accepts only the two local loopback databases. Deployed environments opt in explicitly. It still requires a PostgreSQL URL.

## 3. Environment variables

Placeholders only. Never commit real values.

| Variable | Purpose | Secret? | Local value comes from | Cloud value comes from |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | **Yes** | `.env` (local dev DB on 127.0.0.1:5433) | Secret Manager _(name TBD in #20)_ |
| `TEST_DATABASE_URL` | Dedicated local test DB for integration/E2E tests | Local-only placeholder | `.env` (127.0.0.1:5434) | Not used. CI uses a throwaway service DB _(TBD in #19)_. |
| `ALLOW_NON_LOCAL_DATABASE` | Allows a non-loopback database (Cloud SQL, Compose) | No | Unset | Cloud Run env `1` |
| `NODE_ENV` | `production` enables `Secure` cookies and fail-fast DB startup | No | `development` | Cloud Run env `production` |
| `APP_ORIGIN` | The only Origin allowed for `POST` (CSRF check) | No | `http://127.0.0.1:5173` | Cloud Run env = the service URL _(TBD in #20)_ |
| `PORT` | Listen port | No | `3001` | Set by Cloud Run |
| `HOST` | Listen address | No | `127.0.0.1` | `0.0.0.0` |
| `CLIENT_DIST_DIR` | Built client served by the API | No | Unset (Vite dev server) | `/app/client/dist` |
| `ALLOW_DEMO_SEED` | Opt-in for the seed commands | No | `0` | `1` on the migration job only |
| `DEMO_SEED_PASSWORD` | Password for the four demo accounts (≥ 12 chars) | **Yes** | `.env`, local-only | Secret Manager _(name TBD in #20)_, shared with the Lab 6 partner team privately |
| `ALLOW_TEST_DB_RESET` | Opt-in for `npm run db:reset:test` | No | `0` | Not used |
| `POSTGRES_PASSWORD`, `COMPOSE_PROJECT_NAME` | Local Docker Compose database | Local-only placeholder | `.env` | Not used |
| `API_PROXY_TARGET`, `E2E_DATABASE_URL`, `E2E_BROWSER_CHANNEL` | Vite proxy target and Playwright E2E settings | No | Set by `npm run test:e2e` | Not used |

## 4. Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Unit tests | `npm test` |
| Integration tests (local test DB) | `npm run test:integration` |
| Browser E2E (local test DB) | `npm run test:e2e` |
| Build | `npm run build` |
| Validate schema | `npm run db:validate` |
| Migrate (local dev DB) | `npm run db:migrate` |
| Seed (local dev DB) | `npm run db:seed` |
| Seed (deployed) | `npm run seed --workspace server` after `npm run build` |
| Run built app | `npm run start --workspace server` with `CLIENT_DIST_DIR=client/dist` |
| First Docker setup (PowerShell) | `Copy-Item .env.example .env` then set a local-only `POSTGRES_PASSWORD` using URI-safe characters (letters, numbers, `-`, `_`) |
| Docker build and start app + database | `docker compose up --build` |
| Check container readiness | `curl http://127.0.0.1:3001/api/ready` |
| Stop containers, keep local database volume | `docker compose down` |
| Apply migrations only | `docker compose run --build --rm migrate` |
| Seed demo accounts (opt-in only) | Set `ALLOW_DEMO_SEED=1` and a local-only `DEMO_SEED_PASSWORD` in `.env`, then `docker compose --profile seed run --build --rm seed` |
| Migrate (cloud) | _TBD in #20_ (`prisma migrate deploy` in a Cloud Run job) |

## 5. Container image and local Compose (Issue #18)

- The root `Dockerfile` builds the React/Vite client and Express/TypeScript server from the root npm workspace lockfile, then copies their build output into one Node 24.14.0 runtime image. Express serves `client/dist` and the API from that same origin; the container binds `HOST=0.0.0.0` and reads `PORT` from the environment.
- Build context is the repository root. `.dockerignore` excludes `.env` files (including the example), `.npmrc`, credentials, local dependencies, generated output, test artifacts, databases, documentation/evidence, and `.git`. `DATABASE_URL` and `DEMO_SEED_PASSWORD` are supplied only to a running service/job; they are not Docker build arguments or image files.
- `docker compose up --build` starts the existing PostgreSQL development service, waits for it to become healthy, runs the one-shot `migrate` service, then starts `app`. Compose constructs the container's `DATABASE_URL` with the `postgres-dev` service hostname and sets `ALLOW_NON_LOCAL_DATABASE=1`; the host-only loopback allowlist remains unchanged for laptop/test commands.
- PostgreSQL uses the existing named volume `event-registration-dev-data`. `docker compose down` preserves it; `docker compose down --volumes` deletes it and must be treated as a destructive local reset.
- Compose migrations change the schema in that development volume. To keep a Docker smoke run separate from the usual local Compose project/database, run it with a unique project name (for example, `docker compose -p lab5-docker up --build`); this creates a separate named volume and still binds the same host ports, so stop conflicting Compose services first.
- The `app` service healthcheck calls `/api/ready` from inside the container using Node's built-in `fetch`; a healthy status means the HTTP server is serving and its database readiness check succeeded.
- Demo seed is deliberately outside the default `up` flow. To seed the four synthetic accounts, set `ALLOW_DEMO_SEED=1` and a local-only `DEMO_SEED_PASSWORD` of at least 12 characters in `.env`, then run `docker compose --profile seed run --rm seed`. The seed service waits for migrations and is safe to rerun.
- **Migration image decision:** Prisma CLI currently lives in the root `devDependencies`. The runtime stage therefore copies the root lockfile's installed workspace `node_modules`, plus `prisma.config.ts`, `prisma/`, and the compiled seed. This keeps `prisma migrate deploy` available in the same immutable image for the one-shot Compose service and the later Cloud Run Job (Step 5), without adding a second Docker image or migrating concurrently at API startup. This makes the image larger than a production-only dependency install; optimize only if the migration CLI remains available in the exact same deployable image.
- Local Compose publishes only to `127.0.0.1:${PORT}` and sets `APP_ORIGIN` to that exact URL. Open `http://127.0.0.1:3001` when using the `.env.example` port. Do not change the browser host to `localhost` unless `APP_ORIGIN` is changed to match.

For a reproducible verification, record the tested commit and the actual results for Docker build, Compose startup, `/api/ready`, persistence-after-restart, and image-secret inspection in the Issue #18 PR. This document defines the procedure; it does not claim those checks have already passed.

## 6. GCP project, region and resources

_TBD in #16 and #20._

## 7. Release procedure and finding the running commit

_TBD in #22._
