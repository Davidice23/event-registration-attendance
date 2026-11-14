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
| `CLIENT_DIST_DIR` | Built client served by the API | No | Unset (Vite dev server) | Image path _(TBD in #18)_ |
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
| Docker build/run | _TBD in #18_ |
| Migrate (cloud) | _TBD in #20_ (`prisma migrate deploy` in a Cloud Run job) |

## 5. GCP project, region and resources

_TBD in #16 and #20._

## 6. Release procedure and finding the running commit

_TBD in #22._
