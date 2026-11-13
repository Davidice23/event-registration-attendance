import { AuthApiError, type ApiErrorPayload } from "./auth";
import type { EventSummary } from "./events";

export interface MyRegistration {
  id: string;
  registeredAt: string;
  event: EventSummary;
}

/** Thrown when the server's answer is unknown (network failure, 5xx, unreadable body). */
export class UnknownOutcomeError extends Error {
  constructor(message = "The outcome of the request is unknown.") {
    super(message);
    this.name = "UnknownOutcomeError";
  }
}

async function readError(response: Response): Promise<AuthApiError> {
  let code = "UNKNOWN_ERROR";
  let message = "The request could not be completed.";
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    if (payload.error) {
      code = payload.error.code;
      message = payload.error.message;
    }
  } catch { /* Keep the safe fallback. */ }
  return new AuthApiError(message, code);
}

/**
 * Sends exactly one POST. Never retries: when the outcome is unknown the caller must
 * reload the participant's own registrations before letting the user try again (F-03 §4).
 */
export async function registerForEvent(eventId: string): Promise<MyRegistration> {
  let response: Response;
  try {
    response = await fetch(`/api/events/${encodeURIComponent(eventId)}/registrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    throw new UnknownOutcomeError();
  }
  if (response.status >= 500) throw new UnknownOutcomeError();
  if (!response.ok) throw await readError(response);
  try {
    const payload = (await response.json()) as { data: MyRegistration };
    return payload.data;
  } catch {
    throw new UnknownOutcomeError();
  }
}

export async function getMyRegistrations(): Promise<MyRegistration[]> {
  const response = await fetch("/api/my/registrations");
  if (!response.ok) throw await readError(response);
  const payload = (await response.json()) as { data: MyRegistration[] };
  return payload.data;
}

export type RegisterOutcome =
  | { kind: "registered" }
  | { kind: "already-registered" }
  | { kind: "event-full" }
  | { kind: "not-found" }
  | { kind: "session-expired" }
  | { kind: "unknown" }
  | { kind: "rejected"; message: string };

/** Maps a failure from `registerForEvent` to what the UI must do next. */
export function classifyRegisterError(error: unknown): RegisterOutcome {
  if (error instanceof UnknownOutcomeError) return { kind: "unknown" };
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "ALREADY_REGISTERED": return { kind: "already-registered" };
      case "EVENT_FULL": return { kind: "event-full" };
      case "NOT_FOUND": return { kind: "not-found" };
      case "UNAUTHENTICATED": return { kind: "session-expired" };
      default: return { kind: "rejected", message: error.message };
    }
  }
  return { kind: "unknown" };
}
