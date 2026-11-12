import { describe, expect, it } from "vitest";
import { isHealthResponse } from "./health";

describe("isHealthResponse", () => {
  it("accepts the API health envelope", () => {
    expect(isHealthResponse({ data: { status: "ok" } })).toBe(true);
  });

  it("rejects incomplete or malformed values", () => {
    expect(isHealthResponse({ status: "ok" })).toBe(false);
    expect(isHealthResponse({ data: { status: "down" } })).toBe(false);
    expect(isHealthResponse(null)).toBe(false);
  });
});
