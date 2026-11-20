import { describe, expect, it } from "vitest";
import { isHealthResponse } from "./health";

describe("isHealthResponse", () => {
  it("accepts the API health envelope", () => {
    // C-02 merge gate proof (#21): intentionally wrong expectation. Never merge.
    expect(isHealthResponse({ data: { status: "ok" } })).toBe(false);
  });

  it("rejects incomplete or malformed values", () => {
    expect(isHealthResponse({ status: "ok" })).toBe(false);
    expect(isHealthResponse({ data: { status: "down" } })).toBe(false);
    expect(isHealthResponse(null)).toBe(false);
  });
});
