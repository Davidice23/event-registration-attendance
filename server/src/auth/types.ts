import type { Role } from "../generated/prisma/client.js";

export interface CurrentUser {
  id: string;
  displayName: string;
  role: Role;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}
