import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";

/** Synthetic accounts (one per role and owner) used for local demos and Lab 6 UAT. */
export const DEMO_USERS = [
  { email: "organizer-a@example.test", displayName: "Organizer A", role: Role.ORGANIZER },
  { email: "organizer-b@example.test", displayName: "Organizer B", role: Role.ORGANIZER },
  { email: "participant-a@example.test", displayName: "Participant A", role: Role.PARTICIPANT },
  { email: "participant-b@example.test", displayName: "Participant B", role: Role.PARTICIPANT },
] as const;

export const MIN_DEMO_PASSWORD_LENGTH = 12;

export interface SeedConfig {
  password: string;
}

/**
 * Validates the seed settings before anything connects to a database or loads the hasher.
 * The password always comes from the environment (Secret Manager in the cloud), never from code.
 */
export function readSeedConfig(env: NodeJS.ProcessEnv): SeedConfig {
  if (env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("set ALLOW_DEMO_SEED=1 explicitly to seed demo accounts.");
  }
  const password = env.DEMO_SEED_PASSWORD;
  if (!password || password.length < MIN_DEMO_PASSWORD_LENGTH) {
    throw new Error(`DEMO_SEED_PASSWORD must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters; no data was written.`);
  }
  return { password };
}

/**
 * Creates any missing demo account. Safe to rerun: existing accounts, including their
 * passwords, are never overwritten. Returns how many accounts were newly created.
 */
export async function seedDemoUsers(prisma: Pick<PrismaClient, "user">, passwordHash: string): Promise<number> {
  let created = 0;
  for (const user of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
    if (existing) continue;
    await prisma.user.create({ data: { ...user, passwordHash } });
    created += 1;
  }
  return created;
}
