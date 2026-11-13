import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrganizerRoster } from "./roster";

const EVENT_ID = "0b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b";

afterEach(() => vi.unstubAllGlobals());

describe("getOrganizerRoster", () => {
  it("reads the owner roster through the session-authenticated endpoint", async () => {
    const roster = [{ registrationId: "r1", participantDisplayName: "Participant A", registeredAt: "2026-11-14T03:00:00.000Z" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: roster }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrganizerRoster(EVENT_ID)).resolves.toEqual(roster);
    expect(fetchMock).toHaveBeenCalledWith(`/api/organizer/events/${EVENT_ID}/registrations`);
  });

  it("surfaces safe API errors without changing the request method or sending identity fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Event not found." } }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrganizerRoster(EVENT_ID)).rejects.toMatchObject({ name: "AuthApiError", code: "NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/organizer/events/${EVENT_ID}/registrations`);
  });
});
