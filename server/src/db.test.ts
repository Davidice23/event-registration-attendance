import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "./db.js";

describe("createPrismaClient local database guard", () => {
  const clients: ReturnType<typeof createPrismaClient>[] = [];

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

  it("accepts a non-local PostgreSQL URL only with the explicit opt-in, and still requires PostgreSQL", () => {
    const cloudSql = "postgresql://event_app:placeholder@localhost/event_registration?host=/cloudsql/project:region:instance";
    expect(() => createPrismaClient(cloudSql, false)).toThrow(/configured local/);
    expect(() => createPrismaClient("postgresql://event_app:placeholder@db.example.com:5432/app", false)).toThrow(/Only loopback/);
    const client = createPrismaClient(cloudSql, true);
    clients.push(client);
    expect(client).toBeDefined();
    expect(() => createPrismaClient("mysql://user:placeholder@db.example.com:3306/app", true)).toThrow(/must use PostgreSQL/);
  });

  it("constructs a client for the dedicated local test database without connecting", async () => {
    const client = createPrismaClient("postgresql://event_app:local-only-change-me@127.0.0.1:5434/event_registration_test?schema=public");
    clients.push(client);
    expect(client).toBeDefined();
  });
});
