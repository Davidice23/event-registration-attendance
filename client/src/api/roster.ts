import { AuthApiError, type ApiErrorPayload } from "./auth";

export interface OrganizerRosterEntry {
  registrationId: string;
  participantDisplayName: string;
  registeredAt: string;
}

export async function getOrganizerRoster(eventId: string): Promise<OrganizerRosterEntry[]> {
  const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/registrations`);
  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = "The request could not be completed.";
    try {
      const payload = await response.json() as ApiErrorPayload;
      if (payload.error) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch { /* Preserve the safe fallback. */ }
    throw new AuthApiError(message, code);
  }
  const payload = await response.json() as { data: OrganizerRosterEntry[] };
  return payload.data;
}
