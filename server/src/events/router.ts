import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { createPublishedEvent, listOrganizerEvents, listPublishedEvents, validateCreateEvent } from "./service.js";

export function createEventsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    next();
  };

  router.post("/events", noStore, requireAuth, requireRole([Role.ORGANIZER]), async (req: Request, res: Response) => {
    const validation = validateCreateEvent(req.body);
    if (!validation.value) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Event details are invalid.", fields: validation.fields ?? {} } });
    }
    try {
      const event = await createPublishedEvent(prisma, req.currentUser!.id, validation.value);
      return res.status(201).json({ data: event });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to publish event." } });
    }
  });

  router.get("/events", noStore, requireAuth, requireRole([Role.PARTICIPANT]), async (_req: Request, res: Response) => {
    try {
      const events = await listPublishedEvents(prisma);
      return res.status(200).json({ data: events });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load events." } });
    }
  });

  router.get("/organizer/events", noStore, requireAuth, requireRole([Role.ORGANIZER]), async (req: Request, res: Response) => {
    try {
      const events = await listOrganizerEvents(prisma, req.currentUser!.id);
      return res.status(200).json({ data: events });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load events." } });
    }
  });

  return router;
}
