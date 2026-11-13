// Vitest tests for the registration service using a fully mocked Prisma client
import { registerForEvent } from "./service";
import { RegistrationError } from "./errors";
import { describe, it, expect, vi } from "vitest";

// Minimal mock shape of Prisma client used by the service
type MockPrisma = {
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
  event: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  registration: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

const makeMockPrisma = (overrides?: Partial<MockPrisma>): MockPrisma => {
  const defaultMock: MockPrisma = {
    event: { findUnique: vi.fn() },
    registration: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (cb) => {
      // Provide a transaction object that proxies the same mocked methods
      const tx = {
        $queryRaw: vi.fn(),
        event: { findUnique: defaultMock.event.findUnique },
        registration: {
          findFirst: defaultMock.registration.findFirst,
          create: defaultMock.registration.create,
          count: defaultMock.registration.count,
        },
      } as any;
      // If overrides provide a custom $transaction we ignore here; this is the default.
      return await cb(tx);
    }),
  } as MockPrisma;
  // Apply any overrides (including a custom $transaction implementation)
  return { ...defaultMock, ...overrides } as MockPrisma;
};

describe("registerForEvent", () => {
  const userId = "user-1";
  const eventId = "event-1";

  it("registers successfully when event exists, not full, and user not already registered", async () => {
    const prisma = makeMockPrisma();
    prisma.event.findUnique.mockResolvedValue({ id: eventId, capacity: 10 });
    prisma.registration.findFirst.mockResolvedValue(null);
    prisma.registration.count.mockResolvedValue(5);
    prisma.registration.create.mockResolvedValue({ id: "reg-1", eventId, userId });

    const result = await registerForEvent(prisma as any, { eventId, userId });
    expect(result).toEqual({ id: "reg-1", eventId, userId });
    expect(prisma.registration.create).toHaveBeenCalled();
  });

  it("throws 404 when the event does not exist", async () => {
    const prisma = makeMockPrisma();
    prisma.event.findUnique.mockResolvedValue(null);

    await expect(registerForEvent(prisma as any, { eventId, userId })).rejects.toMatchObject({
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  });

  it("throws 409 when the user is already registered", async () => {
    const prisma = makeMockPrisma();
    prisma.event.findUnique.mockResolvedValue({ id: eventId, capacity: 10 });
    prisma.registration.findFirst.mockResolvedValue({ id: "reg-existing" });

    await expect(registerForEvent(prisma as any, { eventId, userId })).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_REGISTERED",
    });
  });

  it("throws 403 when the event is at capacity", async () => {
    const prisma = makeMockPrisma();
    prisma.event.findUnique.mockResolvedValue({ id: eventId, capacity: 2 });
    prisma.registration.findFirst.mockResolvedValue(null);
    prisma.registration.count.mockResolvedValue(2);

    await expect(registerForEvent(prisma as any, { eventId, userId })).rejects.toMatchObject({
      status: 403,
      code: "EVENT_FULL",
    });
  });
});
