export const SESSION_COOKIE_NAME = "sid";

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }
  return cookies;
}

export interface CookieSerializeOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  secure?: boolean;
  expires?: Date;
}

export function serializeSessionCookie(
  token: string,
  options: CookieSerializeOptions = {},
): string {
  const maxAge = options.maxAgeSeconds ?? 8 * 60 * 60; // 8 hours absolute
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(options: CookieSerializeOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${options.path ?? "/"}`,
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
