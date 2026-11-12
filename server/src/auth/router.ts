import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { clearSessionCookie, parseCookies, serializeSessionCookie, SESSION_COOKIE_NAME } from "./cookies.js";
import { authenticateUser, createSession, revokeSession } from "./service.js";

export interface AuthRouterOptions {
  prisma: PrismaClient;
  secureCookies?: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { prisma, secureCookies = false } = options;

  router.post("/login", async (req: Request, res: Response) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body must be a JSON object.",
        },
      });
    }

    const keys = Object.keys(body);
    if (keys.length !== 2 || !keys.includes("email") || !keys.includes("password")) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request must contain only email and password.",
        },
      });
    }

    const { email, password } = body;
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Email and password must be strings.",
        },
      });
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail.length === 0 || password.length === 0) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Email and password cannot be empty.",
        },
      });
    }

    const user = await authenticateUser(prisma, trimmedEmail, password);
    if (!user) {
      return res
        .set("Cache-Control", "no-store")
        .status(401)
        .json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password.",
          },
        });
    }

    // Session replacement: If an existing session token is provided, revoke it
    const cookies = parseCookies(req.headers.cookie);
    const priorToken = cookies[SESSION_COOKIE_NAME];

    const { token } = await createSession(prisma, user.id, priorToken);

    res.setHeader("Set-Cookie", serializeSessionCookie(token, { secure: secureCookies }));
    return res
      .set("Cache-Control", "no-store")
      .status(200)
      .json({
        data: {
          id: user.id,
          displayName: user.displayName,
          role: user.role,
        },
      });
  });

  router.get("/me", (req: Request, res: Response) => {
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

    return res
      .set("Cache-Control", "no-store")
      .status(200)
      .json({
        data: {
          id: req.currentUser.id,
          displayName: req.currentUser.displayName,
          role: req.currentUser.role,
        },
      });
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const body = req.body;
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length > 0
    ) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Logout request body must be an empty object.",
        },
      });
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      await revokeSession(prisma, token);
    }

    res.setHeader("Set-Cookie", clearSessionCookie({ secure: secureCookies }));
    return res.status(204).end();
  });

  return router;
}
