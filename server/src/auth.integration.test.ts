import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { parseCookies, SESSION_COOKIE_NAME } from "./auth/cookies.js";
import { hashPassword, hashSessionToken } from "./auth/service.js";
import { createPrismaClient } from "./db.js";
import { type PrismaClient, Role } from "./generated/prisma/client.js";

describe("Sprint 1 STS — F-01 Auth & Session Lifecycle Integration Tests", () => {
  let server: Server;
  let origin: string;
  let prisma: PrismaClient;
  const appOrigin = "http://127.0.0.1:5173";

  const organizerEmail = "organizer-a@example.test";
  const organizerPassword = "organizer-password-123";
  const participantEmail = "participant-a@example.test";
  const participantPassword = "participant-password-123";

  let organizerUserId: string;
  let participantUserId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be provided by the guarded runner.");
    }
    prisma = createPrismaClient();

    // Clean up test database tables to ensure clean slate
    await prisma.session.deleteMany();
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();

    // Seed test users
    const organizerHash = await hashPassword(organizerPassword);
    const participantHash = await hashPassword(participantPassword);

    const organizer = await prisma.user.create({
      data: {
        email: organizerEmail,
        displayName: "Organizer A",
        role: Role.ORGANIZER,
        passwordHash: organizerHash,
      },
    });
    organizerUserId = organizer.id;

    const participant = await prisma.user.create({
      data: {
        email: participantEmail,
        displayName: "Participant A",
        role: Role.PARTICIPANT,
        passwordHash: participantHash,
      },
    });
    participantUserId = participant.id;

    // Start Express app server on dynamic loopback port
    const app = createApp({ prisma, appOrigin, secureCookies: false });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server address.");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    // Clear sessions before each test case
    await prisma.session.deleteMany();
  });

  // T-01: API/DB / AC-01
  describe("T-01: Login for both roles, /me identity, and session replacement", () => {
    it("logs in Organizer A, returns CurrentUser DTO without secrets, and sets secure cookie attributes", async () => {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");

      const body = await response.json();
      expect(body).toEqual({
        data: {
          id: organizerUserId,
          displayName: "Organizer A",
          role: "ORGANIZER",
        },
      });
      // Verify no secrets or internal fields leaked
      expect(body.data).not.toHaveProperty("passwordHash");
      expect(body.data).not.toHaveProperty("email");
      expect(body.data).not.toHaveProperty("token");

      // Verify Set-Cookie header
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("sid=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Max-Age=28800");
      expect(setCookie).not.toContain("Domain=");

      // Verify GET /api/auth/me with the session cookie
      const cookies = parseCookies(setCookie!);
      const sid = cookies[SESSION_COOKIE_NAME];
      expect(sid).toBeTruthy();

      const meResponse = await fetch(`${origin}/api/auth/me`, {
        headers: {
          Cookie: `sid=${sid}`,
        },
      });
      expect(meResponse.status).toBe(200);
      expect(meResponse.headers.get("cache-control")).toBe("no-store");
      expect(await meResponse.json()).toEqual({
        data: {
          id: organizerUserId,
          displayName: "Organizer A",
          role: "ORGANIZER",
        },
      });
    });

    it("logs in Participant A and retrieves identity via /me", async () => {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "  PARTICIPANT-A@EXAMPLE.TEST  ", // tests trim and lowercase canonicalization
          password: participantPassword,
        }),
      });

      expect(response.status).toBe(200);
      const setCookie = response.headers.get("set-cookie");
      const sid = parseCookies(setCookie!)[SESSION_COOKIE_NAME];

      const meResponse = await fetch(`${origin}/api/auth/me`, {
        headers: {
          Cookie: `sid=${sid}`,
        },
      });
      expect(meResponse.status).toBe(200);
      expect(await meResponse.json()).toEqual({
        data: {
          id: participantUserId,
          displayName: "Participant A",
          role: "PARTICIPANT",
        },
      });
    });

    it("replaces and revokes prior session atomically when a new login request includes an existing session cookie", async () => {
      // First login
      const firstLogin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
        }),
      });
      expect(firstLogin.status).toBe(200);
      const firstSid = parseCookies(firstLogin.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];

      // Second login sending the prior sid cookie
      const secondLogin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
          "Cookie": `sid=${firstSid}`,
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
        }),
      });
      expect(secondLogin.status).toBe(200);
      const secondSid = parseCookies(secondLogin.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];
      expect(secondSid).not.toBe(firstSid);

      // Verify the prior session is revoked
      const meWithPrior = await fetch(`${origin}/api/auth/me`, {
        headers: { Cookie: `sid=${firstSid}` },
      });
      expect(meWithPrior.status).toBe(401);
      expect(await meWithPrior.json()).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });

      // Verify the new session works
      const meWithNew = await fetch(`${origin}/api/auth/me`, {
        headers: { Cookie: `sid=${secondSid}` },
      });
      expect(meWithNew.status).toBe(200);

      // Verify in DB that the old token hash is gone
      const oldSessionInDb = await prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(firstSid) },
      });
      expect(oldSessionInDb).toBeNull();
    });
  });

  // T-02: API/DB / AC-02
  describe("T-02: Failed credentials uniformity, session immunity, and protected API guards", () => {
    it("returns identical 401 INVALID_CREDENTIALS for wrong password and unknown email without creating a session", async () => {
      const initialSessionCount = await prisma.session.count();

      // Wrong password for existing user
      const wrongPasswordResponse = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: "wrong-password",
        }),
      });
      expect(wrongPasswordResponse.status).toBe(401);
      expect(wrongPasswordResponse.headers.get("cache-control")).toBe("no-store");
      const wrongPasswordBody = await wrongPasswordResponse.json();
      expect(wrongPasswordBody).toEqual({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password.",
        },
      });

      // Unknown email
      const unknownEmailResponse = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "unknown-account@example.test",
          password: "any-password",
        }),
      });
      expect(unknownEmailResponse.status).toBe(401);
      const unknownEmailBody = await unknownEmailResponse.json();
      expect(unknownEmailBody).toEqual({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password.",
        },
      });

      // Both public error payloads must match strictly
      expect(wrongPasswordBody).toEqual(unknownEmailBody);

      // No session record created in DB
      const finalSessionCount = await prisma.session.count();
      expect(finalSessionCount).toBe(initialSessionCount);
    });

    it("rejects anonymous /me request with 401 UNAUTHENTICATED", async () => {
      const response = await fetch(`${origin}/api/auth/me`);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
    });

    it("rejects expired session with 401 UNAUTHENTICATED", async () => {
      // Create expired fixture session in DB
      const expiredToken = "expired-token-fixture-12345678901234567890";
      const tokenHash = hashSessionToken(expiredToken);
      await prisma.session.create({
        data: {
          tokenHash,
          userId: organizerUserId,
          createdAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // expired 1 hour ago
        },
      });

      const response = await fetch(`${origin}/api/auth/me`, {
        headers: {
          Cookie: `sid=${expiredToken}`,
        },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
    });

    it("rejects anonymous requests to protected GET routes with 401 UNAUTHENTICATED without leaking state", async () => {
      const protectedRoutes = [
        "/api/my/registrations",
        "/api/organizer/events",
        "/api/organizer/events/11111111-1111-1111-1111-111111111111/registrations",
      ];

      for (const route of protectedRoutes) {
        const response = await fetch(`${origin}${route}`);
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
          },
        });
      }
    });

    it("responds 501 NOT_IMPLEMENTED rather than 200/201 when authenticated users call unreleased feature routes", async () => {
      // Login as Organizer
      const orgLogin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: organizerEmail, password: organizerPassword }),
      });
      const orgSid = parseCookies(orgLogin.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];

      // POST /api/events with valid auth & origin returns 501 NOT_IMPLEMENTED instead of fake 201
      const publishRes = await fetch(`${origin}/api/events`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/json", "Cookie": `sid=${orgSid}` },
        body: JSON.stringify({ title: "New Workshop" }),
      });
      expect(publishRes.status).toBe(501);
      expect(await publishRes.json()).toEqual({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Event publication endpoint will be implemented in F-02.",
        },
      });

      // Login as Participant
      const partLogin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: participantEmail, password: participantPassword }),
      });
      const partSid = parseCookies(partLogin.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];

      // POST /api/events/:id/registrations with valid auth & origin returns 501 NOT_IMPLEMENTED
      const regRes = await fetch(`${origin}/api/events/11111111-1111-1111-1111-111111111111/registrations`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/json", "Cookie": `sid=${partSid}` },
        body: JSON.stringify({}),
      });
      expect(regRes.status).toBe(501);
      expect(await regRes.json()).toEqual({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Event registration endpoint will be implemented in F-03.",
        },
      });
    });

    it("rejects login request with unexpected fields like role or id with 400 VALIDATION_ERROR", async () => {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
          role: "ORGANIZER", // client attempting to pass role
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request must contain only email and password.",
        },
      });
    });
  });

  // T-03: API/DB / AC-03
  describe("T-03: Logout replay rejection and CSRF/Media-Type side-effect immunity", () => {
    it("logs out cleanly with 204, clears cookie, and invalidates session replay", async () => {
      // Login first
      const loginRes = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
        }),
      });
      const sid = parseCookies(loginRes.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];

      // Logout request
      const logoutRes = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
          "Cookie": `sid=${sid}`,
        },
        body: JSON.stringify({}),
      });

      expect(logoutRes.status).toBe(204);
      expect(await logoutRes.text()).toBe("");

      // Verify Set-Cookie clears sid
      const clearCookie = logoutRes.headers.get("set-cookie");
      expect(clearCookie).toBeTruthy();
      expect(clearCookie).toContain("sid=");
      expect(clearCookie).toContain("Max-Age=0");

      // Verify replay of sid gets 401
      const meReplay = await fetch(`${origin}/api/auth/me`, {
        headers: { Cookie: `sid=${sid}` },
      });
      expect(meReplay.status).toBe(401);
      expect(await meReplay.json()).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
    });

    it("enforces Origin matching and JSON media type on all POST routes without side-effects", async () => {
      // Login to obtain an active session for testing logout, publish, and register
      const loginRes = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: {
          "Origin": appOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: organizerEmail,
          password: organizerPassword,
        }),
      });
      const activeSid = parseCookies(loginRes.headers.get("set-cookie")!)[SESSION_COOKIE_NAME];

      const baselineSessions = await prisma.session.count();
      const baselineEvents = await prisma.event.count();
      const baselineRegistrations = await prisma.registration.count();

      // 1. POST /api/auth/login with missing Origin -> 403 CSRF_REJECTED
      const loginNoOrigin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: organizerEmail, password: organizerPassword }),
      });
      expect(loginNoOrigin.status).toBe(403);
      expect(await loginNoOrigin.json()).toEqual({
        error: { code: "CSRF_REJECTED", message: "Cross-site request rejected." },
      });

      // 2. POST /api/auth/login with wrong Origin -> 403 CSRF_REJECTED
      const loginWrongOrigin = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Origin": "http://evil.com", "Content-Type": "application/json" },
        body: JSON.stringify({ email: organizerEmail, password: organizerPassword }),
      });
      expect(loginWrongOrigin.status).toBe(403);

      // 3. POST /api/auth/login with form media-type -> 415 UNSUPPORTED_MEDIA_TYPE
      const loginFormMedia = await fetch(`${origin}/api/auth/login`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/x-www-form-urlencoded" },
        body: `email=${organizerEmail}&password=${organizerPassword}`,
      });
      expect(loginFormMedia.status).toBe(415);
      expect(await loginFormMedia.json()).toEqual({
        error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported media type. JSON is required." },
      });

      // Verify no session was created by rejected login requests
      expect(await prisma.session.count()).toBe(baselineSessions);

      // 4. POST /api/events with missing Origin -> 403
      const publishNoOrigin = await fetch(`${origin}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": `sid=${activeSid}` },
        body: JSON.stringify({ title: "Test Event" }),
      });
      expect(publishNoOrigin.status).toBe(403);

      // 5. POST /api/events with wrong media type -> 415
      const publishFormMedia = await fetch(`${origin}/api/events`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/x-www-form-urlencoded", "Cookie": `sid=${activeSid}` },
        body: "title=Test",
      });
      expect(publishFormMedia.status).toBe(415);
      expect(await prisma.event.count()).toBe(baselineEvents);

      // 6. POST /api/events/:id/registrations with wrong Origin -> 403
      const registerWrongOrigin = await fetch(`${origin}/api/events/11111111-1111-1111-1111-111111111111/registrations`, {
        method: "POST",
        headers: { "Origin": "http://evil.com", "Content-Type": "application/json", "Cookie": `sid=${activeSid}` },
        body: JSON.stringify({}),
      });
      expect(registerWrongOrigin.status).toBe(403);

      // 7. POST /api/events/:id/registrations with wrong media type -> 415
      const registerFormMedia = await fetch(`${origin}/api/events/11111111-1111-1111-1111-111111111111/registrations`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "text/plain", "Cookie": `sid=${activeSid}` },
        body: "{}",
      });
      expect(registerFormMedia.status).toBe(415);
      expect(await prisma.registration.count()).toBe(baselineRegistrations);

      // 8. POST /api/auth/logout with wrong Origin -> 403 CSRF_REJECTED
      const logoutWrongOrigin = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { "Origin": "http://attacker.com", "Content-Type": "application/json", "Cookie": `sid=${activeSid}` },
        body: JSON.stringify({}),
      });
      expect(logoutWrongOrigin.status).toBe(403);
      expect(logoutWrongOrigin.headers.get("set-cookie")).toBeNull();

      // 9. POST /api/auth/logout with form media type -> 415 UNSUPPORTED_MEDIA_TYPE
      const logoutFormMedia = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { "Origin": appOrigin, "Content-Type": "application/x-www-form-urlencoded", "Cookie": `sid=${activeSid}` },
        body: "",
      });
      expect(logoutFormMedia.status).toBe(415);
      expect(logoutFormMedia.headers.get("set-cookie")).toBeNull();

      // Crucial verification: After rejected logout attempts, the original sid is still valid!
      const meAfterRejectedLogout = await fetch(`${origin}/api/auth/me`, {
        headers: { Cookie: `sid=${activeSid}` },
      });
      expect(meAfterRejectedLogout.status).toBe(200);
      expect(await meAfterRejectedLogout.json()).toEqual({
        data: {
          id: organizerUserId,
          displayName: "Organizer A",
          role: "ORGANIZER",
        },
      });

      // Verify row counts are identical to baseline
      expect(await prisma.session.count()).toBe(baselineSessions);
      expect(await prisma.event.count()).toBe(baselineEvents);
      expect(await prisma.registration.count()).toBe(baselineRegistrations);
    });

    it("returns 503 TEMPORARILY_UNAVAILABLE and does not clear cookie when database fails during logout", async () => {
      // Create dedicated failing app server instance
      const failingPrisma = new Proxy(prisma, {
        get(target, prop) {
          if (prop === "session") {
            return {
              ...target.session,
              deleteMany: async () => {
                throw new Error("Simulated database failure during logout");
              },
            };
          }
          return Reflect.get(target, prop);
        },
      });

      const failingApp = createApp({ prisma: failingPrisma, appOrigin, secureCookies: false });
      const failServer = createServer(failingApp);
      await new Promise<void>((resolve) => failServer.listen(0, "127.0.0.1", resolve));
      const failAddress = failServer.address();
      if (!failAddress || typeof failAddress === "string") throw new Error("Expected address");
      const failOrigin = `http://127.0.0.1:${failAddress.port}`;

      try {
        const logoutRes = await fetch(`${failOrigin}/api/auth/logout`, {
          method: "POST",
          headers: {
            "Origin": appOrigin,
            "Content-Type": "application/json",
            "Cookie": "sid=active-session-token",
          },
          body: JSON.stringify({}),
        });

        expect(logoutRes.status).toBe(503);
        expect(logoutRes.headers.get("set-cookie")).toBeNull();
        expect(await logoutRes.json()).toEqual({
          error: {
            code: "TEMPORARILY_UNAVAILABLE",
            message: "Unable to revoke session due to a database error. Please try again.",
          },
        });
      } finally {
        await new Promise<void>((resolve) => failServer.close(() => resolve()));
      }
    });

    it("returns 503 TEMPORARILY_UNAVAILABLE when database transaction fails during login session creation", async () => {
      const failingPrisma = new Proxy(prisma, {
        get(target, prop) {
          if (prop === "$transaction") {
            return async () => {
              throw new Error("Simulated database transaction failure during login");
            };
          }
          return Reflect.get(target, prop);
        },
      });

      const failingApp = createApp({ prisma: failingPrisma, appOrigin, secureCookies: false });
      const failServer = createServer(failingApp);
      await new Promise<void>((resolve) => failServer.listen(0, "127.0.0.1", resolve));
      const failAddress = failServer.address();
      if (!failAddress || typeof failAddress === "string") throw new Error("Expected address");
      const failOrigin = `http://127.0.0.1:${failAddress.port}`;

      try {
        const loginRes = await fetch(`${failOrigin}/api/auth/login`, {
          method: "POST",
          headers: {
            "Origin": appOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: organizerEmail,
            password: organizerPassword,
          }),
        });

        expect(loginRes.status).toBe(503);
        expect(loginRes.headers.get("set-cookie")).toBeNull();
        expect(await loginRes.json()).toEqual({
          error: {
            code: "TEMPORARILY_UNAVAILABLE",
            message: "Database error during session creation. Please try again.",
          },
        });
      } finally {
        await new Promise<void>((resolve) => failServer.close(() => resolve()));
      }
    });
  });
});
