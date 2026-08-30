import type { Request } from "express";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  organizationId: string;
  enterpriseId: string;
  sector: string | null;
  permissions: string[];
};

export type PortalClient = {
  accountId: string;
  clientId: string;
  name: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      portal?: PortalClient;
    }
  }
}

export type { Request };
