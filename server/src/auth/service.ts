import crypto from "node:crypto";
import argon2 from "argon2";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { CurrentUser } from "./types.js";

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours absolute

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  priorToken?: string,
): Promise<{ token: string; expiresAt: Date }> {
  // Session replacement: If a prior session token was supplied, revoke it
  if (priorToken && typeof priorToken === "string") {
    const priorHash = hashSessionToken(priorToken);
    try {
      await prisma.session.deleteMany({
        where: { tokenHash: priorHash },
      });
    } catch {
      // Best-effort cleanup, do not block creation of the new session
    }
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function validateSession(
  prisma: PrismaClient,
  token: string,
): Promise<CurrentUser | null> {
  if (!token || typeof token !== "string") return null;

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          role: true,
        },
      },
    },
  });

  if (!session) return null;

  // Check absolute expiry (8 hours)
  if (session.expiresAt.getTime() <= Date.now()) {
    // Delete expired session record
    prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    displayName: session.user.displayName,
    role: session.user.role,
  };
}

export async function revokeSession(
  prisma: PrismaClient,
  token: string,
): Promise<void> {
  if (!token || typeof token !== "string") return;
  const tokenHash = hashSessionToken(token);
  try {
    await prisma.session.deleteMany({
      where: { tokenHash },
    });
  } catch {
    // Safe to ignore if row does not exist
  }
}

export async function authenticateUser(
  prisma: PrismaClient,
  rawEmail: string,
  password: string,
): Promise<CurrentUser | null> {
  const canonicalEmail = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: canonicalEmail },
  });

  if (!user) {
    // Mitigate timing attack differences with a simulated verify
    await argon2.verify(
      "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreOJRomJKitBgyAzG0qnqvsjfAZU",
      password,
    ).catch(() => false);
    return null;
  }

  const isValid = await verifyPassword(user.passwordHash, password);
  if (!isValid) return null;

  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
  };
}
