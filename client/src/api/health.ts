export type HealthResponse = { data: { status: "ok" } };

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const data = value.data;
  return typeof data === "object" && data !== null && "status" in data && data.status === "ok";
}
