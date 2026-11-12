import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, fetchCurrentUser, login, logout } from "./auth";

describe("client/src/api/auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("login()", () => {
    it("returns CurrentUser DTO when API responds 200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "uuid-organizer-1",
            displayName: "Organizer A",
            role: "ORGANIZER",
          },
        }),
      } as Response);

      const user = await login({ email: "organizer-a@example.test", password: "password123" });
      expect(user).toEqual({
        id: "uuid-organizer-1",
        displayName: "Organizer A",
        role: "ORGANIZER",
      });
    });

    it("throws AuthApiError with error code and message on 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password.",
          },
        }),
      } as Response);

      await expect(login({ email: "wrong@example.test", password: "bad" })).rejects.toThrow(
        AuthApiError,
      );
    });
  });

  describe("fetchCurrentUser()", () => {
    it("returns CurrentUser when valid session exists", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "uuid-participant-1",
            displayName: "Participant A",
            role: "PARTICIPANT",
          },
        }),
      } as Response);

      const user = await fetchCurrentUser();
      expect(user).toEqual({
        id: "uuid-participant-1",
        displayName: "Participant A",
        role: "PARTICIPANT",
      });
    });

    it("returns null when session is unauthenticated (401)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const user = await fetchCurrentUser();
      expect(user).toBeNull();
    });

    it("returns null on network failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network offline"));

      const user = await fetchCurrentUser();
      expect(user).toBeNull();
    });
  });

  describe("logout()", () => {
    it("resolves without error on 204 No Content", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 204,
      } as Response);

      await expect(logout()).resolves.toBeUndefined();
    });

    it("throws AuthApiError when logout fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: "CSRF_REJECTED",
            message: "Cross-site request rejected.",
          },
        }),
      } as Response);

      await expect(logout()).rejects.toThrow(AuthApiError);
    });
  });
});
