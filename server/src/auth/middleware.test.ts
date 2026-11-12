import { describe, expect, it } from "vitest";
import { isJsonContentType } from "./middleware.js";

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
