import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dbCommand = fileURLToPath(new URL("./db-command.mjs", import.meta.url));
const integrationRunner = fileURLToPath(new URL("./run-integration-tests.mjs", import.meta.url));
const seedScript = fileURLToPath(new URL("./seed-local.ts", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const devUrl = "postgresql://event_app:local-only-change-me@127.0.0.1:5433/event_registration_dev?schema=public";
const testUrl = "postgresql://event_app:local-only-change-me@127.0.0.1:5434/event_registration_test?schema=public";

function runNode(script, args = [], overrides = {}) {
  const env = { ...process.env };
  for (const key of ["DATABASE_URL", "TEST_DATABASE_URL", "ALLOW_TEST_DB_RESET", "ALLOW_DEMO_SEED", "DEMO_SEED_PASSWORD"]) delete env[key];
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [script, ...args], {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
  });
}

test("database commands fail closed when URLs are missing", () => {
  const result = runNode(dbCommand, ["dev", "migrate", "deploy"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.match(result.stderr, /no database command was run/);
});

test("database commands reject remote URLs before invoking Prisma", () => {
  const result = runNode(dbCommand, ["dev", "migrate", "deploy"], {
    DATABASE_URL: "postgresql://event_app:placeholder@db.example.com:5433/event_registration_dev",
    TEST_DATABASE_URL: testUrl,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must point to loopback/);
});

test("test reset requires an explicit destructive-operation flag", () => {
  const result = runNode(dbCommand, ["test", "reset"], {
    DATABASE_URL: devUrl,
    TEST_DATABASE_URL: testUrl,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /reset is destructive/);
});

test("test reset rejects a non-configured local database port", () => {
  const result = runNode(dbCommand, ["test", "reset"], {
    DATABASE_URL: devUrl,
    TEST_DATABASE_URL: "postgresql://event_app:placeholder@127.0.0.1:5433/event_registration_test",
    ALLOW_TEST_DB_RESET: "1",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /configured local port 5434/);
});

test("integration runner refuses a missing test URL before running commands", () => {
  const result = runNode(integrationRunner, [], { DATABASE_URL: devUrl });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TEST_DATABASE_URL is required/);
  assert.match(result.stderr, /no command was run/);
});

test("seed refuses missing configuration before loading the hasher or connecting", () => {
  const result = runNode(tsxCli, [seedScript]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.match(result.stderr, /no data was written/);
});

test(".env.example documents every environment variable the code reads", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const sources = ["server/src", "client/src", "scripts", "e2e", "playwright.config.ts", "prisma.config.ts", "client/vite.config.ts"];
  const skip = new Set(["node_modules", "generated", "dist"]);
  const files = [];
  const walk = (entry) => {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)) if (!skip.has(name)) walk(path.join(entry, name));
    } else if (/\.(ts|tsx|mjs)$/.test(full) && !/\.test\.(ts|tsx|mjs)$/.test(full)) {
      files.push(full);
    }
  };
  sources.forEach(walk);

  // Set by the tools themselves, not by the project.
  const builtIn = new Set(["DEV", "npm_execpath"]);
  const used = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(match[1]);
    for (const match of text.matchAll(/\benv\("([A-Z_][A-Z0-9_]*)"\)/g)) used.add(match[1]);
  }
  const documented = new Set([...readFileSync(path.join(root, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map(m => m[1]));
  const missing = [...used].filter(name => !builtIn.has(name) && !documented.has(name)).sort();
  assert.ok(used.has("DATABASE_URL"), "scanner found no variables; the source paths are wrong");
  assert.deepEqual(missing, [], `Add these to .env.example: ${missing.join(", ")}`);
});
