import express, { type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Role } from "./generated/prisma/client.js";
import { createCsrfAndMediaGuard, createSessionMiddleware, requireAuth, requireRole } from "./auth/middleware.js";
import { createAuthRouter } from "./auth/router.js";
import { createPrismaClient } from "./db.js";
import { createEventsRouter } from "./events/router.js";

export interface AppOptions {
  prisma?: PrismaClient;
  appOrigin?: string;
  secureCookies?: boolean;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN ?? "http://127.0.0.1:5173";
  let prisma = options.prisma;
  if (!prisma && process.env.DATABASE_URL) {
    try {
      prisma = createPrismaClient();
    } catch {
      // Prisma left undefined if DB client fails to instantiate
    }
  }
  const secureCookies = options.secureCookies ?? (process.env.NODE_ENV === "production");

  app.disable("x-powered-by");

  // CSRF & Media type guard for all mutating routes (POST/PUT/PATCH/DELETE)
  app.use(createCsrfAndMediaGuard(appOrigin));

  app.use(express.json({ limit: "1mb", type: "application/json" }));

  // Attach session and current user
  app.use(createSessionMiddleware(prisma));

  // Health check endpoint
  app.get("/api/health", (_request, response) => {
    response
      .set("Cache-Control", "no-store")
      .status(200)
      .json({ data: { status: "ok" } });
  });

  // Auth routes: /api/auth/login, /api/auth/me, /api/auth/logout
  if (prisma) {
    app.use("/api/auth", createAuthRouter({ prisma, secureCookies }));
    app.use("/api", createEventsRouter(prisma));
  }

  // Protected route stubs for T-02 verification:
  // Anonymous callers receive 401 UNAUTHENTICATED.
  // Authorized callers receive 501 NOT_IMPLEMENTED until F-02/F-03/F-04 are implemented.
  app.get("/api/my/registrations", requireAuth, requireRole([Role.PARTICIPANT]), (_req, res) => {
    res.set("Cache-Control", "no-store").status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Participant registrations endpoint will be implemented in F-03.",
      },
    });
  });

  app.get("/api/organizer/events/:eventId/registrations", requireAuth, requireRole([Role.ORGANIZER]), (_req, res) => {
    res.set("Cache-Control", "no-store").status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Organizer event registrations endpoint will be implemented in F-04.",
      },
    });
  });

  // Future mutating routes protected by auth & role:
  // Reject with 501 NOT_IMPLEMENTED rather than fake 201 before F-02/F-03
  app.post("/api/events/:eventId/registrations", requireAuth, requireRole([Role.PARTICIPANT]), (_req, res) => {
    res.set("Cache-Control", "no-store").status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Event registration endpoint will be implemented in F-03.",
      },
    });
  });

  // Catch-all 404 handler for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    });
  });

  // Global error handler (handles malformed JSON and unexpected server errors)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Malformed JSON payload.",
        },
      });
    }
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    });
  });

  return app;
}
