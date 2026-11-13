import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "./auth";
import { classifyRegisterError, registerForEvent, UnknownOutcomeError } from "./registrations";

const EVENT_ID = "0b8f6c2e-1d3a-4e5f-9a7b-2c4d6e8f0a1b";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("registerForEvent", () => {
  it("sends one POST with an empty JSON body and returns the registration", async () => {
    const registration = { id: "r1", registeredAt: "2026-11-14T01:00:00.000Z", event: { id: EVENT_ID } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: registration }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerForEvent(EVENT_ID)).resolves.toEqual(registration);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/events/${EVENT_ID}/registrations`);
    expect(init).toMatchObject({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  });

  it.each([
    [409, "ALREADY_REGISTERED"],
    [409, "EVENT_FULL"],
    [404, "NOT_FOUND"],
  ])("surfaces %i %s as a typed API error", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: "x" } })));
    await expect(registerForEvent(EVENT_ID)).rejects.toMatchObject({ name: "AuthApiError", code });
  });

  it("treats a network failure as an unknown outcome and does not retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(registerForEvent(EVENT_ID)).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 503 as an unknown outcome and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { error: { code: "TEMPORARILY_UNAVAILABLE", message: "x" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(registerForEvent(EVENT_ID)).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("classifyRegisterError", () => {
  it("keeps ALREADY_REGISTERED and EVENT_FULL distinct", () => {
    expect(classifyRegisterError(new AuthApiError("x", "ALREADY_REGISTERED"))).toEqual({ kind: "already-registered" });
    expect(classifyRegisterError(new AuthApiError("x", "EVENT_FULL"))).toEqual({ kind: "event-full" });
  });

  it("maps the remaining cases", () => {
    expect(classifyRegisterError(new AuthApiError("x", "NOT_FOUND"))).toEqual({ kind: "not-found" });
    expect(classifyRegisterError(new AuthApiError("x", "UNAUTHENTICATED"))).toEqual({ kind: "session-expired" });
    expect(classifyRegisterError(new AuthApiError("Bad input", "VALIDATION_ERROR"))).toEqual({ kind: "rejected", message: "Bad input" });
    expect(classifyRegisterError(new UnknownOutcomeError())).toEqual({ kind: "unknown" });
  });
});
