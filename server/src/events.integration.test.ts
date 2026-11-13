import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { createSession } from "./auth/service.js";
import { createPrismaClient } from "./db.js";
import { Role, type PrismaClient } from "./generated/prisma/client.js";

describe("Sprint 1 F-02 / F-04 — Publish, Discover & Organizer Roster", () => {
  let server: Server;
  let origin: string;
  let prisma: PrismaClient;
  let organizerA: string;
  let organizerB: string;
  let participant: string;
  let cookieA: string;
  let cookieB: string;
  let cookieParticipant: string;
  const appOrigin = "http://127.0.0.1:5173";
  const passwordHash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreOJRomJKitBgyAzG0qnqvsjfAZU";
  const MISSING_EVENT_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

  async function post(path: string, body: unknown, cookie?: string) {
    return fetch(`${origin}${path}`, { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  }

  async function get(path: string, cookie?: string) {
    return fetch(`${origin}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  }

  async function createEvent(organizerId: string, title: string, capacity = 5) {
    return prisma.event.create({
      data: { organizerId, title, description: "Intro", startsAt: new Date("2026-12-01T02:00:00Z"), location: "Hall A", capacity },
    });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be supplied by the guarded integration runner.");
    prisma = createPrismaClient();
    server = createServer(createApp({ prisma, appOrigin, secureCookies: false }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback test server address.");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.registration.deleteMany();
    await prisma.session.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    const [a, b, p] = await Promise.all([
      prisma.user.create({ data: { email: "organizer-a@example.test", displayName: "Organizer A", role: Role.ORGANIZER, passwordHash } }),
      prisma.user.create({ data: { email: "organizer-b@example.test", displayName: "Organizer B", role: Role.ORGANIZER, passwordHash } }),
      prisma.user.create({ data: { email: "participant-a@example.test", displayName: "Participant A", role: Role.PARTICIPANT, passwordHash } }),
    ]);
    organizerA = a.id; organizerB = b.id; participant = p.id;
    cookieA = `sid=${(await createSession(prisma, organizerA)).token}`;
    cookieB = `sid=${(await createSession(prisma, organizerB)).token}`;
    cookieParticipant = `sid=${(await createSession(prisma, participant)).token}`;
  });

  it("T-04: organizer publishes; participant discovers; organizer list is owner-scoped", async () => {
    const response = await post("/api/events", { title: " Workshop ", description: "Intro", startsAt: "2026-11-15T02:00:00Z", location: "Hall A", capacity: 1 }, cookieA);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data: event } = await response.json();
    expect(event).toMatchObject({ title: "Workshop", description: "Intro", startsAt: "2026-11-15T02:00:00.000Z", location: "Hall A", capacity: 1 });
    expect(event).not.toHaveProperty("organizerId");
    expect(await prisma.event.count()).toBe(1);

    const [mine, theirs, publicList] = await Promise.all([
      fetch(`${origin}/api/organizer/events`, { headers: { Cookie: cookieA } }),
      fetch(`${origin}/api/organizer/events`, { headers: { Cookie: cookieB } }),
      fetch(`${origin}/api/events`, { headers: { Cookie: cookieParticipant } }),
    ]);
    expect((await mine.json()).data.map((e: { id: string }) => e.id)).toEqual([event.id]);
    expect((await theirs.json()).data).toEqual([]);
    expect((await publicList.json()).data.map((e: { id: string }) => e.id)).toEqual([event.id]);
  });

  it("T-05: rejects invalid input without inserting a row and accepts capacity 1", async () => {
    const invalid = [
      { capacity: 0 }, { capacity: -1 }, { capacity: 1.5 }, { capacity: "1" }, { capacity: 2_147_483_648 },
      { startsAt: "2026-02-30T10:00:00Z" }, { startsAt: "2026-11-15T09:00:00" },
      { title: " " }, { description: "x".repeat(1001) }, { location: "x".repeat(161) },
    ];
    for (const override of invalid) expect((await post("/api/events", { title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00+07:00", location: "Hall", capacity: 2, ...override }, cookieA)).status).toBe(400);
    expect(await prisma.event.count()).toBe(0);
    const invalidResponse = await post("/api/events", { title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00+07:00", location: "Hall", capacity: 0 }, cookieA);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.headers.get("cache-control")).toBe("no-store");
    expect((await post("/api/events", { title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00+07:00", location: "Hall", capacity: 1 }, cookieA)).status).toBe(201);
    expect(await prisma.event.count()).toBe(1);
  });

  it("sets no-store on event service errors", async () => {
    const failingPrisma = new Proxy(prisma, {
      get(target, property) {
        if (property === "event") {
          return new Proxy(target.event, {
            get(delegate, method) {
              if (method === "create" || method === "findMany") {
                return async () => { throw new Error("Simulated event database failure"); };
              }
              return Reflect.get(delegate, method);
            },
          });
        }
        return Reflect.get(target, property);
      },
    });
    const failingServer = createServer(createApp({ prisma: failingPrisma, appOrigin, secureCookies: false }));
    await new Promise<void>(resolve => failingServer.listen(0, "127.0.0.1", resolve));
    const address = failingServer.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback test server address.");
    const failingOrigin = `http://127.0.0.1:${address.port}`;

    try {
      const [publishError, discoverError] = await Promise.all([
        fetch(`${failingOrigin}/api/events`, {
          method: "POST",
          headers: { Origin: appOrigin, "Content-Type": "application/json", Cookie: cookieA },
          body: JSON.stringify({ title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00Z", location: "Hall", capacity: 1 }),
        }),
        fetch(`${failingOrigin}/api/events`, { headers: { Cookie: cookieParticipant } }),
      ]);
      expect(publishError.status).toBe(500);
      expect(publishError.headers.get("cache-control")).toBe("no-store");
      expect(discoverError.status).toBe(500);
      expect(discoverError.headers.get("cache-control")).toBe("no-store");
    } finally {
      await new Promise<void>((resolve, reject) => failingServer.close(error => error ? reject(error) : resolve()));
    }
  });

  it("T-06: enforces role, authentication, and server-derived ownership", async () => {
    const input = { title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00Z", location: "Hall", capacity: 1 };
    expect((await post("/api/events", input)).status).toBe(401);
    expect((await post("/api/events", input, cookieParticipant)).status).toBe(403);
    const spoof = await post("/api/events", { ...input, organizerId: organizerB }, cookieA);
    expect(spoof.status).toBe(400);
    expect(await prisma.event.count()).toBe(0);
    expect((await fetch(`${origin}/api/events`)).status).toBe(401);
    expect((await fetch(`${origin}/api/organizer/events`, { headers: { Cookie: cookieParticipant } })).status).toBe(403);
  });

  it("T-11 / AC-11: returns the owner's minimal roster in stable registration order, including an empty roster", async () => {
    const event = await createEvent(organizerA, "Roster");
    const emptyEvent = await createEvent(organizerA, "Empty roster");
    const participantB = await prisma.user.create({ data: { email: "participant-b@example.test", displayName: "Participant B", role: Role.PARTICIPANT, passwordHash } });
    const participantC = await prisma.user.create({ data: { email: "participant-c@example.test", displayName: "Participant C", role: Role.PARTICIPANT, passwordHash } });
    const registrations = [
      { id: "00000000-0000-4000-8000-000000000003", participantId: participant, registeredAt: new Date("2026-11-14T03:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000002", participantId: participantB.id, registeredAt: new Date("2026-11-14T04:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000001", participantId: participantC.id, registeredAt: new Date("2026-11-14T04:00:00Z") },
    ];
    for (const registration of registrations) {
      await prisma.registration.create({ data: { ...registration, eventId: event.id } });
    }

    const response = await get(`/api/organizer/events/${event.id}/registrations`, cookieA);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data).toEqual([
      { registrationId: registrations[0].id, participantDisplayName: "Participant A", registeredAt: "2026-11-14T03:00:00.000Z" },
      { registrationId: registrations[2].id, participantDisplayName: "Participant C", registeredAt: "2026-11-14T04:00:00.000Z" },
      { registrationId: registrations[1].id, participantDisplayName: "Participant B", registeredAt: "2026-11-14T04:00:00.000Z" },
    ]);
    expect(Object.keys(body.data[0]).sort()).toEqual(["participantDisplayName", "registeredAt", "registrationId"]);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|participant-a@example\.test|participant-b@example\.test|participant-c@example\.test|organizerId|email/);

    const empty = await get(`/api/organizer/events/${emptyEvent.id}/registrations`, cookieA);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: [] });
  });

  it("T-11 / AC-12: denies anonymous and Participant access and hides cross-owner event existence", async () => {
    const ownedByB = await prisma.event.create({ data: { organizerId: organizerB, title: "Private roster", description: "Private", startsAt: new Date("2026-12-01T02:00:00Z"), location: "Hall", capacity: 1 } });
    await prisma.registration.create({ data: { eventId: ownedByB.id, participantId: participant } });

    const anonymous = await get(`/api/organizer/events/${ownedByB.id}/registrations`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await anonymous.json())).not.toContain("Participant");

    const participantResponse = await get(`/api/organizer/events/${ownedByB.id}/registrations`, cookieParticipant);
    expect(participantResponse.status).toBe(403);
    expect(JSON.stringify(await participantResponse.json())).not.toContain("Participant");

    const otherOwner = await get(`/api/organizer/events/${ownedByB.id}/registrations`, cookieA);
    const missing = await get(`/api/organizer/events/${MISSING_EVENT_ID}/registrations`, cookieA);
    expect(otherOwner.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await otherOwner.json()).toEqual({ error: { code: "NOT_FOUND", message: "Event not found." } });
    expect(await missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "Event not found." } });

    expect((await get(`/api/organizer/events/${ownedByB.id}/registrations?participantId=${participant}`, cookieB)).status).toBe(400);
    expect((await get("/api/organizer/events/not-a-uuid/registrations", cookieA)).status).toBe(400);
  });
});
