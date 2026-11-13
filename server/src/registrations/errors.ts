export type RegistrationErrorCode = "NOT_FOUND" | "ALREADY_REGISTERED" | "EVENT_FULL" | "TEMPORARILY_UNAVAILABLE";

/**
 * Business-rule failures raised by the registration service.
 * The router maps each code to the HTTP status defined in the F-03 contract:
 * NOT_FOUND → 404, ALREADY_REGISTERED / EVENT_FULL → 409, TEMPORARILY_UNAVAILABLE → 503.
 */
export class RegistrationError extends Error {
  public readonly code: RegistrationErrorCode;

  constructor(code: RegistrationErrorCode, message: string) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
  }
}

export const REGISTRATION_ERROR_STATUS: Record<RegistrationErrorCode, number> = {
  NOT_FOUND: 404,
  ALREADY_REGISTERED: 409,
  EVENT_FULL: 409,
  TEMPORARILY_UNAVAILABLE: 503,
};
