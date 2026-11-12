import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "./db.js";
import type { PrismaClient } from "./generated/prisma/client.js";

describe("Prisma/PostgreSQL integration smoke test", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("Guarded runner must provide the test DATABASE_URL.");
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it("connects to PostgreSQL and executes a read-only query", async () => {
    const result = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 AS result`;
    expect(result).toHaveLength(1);
    expect(Number(result[0]?.result)).toBe(1);
  });
});
