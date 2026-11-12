import { describe, expect, it } from "vitest";
import { validateCreateEvent } from "./service.js";

const valid = { title: "  Workshop  ", description: " Intro ", startsAt: "2026-11-15T09:00:00+07:00", location: " Hall A ", capacity: 1 };

describe("F-02 event input validation", () => {
  it("trims bounded strings, accepts capacity one and preserves offset timestamp", () => {
    expect(validateCreateEvent(valid).value).toEqual({ title: "Workshop", description: "Intro", startsAt: valid.startsAt, location: "Hall A", capacity: 1 });
  });

  it.each([0, -1, 1.5, "1", 2_147_483_648])("rejects invalid capacity %s", capacity => {
    expect(validateCreateEvent({ ...valid, capacity }).fields).toHaveProperty("capacity");
  });

  it.each(["2026-02-30T10:00:00Z", "2026-11-15T09:00:00", "not-a-date", "2026-11-15T25:00:00Z"]) (
    "rejects invalid or offset-less startsAt %s", startsAt => {
      expect(validateCreateEvent({ ...valid, startsAt }).fields).toHaveProperty("startsAt");
    });

  it("rejects unknown owner fields and invalid text lengths", () => {
    expect(validateCreateEvent({ ...valid, organizerId: "spoof" }).fields).toHaveProperty("organizerId");
    expect(validateCreateEvent({ ...valid, title: "  " }).fields).toHaveProperty("title");
    expect(validateCreateEvent({ ...valid, title: "x".repeat(121) }).fields).toHaveProperty("title");
  });
});
