import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { registerForEvent } from "./service.js";
import { RegistrationError } from "./errors.js";

export function createRegistrationsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post(
    "/events/:eventId/registrations",
    requireAuth,
    requireRole([Role.PARTICIPANT]),
    async (req: Request, res: Response) => {
      const eventId = req.params.eventId;
      const participantId = req.currentUser!.id; // set by auth middleware

      try {
        const registration = await registerForEvent(prisma, eventId, participantId);
        return res.status(201).json({ data: registration });
      } catch (err) {
        if (err instanceof RegistrationError) {
          switch (err.code) {
            case "NOT_FOUND":
              return res.status(404).json({ error: { code: "NOT_FOUND", message: err.message } });
            case "ALREADY_REGISTERED":
              return res.status(409).json({ error: { code: "ALREADY_REGISTERED", message: err.message } });
            case "EVENT_FULL":
              return res.status(409).json({ error: { code: "EVENT_FULL", message: err.message } });
          }
        }
        console.error(err);
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to register for event." } });
      }
    },
  );

  return router;
}
