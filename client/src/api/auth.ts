export type Role = "ORGANIZER" | "PARTICIPANT";

export interface CurrentUser {
  id: string;
  displayName: string;
  role: Role;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export class AuthApiError extends Error {
  code: string;
  fields?: Record<string, string>;

  constructor(message: string, code: string, fields?: Record<string, string>) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.fields = fields;
  }
}

export async function login(credentials: { email: string; password: string }): Promise<CurrentUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = "Failed to sign in.";
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload?.error) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch {
      // Use fallback message
    }
    throw new AuthApiError(message, code);
  }

  const payload = (await response.json()) as { data: CurrentUser };
  return payload.data;
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await fetch("/api/auth/me");
    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { data: CurrentUser };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok && response.status !== 204) {
    let code = "LOGOUT_FAILED";
    let message = "Failed to log out.";
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload?.error) {
        code = payload.error.code;
        message = payload.error.message;
      }
    } catch {
      // Use fallback message
    }
    throw new AuthApiError(message, code);
  }
}
