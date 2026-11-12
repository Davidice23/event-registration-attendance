import { runNpm } from "./npm.mjs";

const [command] = process.argv.slice(2);
if (!new Set(["generate", "validate"]).has(command)) {
  console.error("Usage: node scripts/prisma-local.mjs <generate|validate>");
  process.exit(2);
}

// These Prisma commands only process the checked-in schema. Give the CLI a
// deliberately non-routable local placeholder so it cannot use an inherited
// runtime/production DATABASE_URL by accident.
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://schema-only:schema-only@127.0.0.1:5433/event_registration_dev?schema=public",
};
const result = runNpm(["exec", "--", "prisma", command], {
  stdio: "inherit",
  env,
});
if (result.error) {
  console.error(`Unable to run Prisma ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
