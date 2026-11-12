import type { Request, Response, NextFunction } from "express";
import type { PrismaClient, Role } from "../generated/prisma/client.js";
import { parseCookies, SESSION_COOKIE_NAME } from "./cookies.js";
import { validateSession } from "./service.js";
import type { CurrentUser } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
      sessionToken?: string;
    }
  }
}

export function createCsrfAndMediaGuard(appOrigin: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only check mutating requests (POST, PUT, PATCH, DELETE)
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
      const origin = req.headers["origin"];
      if (!origin || origin !== appOrigin) {
        return res.status(403).json({
          error: {
            code: "CSRF_REJECTED",
            message: "Cross-site request rejected.",
          },
        });
      }

      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.toLowerCase().startsWith("application/json")) {
        return res.status(415).json({
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Unsupported media type. JSON is required.",
          },
        });
      }
    }
    next();
  };
}

export function createSessionMiddleware(prisma?: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!prisma) {
      return next();
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      req.sessionToken = token;
      try {
        const user = await validateSession(prisma, token);
        if (user) {
          req.currentUser = user;
        }
      } catch {
        // Leave unauthenticated on unexpected error
      }
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res
      .set("Cache-Control", "no-store")
      .status(401)
      .json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
        },
      });
  }
  next();
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res
        .set("Cache-Control", "no-store")
        .status(401)
        .json({
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
          },
        });
    }

    if (!allowedRoles.includes(req.currentUser.role)) {
      return res
        .set("Cache-Control", "no-store")
        .status(403)
        .json({
          error: {
            code: "FORBIDDEN",
            message: "Insufficient permissions.",
          },
        });
    }

    next();
  };
}
