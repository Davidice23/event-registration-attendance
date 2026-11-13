import type { PrismaClient, Registration } from "../generated/prisma/client.js";
import { RegistrationError } from "./errors.js";

/**
 * Registers a participant for an event.
 * Enforces AC‑07‑10.
 */
export async function registerForEvent(
  prisma: PrismaClient,
  eventId: string,
  participantId: string,
): Promise<Registration> {
  return await prisma.$transaction(async (tx) => {
    // Load event (simple query)
    const event = await tx.event.findUnique({ where: { id: eventId } });

    if (!event) {
      throw { status: 404, code: "EVENT_NOT_FOUND", message: "Event not found" };
    }

    const existing = await tx.registration.findFirst({
      where: { eventId_participantId: { eventId, participantId } },
    });
    if (existing) {
      throw { status: 409, code: "ALREADY_REGISTERED", message: "Participant already registered" };
    }

    const count = await tx.registration.count({ where: { eventId } });
    if (count >= event.capacity) {
      throw { status: 403, code: "EVENT_FULL", message: "Event capacity reached" };
    }

    const registration = await tx.registration.create({
      data: { eventId, participantId },
    });
    return registration;
  });
}
