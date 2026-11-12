import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { createSession } from "./auth/service.js";
import { createPrismaClient } from "./db.js";
import { Role, type PrismaClient } from "./generated/prisma/client.js";

describe("Sprint 1 F-02 — Publish & Discover", () => {
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

  async function post(path: string, body: unknown, cookie?: string) {
    return fetch(`${origin}${path}`, { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
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
    expect((await post("/api/events", { title: "Title", description: "Description", startsAt: "2026-11-15T09:00:00+07:00", location: "Hall", capacity: 1 }, cookieA)).status).toBe(201);
    expect(await prisma.event.count()).toBe(1);
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
});
