import express, { type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createCsrfAndMediaGuard, createSessionMiddleware } from "./auth/middleware.js";
import { createAuthRouter } from "./auth/router.js";
import { createPrismaClient } from "./db.js";
import { createEventsRouter } from "./events/router.js";
import { createRegistrationsRouter } from "./registrations/router.js";

export interface AppOptions {
  prisma?: PrismaClient;
  appOrigin?: string;
  secureCookies?: boolean;
  /** Directory of the built React client (`client/dist`). When set, the API also serves the UI. */
  clientDistDir?: string;
}

const READY_TIMEOUT_MS = 3_000;

async function databaseIsReachable(prisma: PrismaClient | undefined): Promise<boolean> {
  if (!prisma) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), READY_TIMEOUT_MS); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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

  // Readiness: 200 only when the database answers; used by the post-deploy smoke test.
  app.get("/api/ready", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (await databaseIsReachable(prisma)) {
      return response.status(200).json({ data: { status: "ready" } });
    }
    return response.status(503).json({
      error: { code: "TEMPORARILY_UNAVAILABLE", message: "The service is not ready." },
    });
  });

  // Auth routes: /api/auth/login, /api/auth/me, /api/auth/logout
  if (prisma) {
    app.use("/api/auth", createAuthRouter({ prisma, secureCookies }));
    app.use("/api", createEventsRouter(prisma));
    app.use("/api", createRegistrationsRouter(prisma));
  }

  // In a deployed container the API also serves the built client from the same origin,
  // so the Origin/CSRF check and the session cookie work without CORS.
  const clientDistDir = options.clientDistDir ?? process.env.CLIENT_DIST_DIR;
  if (clientDistDir) {
    const root = path.resolve(clientDistDir);
    const indexHtml = path.join(root, "index.html");
    if (!existsSync(indexHtml)) throw new Error("CLIENT_DIST_DIR does not contain index.html.");
    app.use(express.static(root, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints files in assets/, so they can be cached; everything else is revalidated.
        res.set("Cache-Control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }));
    // SPA fallback: client routes such as /events or /my/registrations load index.html.
    app.get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response, next: NextFunction) => {
      if (!req.accepts("html")) return next();
      // Pass `root` so only the file name is checked for dot-segments, not the whole install path.
      res.set("Cache-Control", "no-cache").sendFile("index.html", { root });
    });
  }

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
