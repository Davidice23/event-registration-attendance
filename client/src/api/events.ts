import { AuthApiError, type ApiErrorPayload } from "./auth";

export interface EventSummary {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  location: string;
  capacity: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = "The request could not be completed.";
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload.error) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch { /* Keep the safe fallback. */ }
    throw new AuthApiError(message, code);
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

export function publishEvent(input: Omit<EventSummary, "id">): Promise<EventSummary> {
  return request<EventSummary>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getEvents(): Promise<EventSummary[]> {
  return request<EventSummary[]>("/api/events");
}

export function getOrganizerEvents(): Promise<EventSummary[]> {
  return request<EventSummary[]>("/api/organizer/events");
}
