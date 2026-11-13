import { describe, expect, it, vi } from "vitest";
import { listOrganizerRoster } from "./roster.js";

const eventId = "0b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b";
const organizerId = "1b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b";

describe("F-04 organizer roster service", () => {
  it("scopes the existence check to the session owner, then selects only roster fields in stable order", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: eventId });
    const findMany = vi.fn().mockResolvedValue([
      { id: "2b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b", registeredAt: new Date("2026-11-14T03:00:00Z"), participant: { displayName: "Participant A" } },
    ]);
    const prisma = { event: { findFirst }, registration: { findMany } } as never;

    await expect(listOrganizerRoster(prisma, eventId, organizerId)).resolves.toEqual([
      { registrationId: "2b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b", participantDisplayName: "Participant A", registeredAt: "2026-11-14T03:00:00.000Z" },
    ]);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: eventId, organizerId }, select: { id: true } });
    expect(findMany).toHaveBeenCalledWith({
      where: { eventId },
      orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
      select: { id: true, registeredAt: true, participant: { select: { displayName: true } } },
    });
  });

  it("does not query registrations when the event is absent or not owned", async () => {
    const findMany = vi.fn();
    const prisma = { event: { findFirst: vi.fn().mockResolvedValue(null) }, registration: { findMany } } as never;

    await expect(listOrganizerRoster(prisma, eventId, organizerId)).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
