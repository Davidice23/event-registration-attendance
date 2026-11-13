import { expect, test } from "@playwright/test";
import {
  closePool, countRegistrations, createEvent, eventCard, eventIdByTitle, insertRegistration,
  resetDatabase, signIn, signOut,
} from "./fixtures";

/**
 * Browser E2E for F-03 (contract §4) — T-13 / T-14 from the Sprint 1 STS.
 * Roster steps depend on F-04 (Issue #6) and are recorded as `test.fixme` until that lands.
 */

const REGISTER_POST = /\/api\/events\/[0-9a-f-]{36}\/registrations$/;
const MY_REGISTRATIONS_GET = /\/api\/my\/registrations$/;

let users: Awaited<ReturnType<typeof resetDatabase>>;

test.beforeEach(async () => {
  users = await resetDatabase();
});

test.afterAll(async () => {
  await closePool();
});

test("T-13 (F-03 part): organizer publishes, participant registers and reads it back after refresh, logout locks the page", async ({ page }) => {
  const title = "E2E Journey Workshop";

  // Organizer A publishes through the UI.
  await signIn(page, "organizerA");
  await expect(page).toHaveURL(/\/organizer\/events$/);
  await page.getByLabel("ชื่อกิจกรรม").fill(title);
  await page.getByLabel("รายละเอียด").fill("Hands-on session");
  await page.getByLabel("วันและเวลา (เวลาไทย ICT, UTC+7)").fill("2027-01-15T10:00");
  await page.getByLabel("สถานที่").fill("Hall A");
  await page.getByLabel("จำนวนที่นั่ง").fill("2");
  await page.getByRole("button", { name: "เผยแพร่กิจกรรม" }).click();
  await expect(page.getByText("เผยแพร่กิจกรรมแล้ว")).toBeVisible();
  await expect(eventCard(page, title)).toBeVisible();
  await signOut(page);
  const eventId = await eventIdByTitle(title);

  // Participant A registers from /events.
  await signIn(page, "participantA");
  await expect(page).toHaveURL(/\/events$/);
  const card = eventCard(page, title);
  await expect(card.getByRole("button", { name: "สมัคร", exact: true })).toBeEnabled();

  // Success must appear only after the POST answered AND /my/registrations was re-read.
  // Hold the first list read that starts after the POST answer and check nothing claims success meanwhile.
  let posts = 0;
  let postAnswered = false;
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let heldReadArrived!: () => void;
  const heldRead = new Promise<void>(resolve => { heldReadArrived = resolve; });
  await page.route(REGISTER_POST, async route => {
    posts += 1;
    const response = await route.fetch();
    postAnswered = true;
    await route.fulfill({ response });
  });
  await page.route(MY_REGISTRATIONS_GET, async route => {
    if (postAnswered) {
      heldReadArrived();
      await released;
    }
    await route.continue();
  });
  const successText = page.getByText(`สมัครกิจกรรม “${title}” สำเร็จแล้ว`);
  await card.getByRole("button", { name: "สมัคร", exact: true }).click();
  await heldRead;
  await page.waitForTimeout(300);
  await expect(successText).toHaveCount(0);
  release();
  await expect(successText).toBeVisible();
  expect(posts).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
  await expect(card.getByRole("button", { name: "สมัครแล้ว" })).toBeDisabled();
  expect(await countRegistrations(eventId, users.participantA)).toBe(1);

  // My Registrations shows it, and still does after a full page refresh.
  await page.getByRole("link", { name: "รายการของฉัน" }).click();
  await expect(page).toHaveURL(/\/my\/registrations$/);
  const list = page.getByRole("list", { name: "รายการที่สมัคร" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText(title);
  await page.reload();
  await expect(page).toHaveURL(/\/my\/registrations$/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText(title);

  // After logout the protected page cannot be reached without signing in again.
  await signOut(page);
  await page.goto("/my/registrations");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("list", { name: "รายการที่สมัคร" })).toHaveCount(0);
  expect((await page.request.get("/api/my/registrations")).status()).toBe(401);
});

test.fixme("T-13 (F-04 part): Organizer A signs in again and opens the roster — pending F-04 (Issue #6)", async () => {});

test("T-14 (F-03 part): registering the same event again shows the duplicate reason and adds no row", async ({ page, context }) => {
  const title = "E2E Duplicate Seminar";
  const eventId = await createEvent(users.organizerA, title, 5);
  await signIn(page, "participantA");

  // A second tab in the same session registers first, leaving this tab's view stale.
  const otherTab = await context.newPage();
  await otherTab.goto("/events");
  await expect(page.getByRole("button", { name: "Sign out of your account" })).toBeVisible();
  await eventCard(otherTab, title).getByRole("button", { name: "สมัคร", exact: true }).click();
  await expect(otherTab.getByText(`สมัครกิจกรรม “${title}” สำเร็จแล้ว`)).toBeVisible();
  await otherTab.close();

  const staleButton = eventCard(page, title).getByRole("button", { name: "สมัคร", exact: true });
  await expect(staleButton).toBeEnabled();
  await staleButton.click();
  await expect(page.getByText(`คุณสมัครกิจกรรม “${title}” ไว้แล้ว ระบบไม่ได้สร้างรายการซ้ำ`)).toBeVisible();
  await expect(page.getByText("เต็มแล้ว")).toHaveCount(0);
  await expect(eventCard(page, title).getByRole("button", { name: "สมัครแล้ว" })).toBeDisabled();
  expect(await countRegistrations(eventId, users.participantA)).toBe(1);

  await page.getByRole("link", { name: "รายการของฉัน" }).click();
  await expect(page.getByRole("list", { name: "รายการที่สมัคร" }).getByRole("listitem")).toHaveCount(1);
});

test.fixme("T-14 (F-04 part): a participant opening an organizer roster URL sees no roster — pending F-04 (Issue #6)", async () => {});

test("F-03 UI: a full event shows EVENT_FULL, distinct from the duplicate message, and adds no row", async ({ page }) => {
  const title = "E2E Full Lab";
  const eventId = await createEvent(users.organizerA, title, 1);
  await insertRegistration(eventId, users.participantB);
  await signIn(page, "participantA");

  await eventCard(page, title).getByRole("button", { name: "สมัคร", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(`กิจกรรม “${title}” เต็มแล้ว สมัครไม่สำเร็จ`);
  await expect(page.getByText("ไว้แล้ว")).toHaveCount(0);
  await expect(eventCard(page, title).getByRole("button", { name: "เต็มแล้ว" })).toBeDisabled();
  expect(await countRegistrations(eventId)).toBe(1);
  expect(await countRegistrations(eventId, users.participantA)).toBe(0);
});

test("F-03 UI: response lost after commit — checks own list first, reports success, never re-POSTs", async ({ page }) => {
  const title = "E2E Lost Response";
  const eventId = await createEvent(users.organizerA, title, 3);
  await signIn(page, "participantA");

  let posts = 0;
  await page.route(REGISTER_POST, async route => {
    posts += 1;
    await route.fetch(); // the server commits the registration…
    await route.abort("connectionreset"); // …but the browser never sees the answer.
  });
  const listReloaded = page.waitForRequest(request => request.method() === "GET" && MY_REGISTRATIONS_GET.test(request.url()));
  await eventCard(page, title).getByRole("button", { name: "สมัคร", exact: true }).click();
  await listReloaded;
  await expect(page.getByText(`ตรวจรายการของคุณแล้ว: การสมัคร “${title}” สำเร็จ`)).toBeVisible();
  await expect(eventCard(page, title).getByRole("button", { name: "สมัครแล้ว" })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(posts).toBe(1);
  expect(await countRegistrations(eventId, users.participantA)).toBe(1);
});

test("F-03 UI: request failed before commit — checks own list, says it is not there, lets the user decide", async ({ page }) => {
  const title = "E2E Failed Request";
  const eventId = await createEvent(users.organizerA, title, 3);
  await signIn(page, "participantA");

  let posts = 0;
  await page.route(REGISTER_POST, async route => {
    posts += 1;
    await route.abort("connectionrefused");
  });
  const listReloaded = page.waitForRequest(request => request.method() === "GET" && MY_REGISTRATIONS_GET.test(request.url()));
  await eventCard(page, title).getByRole("button", { name: "สมัคร", exact: true }).click();
  await listReloaded;
  await expect(page.getByRole("alert")).toHaveText(`ไม่แน่ใจว่าคำขอสมัคร “${title}” สำเร็จหรือไม่ ตรวจรายการของคุณแล้วยังไม่พบ หากต้องการให้กดสมัครอีกครั้ง`);
  await expect(eventCard(page, title).getByRole("button", { name: "สมัคร", exact: true })).toBeEnabled();
  await page.waitForTimeout(500);
  expect(posts).toBe(1);
  expect(await countRegistrations(eventId, users.participantA)).toBe(0);
});

test("F-03 UI: POST succeeds but the follow-up My Registrations read fails — no confirmed success is claimed", async ({ page }) => {
  const title = "E2E Unconfirmed Read";
  const eventId = await createEvent(users.organizerA, title, 3);
  await signIn(page, "participantA");

  let posts = 0;
  let postAnswered = false;
  let failedReads = 0;
  await page.route(REGISTER_POST, async route => {
    posts += 1;
    const response = await route.fetch();
    postAnswered = true;
    await route.fulfill({ response });
  });
  await page.route(MY_REGISTRATIONS_GET, async route => {
    if (postAnswered && failedReads === 0) {
      failedReads += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "x" } }) });
      return;
    }
    await route.continue();
  });

  const card = eventCard(page, title);
  await card.getByRole("button", { name: "สมัคร", exact: true }).click();
  await expect(page.getByText("สมัครแล้วแต่ยังยืนยันรายการไม่ได้—กรุณาตรวจรายการของฉัน")).toBeVisible();
  // Not presented as a confirmed success.
  await expect(page.locator(".registration-feedback")).not.toHaveClass(/registration-feedback-success/);
  await expect(page.getByText(`สมัครกิจกรรม “${title}” สำเร็จแล้ว`)).toHaveCount(0);
  // Registering stays blocked until the participant re-checks their own list.
  await expect(card.getByRole("button")).toBeDisabled();
  expect(failedReads).toBe(1);
  expect(posts).toBe(1);
  expect(await countRegistrations(eventId, users.participantA)).toBe(1);

  await page.getByRole("button", { name: "ตรวจรายการของฉัน" }).click();
  await expect(card.getByRole("button", { name: "สมัครแล้ว" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ตรวจรายการของฉัน" })).toHaveCount(0);
  expect(posts).toBe(1);
});
