/**
 * Deploy-time seed (`npm run seed --workspace server` after `npm run build`).
 * Runs in the migration job after `prisma migrate deploy`. It needs:
 *   DATABASE_URL (+ ALLOW_NON_LOCAL_DATABASE=1 for Cloud SQL / Compose),
 *   ALLOW_DEMO_SEED=1 and DEMO_SEED_PASSWORD (from Secret Manager).
 * It never prints connection details or passwords.
 */
import "dotenv/config";
import { createPrismaClient } from "./db.js";
import { DEMO_USERS, readSeedConfig, seedDemoUsers } from "./seed/demo-users.js";

let config;
try {
  config = readSeedConfig(process.env);
} catch (error) {
  console.error(`Seed refused: ${(error as Error).message}`);
  process.exit(2);
}

let prisma;
try {
  prisma = createPrismaClient();
} catch (error) {
  console.error(`Seed refused: ${(error as Error).message}`);
  process.exit(2);
}

try {
  const { default: argon2 } = await import("argon2");
  const passwordHash = await argon2.hash(config.password, { type: argon2.argon2id });
  const created = await seedDemoUsers(prisma, passwordHash);
  console.log(`Demo accounts: ${created} created, ${DEMO_USERS.length - created} already present.`);
} catch {
  console.error("Seed failed. No connection details or password values were printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
