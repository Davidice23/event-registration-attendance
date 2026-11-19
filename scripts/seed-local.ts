import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/src/generated/prisma/client.js";
import { DEMO_USERS, seedDemoUsers } from "../server/src/seed/demo-users.js";

function fail(message: string): never {
  console.error(`Seed safety check failed: ${message}`);
  process.exit(2);
}

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) fail("DATABASE_URL is required; no data was written.");

let url: URL;
try {
  url = new URL(rawUrl);
} catch {
  fail("DATABASE_URL is not a valid URL; no data was written.");
}

const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!new Set(["postgresql:", "postgres:"]).has(url.protocol)) fail("DATABASE_URL must use PostgreSQL.");
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname.toLowerCase())) fail("only a loopback database is permitted.");
if (database !== "event_registration_dev") fail("seed is allowed only for event_registration_dev.");
if (url.port !== "5433") fail("seed is allowed only on the configured development port 5433.");
if (process.env.ALLOW_DEMO_SEED !== "1") fail("set ALLOW_DEMO_SEED=1 explicitly to seed local demo accounts.");

const password = process.env.DEMO_SEED_PASSWORD;
if (!password || password.length < 12) fail("DEMO_SEED_PASSWORD must be at least 12 characters; no data was written.");

const { default: argon2 } = await import("argon2");
const adapter = new PrismaPg({ connectionString: url.href });
const prisma = new PrismaClient({ adapter });
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const created = await seedDemoUsers(prisma, passwordHash);
  console.log(`Ensured ${DEMO_USERS.length} synthetic demo users in the loopback development database (${created} created).`);
} catch {
  console.error("Seed failed. No connection details or password values were printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
