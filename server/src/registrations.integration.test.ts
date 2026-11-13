import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import pg from "pg";
import { createApp } from "./app.js";
import { createSession } from "./auth/service.js";
import { createPrismaClient } from "./db.js";
import { Role, type PrismaClient } from "./generated/prisma/client.js";

const appOrigin = "http://127.0.0.1:5173";
const passwordHash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreOJRomJKitBgyAzG0qnqvsjfAZU";
const MISSING_EVENT_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

interface RunningApp {
  origin: string;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

/** Starts the real Express app on a loopback port. `applicationName` tags its DB backends in pg_stat_activity. */
async function startApp(applicationName?: string): Promise<RunningApp> {
  const url = new URL(process.env.DATABASE_URL!);
  if (applicationName) url.searchParams.set("application_name", applicationName);
  const prisma = createPrismaClient(url.href);
  const server: Server = createServer(createApp({ prisma, appOrigin, secureCookies: false }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback test server address.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    prisma,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      await prisma.$disconnect();
    },
  };
}

function register(app: RunningApp, eventId: string, cookie?: string, body: unknown = {}, query = "") {
  return fetch(`${app.origin}/api/events/${eventId}/registrations${query}`, {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function myRegistrations(app: RunningApp, cookie?: string, query = "") {
  return fetch(`${app.origin}/api/my/registrations${query}`, { headers: cookie ? { Cookie: cookie } : {} });
}

async function ids(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return ((await response.json()).data as Array<{ id: string }>).map(r => r.id);
}

describe("Sprint 1 F-03 — Register & My Registrations (PostgreSQL)", () => {
  let app: RunningApp;
  let prisma: PrismaClient;
  let organizer: string;
  let participantA: string;
  let participantB: string;
  let participantC: string;
  let cookieOrganizer: string;
  let cookieA: string;
  let cookieB: string;
  let cookieC: string;

  async function createEvent(capacity: number, title = "Workshop") {
    return prisma.event.create({
      data: { organizerId: organizer, title, description: "Intro", startsAt: new Date("2026-12-01T02:00:00Z"), location: "Hall A", capacity },
    });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be supplied by the guarded integration runner.");
    app = await startApp();
    prisma = app.prisma;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await prisma.registration.deleteMany();
    await prisma.session.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    const [o, a, b, c] = await Promise.all([
      prisma.user.create({ data: { email: "organizer@example.test", displayName: "Organizer", role: Role.ORGANIZER, passwordHash } }),
      prisma.user.create({ data: { email: "participant-a@example.test", displayName: "Participant A", role: Role.PARTICIPANT, passwordHash } }),
      prisma.user.create({ data: { email: "participant-b@example.test", displayName: "Participant B", role: Role.PARTICIPANT, passwordHash } }),
      prisma.user.create({ data: { email: "participant-c@example.test", displayName: "Participant C", role: Role.PARTICIPANT, passwordHash } }),
    ]);
    organizer = o.id; participantA = a.id; participantB = b.id; participantC = c.id;
    cookieOrganizer = `sid=${(await createSession(prisma, organizer)).token}`;
    cookieA = `sid=${(await createSession(prisma, participantA)).token}`;
    cookieB = `sid=${(await createSession(prisma, participantB)).token}`;
    cookieC = `sid=${(await createSession(prisma, participantC)).token}`;
  });

  it("T-07 / AC-07: registers once, reads back via a new request, and 404s a missing event without a row", async () => {
    const event = await createEvent(5);

    const created = await register(app, event.id, cookieA);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { data: registration } = await created.json();
    expect(registration).toEqual({
      id: expect.any(String),
      registeredAt: expect.stringMatching(/Z$/),
      event: { id: event.id, title: "Workshop", description: "Intro", startsAt: "2026-12-01T02:00:00.000Z", location: "Hall A", capacity: 5 },
    });

    const readBack = await myRegistrations(app, cookieA);
    expect(readBack.headers.get("cache-control")).toBe("no-store");
    const { data: list } = await readBack.json();
    expect(list).toEqual([registration]);
    expect(await prisma.registration.findMany({ where: { participantId: participantA } })).toHaveLength(1);

    const missing = await register(app, MISSING_EVENT_ID, cookieA);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "Event not found." } });
    const malformed = await register(app, "not-a-uuid", cookieA);
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.registration.count()).toBe(1);
  });

  it("returns my registrations ordered registeredAt DESC, id DESC", async () => {
    const [first, second] = [await createEvent(5, "First"), await createEvent(5, "Second")];
    const older = await prisma.registration.create({ data: { eventId: first.id, participantId: participantA, registeredAt: new Date("2026-11-01T00:00:00Z") } });
    const newer = await prisma.registration.create({ data: { eventId: second.id, participantId: participantA, registeredAt: new Date("2026-11-02T00:00:00Z") } });
    expect(await ids(await myRegistrations(app, cookieA))).toEqual([newer.id, older.id]);
  });

  it("T-08 / AC-08: sequential and concurrent duplicates return ALREADY_REGISTERED without extra rows, even when full", async () => {
    const full = await createEvent(1, "Capacity one");
    expect((await register(app, full.id, cookieA)).status).toBe(201);
    const repeat = await register(app, full.id, cookieA);
    expect(repeat.status).toBe(409);
    expect((await repeat.json()).error.code).toBe("ALREADY_REGISTERED"); // duplicate wins over full
    expect(await prisma.registration.count({ where: { eventId: full.id } })).toBe(1);

    const other = await createEvent(3, "Concurrent pair");
    const pair = await Promise.all([register(app, other.id, cookieA), register(app, other.id, cookieA)]);
    const outcomes = await Promise.all(pair.map(async r => ({ status: r.status, code: r.status === 201 ? "CREATED" : (await r.json()).error.code })));
    expect(outcomes.map(o => o.status).sort()).toEqual([201, 409]);
    expect(outcomes.find(o => o.status === 409)?.code).toBe("ALREADY_REGISTERED");
    expect(await prisma.registration.count({ where: { eventId: other.id, participantId: participantA } })).toBe(1);
    expect(await prisma.registration.count({ where: { eventId: other.id } })).toBe(1); // no extra seat consumed
  });

  it("T-09 / AC-09: both requests contend on the same event row lock; exactly one 201 and one EVENT_FULL", async () => {
    // Capacity 2 with one existing registration from C → exactly one seat left for A and B.
    const event = await createEvent(2, "Last seat");
    const seeded = await prisma.registration.create({ data: { eventId: event.id, participantId: participantC } });

    const tag = `t09-${process.pid}-${Date.now()}`;
    const appA = await startApp(`${tag}-A`);
    const appB = await startApp(`${tag}-B`);
    const controller = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: `${tag}-controller` });
    const observer = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: `${tag}-observer` });
    let controllerOpen = false;

    try {
      await Promise.all([controller.connect(), observer.connect()]);
      const controllerPid: number = (await controller.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await controller.query("BEGIN");
      controllerOpen = true;
      const lockedRow = await controller.query(`SELECT ctid::text AS ctid FROM "events" WHERE "id" = $1 FOR UPDATE`, [event.id]);
      expect(lockedRow.rowCount).toBe(1);
      const [, page, tuple] = /^\((\d+),(\d+)\)$/.exec(lockedRow.rows[0].ctid)!;

      // Fire both registrations through the real route, each via its own app instance and session.
      const pendingA = register(appA, event.id, cookieA);
      const pendingB = register(appB, event.id, cookieB);

      // Instrumentation: wait until both request backends are blocked and their blocker chain reaches the controller.
      type Waiter = { pid: number; application_name: string; query: string; wait_event_type: string | null; blockers: number[] };
      let waiters: Waiter[] = [];
      let proven = false;
      const deadline = Date.now() + 4_000; // must stay below the service's 5s lock_timeout
      while (!proven && Date.now() < deadline) {
        waiters = (await observer.query<Waiter>(
          `SELECT pid, application_name, query, wait_event_type, pg_blocking_pids(pid) AS blockers
             FROM pg_stat_activity
            WHERE application_name IN ($1, $2) AND state = 'active'`,
          [`${tag}-A`, `${tag}-B`],
        )).rows;
        const byPid = new Map(waiters.map(w => [w.pid, w]));
        const reachesController = (start: Waiter) => {
          const seen = new Set<number>();
          const queue = [...start.blockers];
          while (queue.length) {
            const pid = queue.shift()!;
            if (pid === controllerPid) return true;
            if (seen.has(pid) || !byPid.has(pid)) continue; // only follow the queue of the two requests
            seen.add(pid);
            queue.push(...byPid.get(pid)!.blockers);
          }
          return false;
        };
        const apps = new Set(waiters.map(w => w.application_name));
        proven = waiters.length === 2 && apps.size === 2
          && waiters.every(w => w.wait_event_type === "Lock" && /FROM "events"[\s\S]*FOR UPDATE/.test(w.query) && reachesController(w));
        if (!proven) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(proven, `Lock contention not proven. Observed waiters: ${JSON.stringify(waiters)}`).toBe(true);
      expect(new Set(waiters.map(w => w.pid)).size).toBe(2); // two distinct backend PIDs

      // Same event: the tuple lock queue is on the controller-locked events row (same ctid), held/awaited by A/B.
      const tupleLocks = (await observer.query<{ pid: number; granted: boolean }>(
        `SELECT l.pid, l.granted FROM pg_locks l
          WHERE l.locktype = 'tuple' AND l.relation = '"events"'::regclass AND l.page = $1 AND l.tuple = $2`,
        [Number(page), Number(tuple)],
      )).rows;
      const waiterPids = waiters.map(w => w.pid);
      expect(tupleLocks.length).toBeGreaterThan(0);
      expect(tupleLocks.every(l => waiterPids.includes(l.pid))).toBe(true);

      // Release the lock; neither request may have completed while it was held.
      await controller.query("ROLLBACK");
      controllerOpen = false;
      const responses = await Promise.all([pendingA, pendingB]);
      const outcomes = await Promise.all(responses.map(async (r, i) => ({ who: i === 0 ? "A" : "B", status: r.status, body: await r.json() })));

      expect(outcomes.map(o => o.status).sort()).toEqual([201, 409]);
      const winner = outcomes.find(o => o.status === 201)!;
      const loser = outcomes.find(o => o.status === 409)!;
      expect(loser.body).toEqual({ error: { code: "EVENT_FULL", message: "This event is full." } });

      const rows = await prisma.registration.findMany({ where: { eventId: event.id } });
      expect(rows).toHaveLength(event.capacity);
      expect(rows.map(r => r.id)).toContain(seeded.id);
      expect(rows.map(r => r.id)).toContain(winner.body.data.id);

      const retry = await register(loser.who === "A" ? appA : appB, event.id, loser.who === "A" ? cookieA : cookieB);
      expect(retry.status).toBe(409);
      expect((await retry.json()).error.code).toBe("EVENT_FULL");
      expect(await prisma.registration.count({ where: { eventId: event.id } })).toBe(event.capacity);
    } finally {
      if (controllerOpen) await controller.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([controller.end(), observer.end(), appA.close(), appB.close()]);
    }
  }, 20_000);

  it("T-10 / AC-10: denies anonymous/organizer/spoofing and keeps each participant's rows owner-scoped", async () => {
    const [eventA, eventB, target] = [await createEvent(5, "A's event"), await createEvent(5, "B's event"), await createEvent(5, "Target")];
    const regA = (await (await register(app, eventA.id, cookieA)).json()).data;
    const regB = (await (await register(app, eventB.id, cookieB)).json()).data;
    const snapshotA = [regA.id];
    const snapshotB = [regB.id];
    const rowsBefore = await prisma.registration.count();

    const anonymous = await register(app, target.id);
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("UNAUTHENTICATED");
    const asOrganizer = await register(app, target.id, cookieOrganizer);
    expect(asOrganizer.status).toBe(403);
    expect((await asOrganizer.json()).error.code).toBe("FORBIDDEN");

    expect(await ids(await myRegistrations(app, cookieB))).toEqual(snapshotB);
    const spoofBody = await register(app, target.id, cookieB, { participantId: participantA });
    expect(spoofBody.status).toBe(400);
    expect((await spoofBody.json()).error.code).toBe("VALIDATION_ERROR");
    const spoofQuery = await register(app, target.id, cookieB, {}, `?participantId=${participantA}`);
    expect(spoofQuery.status).toBe(400);
    const readOther = await myRegistrations(app, cookieB, `?participantId=${participantA}`);
    expect(readOther.status).toBe(400);
    const readOtherBody = await readOther.text();
    expect(readOtherBody).not.toContain(regA.id);

    expect(await prisma.registration.count()).toBe(rowsBefore);
    expect(await prisma.registration.count({ where: { eventId: target.id } })).toBe(0);

    const bAfter = await myRegistrations(app, cookieB);
    const bText = await bAfter.clone().text();
    expect(await ids(bAfter)).toEqual(snapshotB);
    for (const leaked of [regA.id, eventA.id, participantA, "participant-a@example.test", "Participant A"]) expect(bText).not.toContain(leaked);
    expect(await ids(await myRegistrations(app, cookieA))).toEqual(snapshotA);

    expect((await myRegistrations(app)).status).toBe(401);
    expect((await myRegistrations(app, cookieOrganizer)).status).toBe(403);
    expect(await ids(await myRegistrations(app, cookieC))).toEqual([]); // C has none; isolation is proven by A/B above
  });

  it("T-12 / AC-07: registration persists across an app restart against the same database", async () => {
    const event = await createEvent(3, "Persistent");
    const before = (await (await register(app, event.id, cookieA)).json()).data;

    const first = await startApp();
    expect(await ids(await myRegistrations(first, cookieA))).toEqual([before.id]);
    await first.close(); // stop the app process' server and its DB pool

    const restarted = await startApp(); // fresh client + server, no seeding
    try {
      const { data } = await (await myRegistrations(restarted, cookieA)).json();
      expect(data).toEqual([before]);
      const events = await (await fetch(`${restarted.origin}/api/events`, { headers: { Cookie: cookieA } })).json();
      expect(events.data.map((e: { id: string }) => e.id)).toContain(event.id);
    } finally {
      await restarted.close();
    }
  });
});

describe("Sprint 1 F-03 — database failures are not disguised", () => {
  let app: RunningApp;
  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 500 INTERNAL_ERROR with no-store when an unexpected DB error occurs", async () => {
    app = await startApp();
    const failing = new Proxy(app.prisma, {
      get(target, property) {
        if (property === "$transaction" || property === "registration") {
          return () => { throw new Error("Simulated registration database failure"); };
        }
        return Reflect.get(target, property);
      },
    });
    const server = createServer(createApp({ prisma: failing, appOrigin, secureCookies: false }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback test server address.");
    try {
      const user = await app.prisma.user.create({ data: { email: `failing-${Date.now()}@example.test`, displayName: "Failing", role: Role.PARTICIPANT, passwordHash } });
      const cookie = `sid=${(await createSession(app.prisma, user.id)).token}`;
      const failingApp = { origin: `http://127.0.0.1:${address.port}`, prisma: failing, close: async () => undefined } as RunningApp;
      for (const response of [await register(failingApp, MISSING_EVENT_ID, cookie), await myRegistrations(failingApp, cookie)]) {
        expect(response.status).toBe(500);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await response.json();
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(JSON.stringify(body)).not.toMatch(/Simulated|SELECT|registration database/);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });
});
