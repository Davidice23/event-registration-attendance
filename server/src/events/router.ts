import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { createPublishedEvent, listOrganizerEvents, listPublishedEvents, validateCreateEvent } from "./service.js";
import { listOrganizerRoster } from "./roster.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  router.get("/organizer/events/:eventId/registrations", noStore, requireAuth, requireRole([Role.ORGANIZER]), async (req: Request, res: Response) => {
    const eventId = String(req.params.eventId);
    if (!UUID.test(eventId)) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Event ID must be a UUID." } });
    }
    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query parameters are not accepted." } });
    }

    try {
      const roster = await listOrganizerRoster(prisma, eventId, req.currentUser!.id);
      if (roster === null) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Event not found." } });
      }
      return res.status(200).json({ data: roster });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load event registrations." } });
    }
  });

  return router;
}
