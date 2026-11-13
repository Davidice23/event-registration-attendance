import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { EventSummary } from "../events/service.js";
import { RegistrationError } from "./errors.js";

export interface MyRegistration {
  id: string;
  registeredAt: string;
  event: EventSummary;
}

export interface RegisterForEventInput {
  eventId: string;
  participantId: string;
}

/** Upper bound a request may wait for the event row lock before PostgreSQL aborts it (55P03). */
export const EVENT_LOCK_TIMEOUT_MS = 5_000;

const UNIQUE_REGISTRATION_CONSTRAINT = "registrations_eventId_participantId_key";

type LockedEventRow = {
  id: string;
  title: string;
  description: string;
  startsAt: Date;
  location: string;
  capacity: number;
};

const eventSummarySelect = { id: true, title: true, description: true, startsAt: true, location: true, capacity: true } as const;

function toEventSummary(event: LockedEventRow): EventSummary {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    location: event.location,
    capacity: Number(event.capacity),
  };
}

function toMyRegistration(registration: { id: string; registeredAt: Date }, event: LockedEventRow): MyRegistration {
  return { id: registration.id, registeredAt: registration.registeredAt.toISOString(), event: toEventSummary(event) };
}

/** The driver-adapter cause attached by @prisma/adapter-pg (`meta.driverAdapterError.cause`). */
function driverCause(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const adapterError = error.meta?.driverAdapterError as { cause?: Record<string, unknown> } | undefined;
  return adapterError?.cause;
}

/**
 * True only for a unique violation of registrations(eventId, participantId).
 * Other constraints or database failures are never reported as ALREADY_REGISTERED (contract §1).
 */
export function isDuplicateRegistrationViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const constraint = driverCause(error)?.constraint as { index?: unknown; fields?: unknown } | undefined;
  if (constraint?.index === UNIQUE_REGISTRATION_CONSTRAINT) return true;
  const fields = constraint?.fields ?? error.meta?.target;
  return Array.isArray(fields) && fields.length === 2 && fields.includes("eventId") && fields.includes("participantId");
}

/** Lock wait timeout (55P03), lost connection, pool exhaustion or interactive-transaction expiry. */
export function isTransientDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"].includes(error.code)) return true;
  const cause = driverCause(error);
  return cause?.originalCode === "55P03" || cause?.kind === "DatabaseNotReachable" || cause?.kind === "SocketTimeout";
}

/**
 * Registers the session participant for an event (F-03).
 *
 * Transaction order (contract F-03 / SDS §2):
 * READ COMMITTED → lock the event row with parameterized `SELECT … FOR UPDATE` → 404 if missing →
 * duplicate check → separate COUNT after the lock → EVENT_FULL if full → insert → commit.
 * The lock serialises every registration for the same event, so two requests for the last seat
 * cannot both observe a free seat.
 */
export async function registerForEvent(prisma: PrismaClient, { eventId, participantId }: RegisterForEventInput): Promise<MyRegistration> {
  try {
    return await prisma.$transaction(
      async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${EVENT_LOCK_TIMEOUT_MS}ms'`);

        const locked = await tx.$queryRaw<LockedEventRow[]>`
          SELECT "id", "title", "description", "startsAt", "location", "capacity"
          FROM "events"
          WHERE "id" = ${eventId}::uuid
          FOR UPDATE`;
        const event = locked[0];
        if (!event) throw new RegistrationError("NOT_FOUND", "Event not found.");

        const existing = await tx.registration.findUnique({
          where: { eventId_participantId: { eventId, participantId } },
          select: { id: true },
        });
        if (existing) throw new RegistrationError("ALREADY_REGISTERED", "You are already registered for this event.");

        const registered = await tx.registration.count({ where: { eventId } });
        if (registered >= event.capacity) throw new RegistrationError("EVENT_FULL", "This event is full.");

        const registration = await tx.registration.create({
          data: { eventId, participantId },
          select: { id: true, registeredAt: true },
        });
        return toMyRegistration(registration, event);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: EVENT_LOCK_TIMEOUT_MS,
        timeout: EVENT_LOCK_TIMEOUT_MS * 2,
      },
    );
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    // The interactive transaction has already been rolled back when its callback rejects.
    if (isDuplicateRegistrationViolation(error)) {
      throw new RegistrationError("ALREADY_REGISTERED", "You are already registered for this event.");
    }
    if (isTransientDatabaseError(error)) {
      throw new RegistrationError("TEMPORARILY_UNAVAILABLE", "Registration is temporarily unavailable. Check My Registrations before retrying.");
    }
    throw error;
  }
}

/** Returns only the session owner's registrations, newest first (registeredAt DESC, id DESC). */
export async function listMyRegistrations(prisma: PrismaClient, participantId: string): Promise<MyRegistration[]> {
  const rows = await prisma.registration.findMany({
    where: { participantId },
    orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
    select: { id: true, registeredAt: true, event: { select: eventSummarySelect } },
  });
  return rows.map(row => toMyRegistration(row, row.event));
}
