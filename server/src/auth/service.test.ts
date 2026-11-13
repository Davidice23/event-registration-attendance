import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createSession,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  revokeSession,
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

  describe("database error and transaction consistency", () => {
    it("executes session replacement atomically inside $transaction", async () => {
      const mockTx = {
        session: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({}),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
          return await callback(mockTx);
        }),
      } as unknown as PrismaClient;

      const priorToken = "prior-token-123";
      const result = await createSession(mockPrisma, "user-id-1", priorToken);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.session.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockTx.session.create).toHaveBeenCalledTimes(1);
      expect(result.token).toHaveLength(64);
    });

    it("propagates error when transaction fails during session replacement", async () => {
      const dbError = new Error("Connection lost during transaction");
      const mockPrisma = {
        $transaction: vi.fn().mockRejectedValue(dbError),
      } as unknown as PrismaClient;

      await expect(createSession(mockPrisma, "user-id-1", "prior-token-123")).rejects.toThrow(
        "Connection lost during transaction",
      );
    });

    it("propagates error when database fails during session revocation (logout)", async () => {
      const dbError = new Error("Database disk full");
      const mockPrisma = {
        session: {
          deleteMany: vi.fn().mockRejectedValue(dbError),
        },
      } as unknown as PrismaClient;

      await expect(revokeSession(mockPrisma, "some-token")).rejects.toThrow(
        "Database disk full",
      );
    });
  });
});
