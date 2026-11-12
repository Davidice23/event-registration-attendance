import "dotenv/config";
import { runNpm } from "./npm.mjs";

function fail(message) {
  console.error(`Database safety check failed: ${message}`);
  process.exit(2);
}

function parseLocalDatabase(value, variableName, expectedDatabase, expectedPort) {
  if (!value) fail(`${variableName} is required; no database command was run.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${variableName} is not a valid PostgreSQL URL; no database command was run.`);
  }

  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!new Set(["postgresql:", "postgres:"]).has(url.protocol)) {
    fail(`${variableName} must use PostgreSQL; no database command was run.`);
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) {
    fail(`${variableName} must point to loopback; remote databases are refused.`);
  }
  if (database !== expectedDatabase) {
    fail(`${variableName} must target exactly ${expectedDatabase}; no database command was run.`);
  }
  if (url.port !== String(expectedPort)) {
    fail(`${variableName} must use the configured local port ${expectedPort}; no database command was run.`);
  }
  return { url, database };
}

const [target, action, subcommand] = process.argv.slice(2);
if (!new Set(["dev", "test"]).has(target)) {
  fail("usage: node scripts/db-command.mjs <dev|test> <migrate deploy|reset>");
}

const dev = parseLocalDatabase(process.env.DATABASE_URL, "DATABASE_URL", "event_registration_dev", 5433);
const test = parseLocalDatabase(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL", "event_registration_test", 5434);
if (dev.url.href === test.url.href || (dev.url.hostname === test.url.hostname && dev.url.port === test.url.port && dev.database === test.database)) {
  fail("TEST_DATABASE_URL must be distinct from DATABASE_URL.");
}

const selected = target === "test" ? test : dev;
let prismaArgs;
if (action === "migrate" && subcommand === "deploy") {
  prismaArgs = ["migrate", "deploy"];
} else if (action === "reset" && target === "test" && !subcommand) {
  if (process.env.ALLOW_TEST_DB_RESET !== "1") {
    fail("reset is destructive. Set ALLOW_TEST_DB_RESET=1 explicitly to reset the dedicated test database.");
  }
  prismaArgs = ["migrate", "reset", "--force", "--skip-seed"];
} else {
  fail("only migrate deploy is allowed for dev/test; reset is allowed only for the test database.");
}

const env = { ...process.env, DATABASE_URL: selected.url.href };
const result = runNpm(["exec", "--", "prisma", ...prismaArgs], {
  stdio: "inherit",
  env,
});
if (result.error) {
  console.error(`Unable to run the guarded database command: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
