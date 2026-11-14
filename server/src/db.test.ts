import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "./db.js";

describe("createPrismaClient local database guard", () => {
  const clients: ReturnType<typeof createPrismaClient>[] = [];
  const savedDatabaseUrl = process.env.DATABASE_URL;

  // createPrismaClient() falls back to process.env.DATABASE_URL. CI sets it for the whole
  // job, so isolate these tests from the shell instead of depending on it being unset.
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  it("refuses missing, malformed, remote, wrong-name, and wrong-port URLs", () => {
    expect(() => createPrismaClient(undefined)).toThrow(/DATABASE_URL is required/);
    expect(() => createPrismaClient("not-a-url")).toThrow(/valid local PostgreSQL URL/);
    expect(() => createPrismaClient("postgresql://event_app:local@db.example.com:5433/event_registration_dev")).toThrow(/Only loopback/);
    expect(() => createPrismaClient("postgresql://event_app:local@127.0.0.1:5433/other_database")).toThrow(/configured local/);
    expect(() => createPrismaClient("postgresql://event_app:local@127.0.0.1:5432/event_registration_dev")).toThrow(/configured local/);
  });

  it("constructs a client for the dedicated local test database without connecting", async () => {
    const client = createPrismaClient("postgresql://event_app:local-only-change-me@127.0.0.1:5434/event_registration_test?schema=public");
    clients.push(client);
    expect(client).toBeDefined();
  });
});
