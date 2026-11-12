import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/client.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { createPublishedEvent, listOrganizerEvents, listPublishedEvents, validateCreateEvent } from "./service.js";

export function createEventsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post("/events", requireAuth, requireRole([Role.ORGANIZER]), async (req: Request, res: Response) => {
    const validation = validateCreateEvent(req.body);
    if (!validation.value) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Event details are invalid.", fields: validation.fields ?? {} } });
    }
    try {
      const event = await createPublishedEvent(prisma, req.currentUser!.id, validation.value);
      return res.set("Cache-Control", "no-store").status(201).json({ data: event });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to publish event." } });
    }
  });

  router.get("/events", requireAuth, requireRole([Role.PARTICIPANT]), async (_req: Request, res: Response) => {
    try {
      const events = await listPublishedEvents(prisma);
      return res.set("Cache-Control", "no-store").status(200).json({ data: events });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load events." } });
    }
  });

  router.get("/organizer/events", requireAuth, requireRole([Role.ORGANIZER]), async (req: Request, res: Response) => {
    try {
      const events = await listOrganizerEvents(prisma, req.currentUser!.id);
      return res.set("Cache-Control", "no-store").status(200).json({ data: events });
    } catch {
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to load events." } });
    }
  });

  return router;
}
