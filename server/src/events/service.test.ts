import { describe, expect, it } from "vitest";
import { validateCreateEvent } from "./service.js";

const T = new Date("2026-11-15T00:00:00.000Z");
const validateAt = validateCreateEvent as unknown as (body: unknown, now: Date) => ReturnType<typeof validateCreateEvent>;
const valid = { title: "  Workshop  ", description: " Intro ", startsAt: "2026-11-17T09:00:00+07:00", location: " Hall A ", capacity: 1 };

describe("F-02 event input validation", () => {
  it("trims bounded strings, accepts capacity one and preserves offset timestamp", () => {
    expect(validateAt(valid, T).value).toEqual({ title: "Workshop", description: "Intro", startsAt: valid.startsAt, location: "Hall A", capacity: 1 });
  });

  it.each([0, -1, 1.5, "1", 2_147_483_648])("rejects invalid capacity %s", capacity => {
    expect(validateAt({ ...valid, capacity }, T).fields).toHaveProperty("capacity");
  });

  it.each(["2026-02-30T10:00:00Z", "2026-11-15T09:00:00", "not-a-date", "2026-11-15T25:00:00Z"]) (
    "rejects invalid or offset-less startsAt %s", startsAt => {
      expect(validateAt({ ...valid, startsAt }, T).fields).toHaveProperty("startsAt");
    });

  it("rejects unknown owner fields and invalid text lengths", () => {
    expect(validateAt({ ...valid, organizerId: "spoof" }, T).fields).toHaveProperty("organizerId");
    expect(validateAt({ ...valid, title: "  " }, T).fields).toHaveProperty("title");
    expect(validateAt({ ...valid, title: "x".repeat(121) }, T).fields).toHaveProperty("title");
  });

  it("T-05b / AC-13: enforces the exact 24-hour publication lead-time boundary", () => {
    const dateAt = (offsetMs: number) => new Date(T.getTime() + offsetMs).toISOString();
    const exactBoundary = validateAt({ ...valid, startsAt: dateAt(24 * 60 * 60 * 1000) }, T);
    const oneMillisecondEarly = validateAt({ ...valid, startsAt: dateAt(24 * 60 * 60 * 1000 - 1) }, T);
    const inThePast = validateAt({ ...valid, startsAt: dateAt(-1) }, T);
    const invalidFormat = validateAt({ ...valid, startsAt: "2026-11-15T09:00:00" }, T);

    expect({
      exactBoundaryAccepted: Boolean(exactBoundary.value),
      oneMillisecondEarlyMessage: oneMillisecondEarly.fields?.startsAt,
      pastMessage: inThePast.fields?.startsAt,
      invalidFormatMessage: invalidFormat.fields?.startsAt,
    }).toEqual({
      exactBoundaryAccepted: true,
      oneMillisecondEarlyMessage: "Must be at least 24 hours after the current server time.",
      pastMessage: "Must be at least 24 hours after the current server time.",
      invalidFormatMessage: "Must be a valid ISO 8601 date-time with an explicit offset or Z.",
    });
  });
});
