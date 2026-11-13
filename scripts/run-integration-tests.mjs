import "dotenv/config";
import { runNpm } from "./npm.mjs";

function fail(message) {
  console.error(`Integration test safety check failed: ${message}`);
  process.exit(2);
}

function parseLocal(value, name, expected, expectedPort) {
  if (!value) fail(`${name} is required; no command was run.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid PostgreSQL URL; no command was run.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!new Set(["postgresql:", "postgres:"]).has(url.protocol)) fail(`${name} must use PostgreSQL.`);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname.toLowerCase())) fail(`${name} must point to loopback.`);
  if (database !== expected) fail(`${name} must target exactly ${expected}.`);
  if (url.port !== String(expectedPort)) fail(`${name} must use the configured local port ${expectedPort}.`);
  return url;
}

const dev = parseLocal(process.env.DATABASE_URL, "DATABASE_URL", "event_registration_dev", 5433);
const test = parseLocal(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL", "event_registration_test", 5434);
if (dev.href === test.href || (dev.hostname === test.hostname && dev.port === test.port && dev.pathname === test.pathname)) {
  fail("TEST_DATABASE_URL must be distinct from DATABASE_URL.");
}

const env = { ...process.env, DATABASE_URL: test.href };

for (const args of [
  ["exec", "--", "prisma", "migrate", "deploy"],
  ["run", "test:integration", "--workspace", "server"],
]) {
  const result = runNpm(args, {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`Unable to run integration command: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
