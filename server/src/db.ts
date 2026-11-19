import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

/**
 * By default only the two local loopback databases are accepted, so a mistyped URL can never
 * reach a shared database from a laptop or a test run. Deployed environments (Cloud Run with
 * Cloud SQL, Docker Compose) opt in explicitly with ALLOW_NON_LOCAL_DATABASE=1.
 */
export function createPrismaClient(
  connectionString = process.env.DATABASE_URL,
  allowNonLocal = process.env.ALLOW_NON_LOCAL_DATABASE === "1",
) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required before creating a database client.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid local PostgreSQL URL.");
  }

  if (allowNonLocal) {
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      throw new Error("DATABASE_URL must use PostgreSQL.");
    }
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const localTargets = new Map([
    ["event_registration_dev", "5433"],
    ["event_registration_test", "5434"],
  ]);
  const expectedPort = localTargets.get(database);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("Only loopback databases are permitted by this scaffold.");
  }
  if (!expectedPort || url.port !== expectedPort || url.username !== "event_app") {
    throw new Error("DATABASE_URL must target the configured local event_app development or test database.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
