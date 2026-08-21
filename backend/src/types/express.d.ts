import type { Request } from "express";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  organizationId: string;
  sector: string | null;
  permissions: string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type { Request };
