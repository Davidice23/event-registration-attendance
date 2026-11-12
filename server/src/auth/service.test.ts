import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  SESSION_DURATION_MS,
  verifyPassword,
} from "./service.js";

describe("auth/service unit tests", () => {
  it("hashes password with Argon2id and verifies correctly", async () => {
    const rawPassword = "complex-password-12345";
    const hash = await hashPassword(rawPassword);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, rawPassword)).toBe(true);
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("generates 32-byte (64 hex character) random session token", () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it("hashes session token with SHA-256 (64 hex characters)", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).toHaveLength(64);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it("has absolute session lifetime of 8 hours", () => {
    expect(SESSION_DURATION_MS).toBe(8 * 60 * 60 * 1000);
  });
});
