import { describe, expect, it } from "vitest";
import { createCsrfAndMediaGuard, isJsonContentType, parseAllowedOrigins } from "./middleware.js";

describe("auth/middleware Content-Type validation", () => {
  it("accepts valid JSON media types with or without parameters", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("APPLICATION/JSON; CHARSET=UTF-8")).toBe(true);
    expect(isJsonContentType("  application/json  ;  boundary=something  ")).toBe(true);
  });

  it("strictly rejects media types that merely start with application/json like application/jsonx", () => {
    expect(isJsonContentType("application/jsonx")).toBe(false);
    expect(isJsonContentType("application/json-patch+json")).toBe(false);
    expect(isJsonContentType("application/jsonxml")).toBe(false);
    expect(isJsonContentType("application/json5")).toBe(false);
  });

  it("rejects non-JSON or missing media types", () => {
    expect(isJsonContentType(undefined)).toBe(false);
    expect(isJsonContentType("")).toBe(false);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data")).toBe(false);
  });
});

describe("auth/middleware Origin allowlist (APP_ORIGIN)", () => {
  function run(appOrigin: string, origin: string | undefined) {
    const guard = createCsrfAndMediaGuard(appOrigin);
    let status = 0;
    let nextCalled = false;
    const req = { method: "POST", headers: { origin, "content-type": "application/json" } };
    const res = { status(code: number) { status = code; return { json: () => undefined }; } };
    guard(req as never, res as never, () => { nextCalled = true; });
    return nextCalled ? "allowed" : `rejected ${status}`;
  }

  const runA = "https://event-reg-123456789.asia-southeast1.run.app";
  const runB = "https://event-reg-abc123xyz-as.a.run.app";

  it("parses a comma-separated list and ignores blanks and spaces", () => {
    expect([...parseAllowedOrigins(` ${runA} , ${runB},, `)]).toEqual([runA, runB]);
  });

  it("allows each listed origin exactly and rejects everything else", () => {
    const appOrigin = `${runA},${runB}`;
    expect(run(appOrigin, runA)).toBe("allowed");
    expect(run(appOrigin, runB)).toBe("allowed");
    expect(run(appOrigin, undefined)).toBe("rejected 403");
    expect(run(appOrigin, "https://evil.example")).toBe("rejected 403");
    expect(run(appOrigin, `${runA}/`)).toBe("rejected 403");
    expect(run(appOrigin, runA.replace("https", "http"))).toBe("rejected 403");
    expect(run(appOrigin, "https://event-reg-123456789.asia-southeast1.run.app.evil.example")).toBe("rejected 403");
  });

  it("keeps the single-origin behaviour used locally", () => {
    expect(run("http://127.0.0.1:5173", "http://127.0.0.1:5173")).toBe("allowed");
    expect(run("http://127.0.0.1:5173", "http://localhost:5173")).toBe("rejected 403");
  });
});
