import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { REGISTRATION_ERROR_STATUS, RegistrationError } from "./errors.js";
import { listMyRegistrations, registerForEvent } from "./service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEmptyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function validationError(res: Response, message: string) {
  return res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
}

export function createRegistrationsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    next();
  };

  // Contract order on protected routes: session → role → validate input → business rules.
  router.post("/events/:eventId/registrations", noStore, requireAuth, requireRole([Role.PARTICIPANT]), async (req: Request, res: Response) => {
    const eventId = String(req.params.eventId);
    if (!UUID.test(eventId)) return validationError(res, "Event ID must be a UUID.");
    if (Object.keys(req.query).length > 0) return validationError(res, "Query parameters are not accepted.");
    // The participant always comes from the session; any body field (e.g. participantId) is rejected.
    if (!isEmptyObject(req.body)) return validationError(res, "Request body must be an empty JSON object.");

    try {
      const registration = await registerForEvent(prisma, { eventId, participantId: req.currentUser!.id });
      return res.status(201).json({ data: registration });
    } catch (error) {
      if (error instanceof RegistrationError) {
        return res.status(REGISTRATION_ERROR_STATUS[error.code]).json({ error: { code: error.code, message: error.message } });
      }
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to register for event." } });
    }
  });

  router.get("/my/registrations", noStore, requireAuth, requireRole([Role.PARTICIPANT]), async (req: Request, res: Response) => {
    if (Object.keys(req.query).length > 0) return validationError(res, "Query parameters are not accepted.");
    try {
      const registrations = await listMyRegistrations(prisma, req.currentUser!.id);
      return res.status(200).json({ data: registrations });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load registrations." } });
    }
  });

  return router;
}
