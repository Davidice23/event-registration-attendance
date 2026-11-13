import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import { expect, type Page } from "@playwright/test";

/**
 * Synthetic accounts for the dedicated loopback test database only.
 * The password is generated per run, hashed with Argon2id and never printed.
 */
export const TEST_PASSWORD = randomBytes(18).toString("base64url");

export const USERS = {
  organizerA: { email: "organizer-a@example.test", displayName: "Organizer A", role: "ORGANIZER" },
  participantA: { email: "participant-a@example.test", displayName: "Participant A", role: "PARTICIPANT" },
  participantB: { email: "participant-b@example.test", displayName: "Participant B", role: "PARTICIPANT" },
} as const;

type UserKey = keyof typeof USERS;

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL must be supplied by scripts/run-e2e-tests.mjs.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

let passwordHash: Promise<string> | undefined;

/** Wipes the test database and inserts the three synthetic users. Returns their IDs. */
export async function resetDatabase(): Promise<Record<UserKey, string>> {
  passwordHash ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
  const hash = await passwordHash;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM registrations");
    await client.query("DELETE FROM sessions");
    await client.query("DELETE FROM events");
    await client.query("DELETE FROM users");
    const ids = {} as Record<UserKey, string>;
    for (const [key, user] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, "displayName", role, "passwordHash") VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
        [user.email, user.displayName, user.role, hash],
      );
      ids[key] = result.rows[0].id;
    }
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createEvent(organizerId: string, title: string, capacity: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (id, "organizerId", title, description, "startsAt", location, capacity)
     VALUES (gen_random_uuid(), $1, $2, 'E2E fixture event', '2027-01-15T03:00:00Z', 'Hall E2E', $3) RETURNING id`,
    [organizerId, title, capacity],
  );
  return result.rows[0].id;
}

export async function insertRegistration(eventId: string, participantId: string): Promise<void> {
  await pool.query(`INSERT INTO registrations (id, "eventId", "participantId") VALUES (gen_random_uuid(), $1, $2)`, [eventId, participantId]);
}

export async function countRegistrations(eventId: string, participantId?: string): Promise<number> {
  const result = participantId
    ? await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM registrations WHERE "eventId" = $1 AND "participantId" = $2`, [eventId, participantId])
    : await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM registrations WHERE "eventId" = $1`, [eventId]);
  return result.rows[0].n;
}

export async function eventIdByTitle(title: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM events WHERE title = $1`, [title]);
  expect(result.rowCount).toBe(1);
  return result.rows[0].id;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export async function signIn(page: Page, user: UserKey): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email Address").fill(USERS[user].email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.locator(".user-badge")).toContainText(USERS[user].displayName);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out of your account" }).click();
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
}

export function eventCard(page: Page, title: string) {
  return page.getByRole("article", { name: title });
}
