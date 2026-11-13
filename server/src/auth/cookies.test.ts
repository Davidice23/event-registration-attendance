import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  parseCookies,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from "./cookies.js";

describe("auth/cookies", () => {
  it("parses empty or missing cookie header into empty object", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("   ")).toEqual({});
  });

  it("parses multiple cookies correctly", () => {
    const header = "sid=abc123xyz; other=value%201; theme=dark";
    const cookies = parseCookies(header);
    expect(cookies[SESSION_COOKIE_NAME]).toBe("abc123xyz");
    expect(cookies["other"]).toBe("value 1");
    expect(cookies["theme"]).toBe("dark");
  });

  it("serializes session cookie with expected contract flags", () => {
    const cookie = serializeSessionCookie("test-token-123", { secure: false });
    expect(cookie).toContain("sid=test-token-123");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=28800"); // 8 hours = 28800 seconds
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure flag when secure option is true", () => {
    const cookie = serializeSessionCookie("test-token-123", { secure: true });
    expect(cookie).toContain("Secure");
  });

  it("clears session cookie with expired date and Max-Age=0", () => {
    const cookie = clearSessionCookie({ secure: false });
    expect(cookie).toContain("sid=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});
