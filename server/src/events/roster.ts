import type { PrismaClient } from "../generated/prisma/client.js";

export interface OrganizerRosterEntry {
  registrationId: string;
  participantDisplayName: string;
  registeredAt: string;
}

/**
 * Lists only registrations for an event owned by the authenticated organizer.
 * The ownership predicate is part of the first lookup so a missing event and an
 * event owned by somebody else are indistinguishable to the caller.
 */
export async function listOrganizerRoster(
  prisma: PrismaClient,
  eventId: string,
  organizerId: string,
): Promise<OrganizerRosterEntry[] | null> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizerId },
    select: { id: true },
  });
  if (!event) return null;

  const registrations = await prisma.registration.findMany({
    where: { eventId: event.id },
    orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      registeredAt: true,
      participant: { select: { displayName: true } },
    },
  });

  return registrations.map(registration => ({
    registrationId: registration.id,
    participantDisplayName: registration.participant.displayName,
    registeredAt: registration.registeredAt.toISOString(),
  }));
}
