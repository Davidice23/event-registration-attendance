import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp, type AppOptions } from "./app.js";
import type { PrismaClient } from "./generated/prisma/client.js";

async function listen(options: AppOptions = {}): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(createApp(options));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server address.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/** Only `$queryRaw` is used by /api/ready; the routers just keep a reference to the client. */
function fakePrisma(queryRaw: () => Promise<unknown>): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe("GET /api/ready", () => {
  it("returns 200 when the database answers", async () => {
    const app = await listen({ prisma: fakePrisma(async () => [{ "?column?": 1 }]) });
    try {
      const response = await fetch(`${app.origin}/api/ready`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ data: { status: "ready" } });
    } finally {
      await app.close();
    }
  });

  it("returns 503 without internal details when the database query fails", async () => {
    const app = await listen({ prisma: fakePrisma(async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret"); }) });
    try {
      const response = await fetch(`${app.origin}/api/ready`);
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "The service is not ready." } });
      expect(text).not.toMatch(/ECONNREFUSED|secret|5432/);
    } finally {
      await app.close();
    }
  });

  it("returns 503 when no database client is configured", async () => {
    const app = await listen();
    try {
      expect((await fetch(`${app.origin}/api/ready`)).status).toBe(503);
    } finally {
      await app.close();
    }
  });
});

describe("serving the built client (CLIENT_DIST_DIR)", () => {
  let dist: string;
  let app: Awaited<ReturnType<typeof listen>>;

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "client-dist-"));
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=\"root\"></div>");
    writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1)");
    app = await listen({ clientDistDir: dist });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it("serves index.html for client routes and fingerprinted assets with long caching", async () => {
    for (const route of ["/", "/events", "/my/registrations"]) {
      const response = await fetch(`${app.origin}${route}`, { headers: { Accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toContain("<div id=\"root\">");
    }
    const asset = await fetch(`${app.origin}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("keeps unknown API routes as JSON 404 instead of the SPA page", async () => {
    const response = await fetch(`${app.origin}/api/does-not-exist`, { headers: { Accept: "text/html" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  it("refuses a directory without index.html", () => {
    expect(() => createApp({ clientDistDir: path.join(dist, "assets") })).toThrow(/index.html/);
  });
});

describe("GET /api/health", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server address.");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("returns the health payload without cacheable state", async () => {
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { status: "ok" } });
  });
});
