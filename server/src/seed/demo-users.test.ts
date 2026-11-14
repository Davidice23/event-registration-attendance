import { describe, expect, it, vi } from "vitest";
import { DEMO_USERS, readSeedConfig, seedDemoUsers } from "./demo-users.js";

describe("readSeedConfig", () => {
  it("requires the explicit opt-in flag", () => {
    expect(() => readSeedConfig({ DEMO_SEED_PASSWORD: "long-enough-placeholder" })).toThrow(/ALLOW_DEMO_SEED=1/);
  });

  it("requires a password of at least 12 characters and never echoes it", () => {
    for (const DEMO_SEED_PASSWORD of [undefined, "", "short-pass"]) {
      try {
        readSeedConfig({ ALLOW_DEMO_SEED: "1", DEMO_SEED_PASSWORD });
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toMatch(/at least 12 characters/);
        if (DEMO_SEED_PASSWORD) expect((error as Error).message).not.toContain(DEMO_SEED_PASSWORD);
      }
    }
  });

  it("returns the password when configured", () => {
    expect(readSeedConfig({ ALLOW_DEMO_SEED: "1", DEMO_SEED_PASSWORD: "long-enough-placeholder" })).toEqual({ password: "long-enough-placeholder" });
  });
});

describe("seedDemoUsers", () => {
  it("creates one account per role and owner on an empty database", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null), create } };
    await expect(seedDemoUsers(prisma as never, "hash")).resolves.toBe(DEMO_USERS.length);
    expect(create.mock.calls.map(([args]) => args.data.role).sort()).toEqual(["ORGANIZER", "ORGANIZER", "PARTICIPANT", "PARTICIPANT"]);
    expect(create.mock.calls.every(([args]) => args.data.passwordHash === "hash")).toBe(true);
  });

  it("is safe to rerun: existing accounts are left untouched", async () => {
    const create = vi.fn();
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ id: "existing" }), create } };
    await expect(seedDemoUsers(prisma as never, "new-hash")).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
