import type { PrismaClient } from "../generated/prisma/client.js";

export interface EventSummary {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  location: string;
  capacity: number;
}

export interface CreateEventInput {
  title: string;
  description: string;
  startsAt: string;
  location: string;
  capacity: number;
}

export interface ValidationResult {
  value?: CreateEventInput;
  fields?: Record<string, string>;
}

const EXPECTED_KEYS = ["capacity", "description", "location", "startsAt", "title"];
const RFC3339_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function isValidOffsetDateTime(value: string): boolean {
  const match = RFC3339_WITH_OFFSET.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, offset] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const h = Number(hour), min = Number(minute), sec = Number(second);
  const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[m - 1] ?? 0;
  if (m < 1 || m > 12 || d < 1 || d > maxDay || h > 23 || min > 59 || sec > 59) return false;
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

export function validateCreateEvent(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { fields: { body: "Request body must be a JSON object." } };
  }

  const input = body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!EXPECTED_KEYS.includes(key)) fields[key] = "Unexpected field.";
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in input)) fields[key] = "Required field.";
  }

  const boundedText = (key: "title" | "description" | "location", max: number) => {
    const value = input[key];
    if (typeof value !== "string") {
      fields[key] = "Must be a string.";
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > max) fields[key] = `Must contain 1 to ${max} characters.`;
    return trimmed;
  };

  const title = boundedText("title", 120);
  const description = boundedText("description", 1000);
  const location = boundedText("location", 160);
  const startsAt = input.startsAt;
  if (typeof startsAt !== "string" || !isValidOffsetDateTime(startsAt)) {
    fields.startsAt = "Must be a valid ISO 8601 date-time with an explicit offset or Z.";
  }
  const capacity = input.capacity;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 2_147_483_647) {
    fields.capacity = "Must be an integer from 1 to 2147483647.";
  }

  if (Object.keys(fields).length > 0 || typeof startsAt !== "string" || typeof capacity !== "number") {
    return { fields };
  }
  return { value: { title, description, startsAt, location, capacity } };
}

function toEventSummary(event: { id: string; title: string; description: string; startsAt: Date; location: string; capacity: number }): EventSummary {
  return { id: event.id, title: event.title, description: event.description, startsAt: event.startsAt.toISOString(), location: event.location, capacity: event.capacity };
}

export async function createPublishedEvent(prisma: PrismaClient, organizerId: string, input: CreateEventInput): Promise<EventSummary> {
  const event = await prisma.event.create({
    data: { ...input, startsAt: new Date(input.startsAt), organizerId },
    select: { id: true, title: true, description: true, startsAt: true, location: true, capacity: true },
  });
  return toEventSummary(event);
}

export async function listPublishedEvents(prisma: PrismaClient): Promise<EventSummary[]> {
  const events = await prisma.event.findMany({
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, description: true, startsAt: true, location: true, capacity: true },
  });
  return events.map(toEventSummary);
}

export async function listOrganizerEvents(prisma: PrismaClient, organizerId: string): Promise<EventSummary[]> {
  const events = await prisma.event.findMany({
    where: { organizerId },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, description: true, startsAt: true, location: true, capacity: true },
  });
  return events.map(toEventSummary);
}
