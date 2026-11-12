import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";

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
