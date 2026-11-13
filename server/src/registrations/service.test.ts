// Unit tests for the registration service's transaction ordering and error mapping.
// Correctness under real concurrency (AC-08/AC-09) is proven against PostgreSQL in
// ../registrations.integration.test.ts; these mocks cannot prove locking.
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { RegistrationError } from "./errors.js";
import { isDuplicateRegistrationViolation, isTransientDatabaseError, listMyRegistrations, registerForEvent } from "./service.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const participantId = "22222222-2222-4222-8222-222222222222";
const lockedEvent = {
  id: eventId,
  title: "Workshop",
  description: "Intro",
  startsAt: new Date("2026-11-15T02:00:00.000Z"),
  location: "Hall A",
  capacity: 2,
};

function knownError(code: string, cause?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("simulated", {
    code,
    clientVersion: "test",
    meta: cause ? { driverAdapterError: { name: "DriverAdapterError", cause } } : undefined,
  });
}

function makePrisma(overrides: { event?: unknown[]; existing?: unknown; count?: number; createError?: unknown } = {}) {
  const calls: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => { calls.push(`exec:${sql}`); return 0; }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => { calls.push(`lock:${strings.join("?")}`); return overrides.event ?? [lockedEvent]; }),
    registration: {
      findUnique: vi.fn(async () => { calls.push("findUnique"); return overrides.existing ?? null; }),
      count: vi.fn(async () => { calls.push("count"); return overrides.count ?? 0; }),
      create: vi.fn(async () => {
        calls.push("create");
        if (overrides.createError) throw overrides.createError;
        return { id: "33333333-3333-4333-8333-333333333333", registeredAt: new Date("2026-11-14T00:00:00.000Z") };
      }),
    },
  };
  const $transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>, _options?: unknown) => callback(tx));
  return { prisma: { $transaction } as unknown as PrismaClient, tx, calls, $transaction };
}

describe("registerForEvent", () => {
  it("locks the event FOR UPDATE at READ COMMITTED before the duplicate check, count and insert", async () => {
    const { prisma, calls, $transaction, tx } = makePrisma({ count: 1 });

    const result = await registerForEvent(prisma, { eventId, participantId });

    expect($transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: "ReadCommitted" });
    expect(calls[0]).toMatch(/^exec:SET LOCAL lock_timeout/);
    expect(calls[1]).toMatch(/FROM "events"\s+WHERE "id" = \?::uuid\s+FOR UPDATE/);
    expect(calls.slice(2)).toEqual(["findUnique", "count", "create"]);
    expect(tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual([eventId]); // parameterized, not interpolated
    expect(tx.registration.create).toHaveBeenCalledWith(expect.objectContaining({ data: { eventId, participantId } }));
    expect(result).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      registeredAt: "2026-11-14T00:00:00.000Z",
      event: { id: eventId, title: "Workshop", description: "Intro", startsAt: "2026-11-15T02:00:00.000Z", location: "Hall A", capacity: 2 },
    });
  });

  it("throws NOT_FOUND without touching registrations when the event row is missing", async () => {
    const { prisma, calls } = makePrisma({ event: [] });
    await expect(registerForEvent(prisma, { eventId, participantId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.some(call => ["findUnique", "count", "create"].includes(call))).toBe(false);
  });

  it("reports ALREADY_REGISTERED before EVENT_FULL when both apply", async () => {
    const { prisma, calls } = makePrisma({ existing: { id: "existing" }, count: 2 });
    const error = await registerForEvent(prisma, { eventId, participantId }).catch(e => e);
    expect(error).toBeInstanceOf(RegistrationError);
    expect(error.code).toBe("ALREADY_REGISTERED");
    expect(calls).not.toContain("count");
    expect(calls).not.toContain("create");
  });

  it("throws EVENT_FULL when the post-lock count reaches capacity", async () => {
    const { prisma, calls } = makePrisma({ count: 2 });
    await expect(registerForEvent(prisma, { eventId, participantId })).rejects.toMatchObject({ code: "EVENT_FULL" });
    expect(calls).not.toContain("create");
  });

  it("maps only the (eventId, participantId) unique violation to ALREADY_REGISTERED", async () => {
    const duplicate = knownError("P2002", { kind: "UniqueConstraintViolation", constraint: { index: "registrations_eventId_participantId_key" } });
    await expect(registerForEvent(makePrisma({ createError: duplicate }).prisma, { eventId, participantId })).rejects.toMatchObject({ code: "ALREADY_REGISTERED" });

    const otherUnique = knownError("P2002", { kind: "UniqueConstraintViolation", constraint: { index: "registrations_pkey" } });
    await expect(registerForEvent(makePrisma({ createError: otherUnique }).prisma, { eventId, participantId })).rejects.toBe(otherUnique);
  });

  it("maps a lock timeout to TEMPORARILY_UNAVAILABLE and never disguises unknown errors", async () => {
    const lockTimeout = knownError("P2010", { originalCode: "55P03", kind: "postgres" });
    await expect(registerForEvent(makePrisma({ createError: lockTimeout }).prisma, { eventId, participantId })).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });

    const unexpected = new Error("boom");
    await expect(registerForEvent(makePrisma({ createError: unexpected }).prisma, { eventId, participantId })).rejects.toBe(unexpected);
  });
});

describe("error classifiers", () => {
  it("does not treat foreign-key or check violations as duplicates", () => {
    expect(isDuplicateRegistrationViolation(knownError("P2003", { kind: "ForeignKeyConstraintViolation" }))).toBe(false);
    expect(isDuplicateRegistrationViolation(new Error("duplicate"))).toBe(false);
    expect(isTransientDatabaseError(knownError("P2003"))).toBe(false);
    expect(isTransientDatabaseError(knownError("P2024"))).toBe(true);
  });
});

describe("listMyRegistrations", () => {
  it("scopes by participant and orders registeredAt DESC, id DESC", async () => {
    const findMany = vi.fn(async () => [{ id: "r1", registeredAt: new Date("2026-11-14T00:00:00Z"), event: lockedEvent }]);
    const prisma = { registration: { findMany } } as unknown as PrismaClient;

    const result = await listMyRegistrations(prisma, participantId);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { participantId },
      orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
    }));
    expect(result[0]).toEqual({ id: "r1", registeredAt: "2026-11-14T00:00:00.000Z", event: expect.objectContaining({ id: eventId, startsAt: "2026-11-15T02:00:00.000Z" }) });
  });
});
