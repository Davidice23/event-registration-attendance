import { afterEach, describe, expect, it, vi } from "vitest";
import { publishEvent } from "./events";

afterEach(() => vi.unstubAllGlobals());

describe("publishEvent validation errors", () => {
  it("preserves server field details for the organizer form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          code: "VALIDATION_ERROR",
          message: "Event details are invalid.",
          fields: { startsAt: "Must be at least 24 hours after the current server time." },
        },
      }),
    } as Response));

    await expect(publishEvent({
      title: "Workshop",
      description: "Intro",
      startsAt: "2026-11-29T12:00:00.000Z",
      location: "Hall A",
      capacity: 1,
    })).rejects.toMatchObject({
      name: "AuthApiError",
      code: "VALIDATION_ERROR",
      fields: { startsAt: "Must be at least 24 hours after the current server time." },
    });
  });
});
