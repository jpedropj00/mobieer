import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPortalToken, portalApi, portalPost, setPortalToken } from "@/services/portal-api";

export type PortalAccount = { id: string; name: string; email: string };
export type PortalClient = { id: string; name: string };

type PortalAuthValue = {
  account: PortalAccount | null;
  client: PortalClient | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, account: PortalAccount) => Promise<void>;
  logout: () => void;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [client, setClient] = useState<PortalClient | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(getPortalToken()));

  const loadMe = useCallback(async () => {
    if (!getPortalToken()) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await portalApi<{ data: { account: PortalAccount; client: PortalClient } }>("/me");
      setAccount(res.data.account);
      setClient(res.data.client);
    } catch {
      setAccount(null);
      setClient(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAccount(null);
      setClient(null);
    };
    window.addEventListener("mobieer:portal-unauthorized", onUnauthorized);
    return () => window.removeEventListener("mobieer:portal-unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await portalPost<{ data: { token: string; account: PortalAccount; client: PortalClient } }>("/auth/login", {
      email,
      password,
    });
    setPortalToken(res.data.token);
    setAccount(res.data.account);
    setClient(res.data.client);
  }, []);

  const loginWithToken = useCallback(async (token: string, acc: PortalAccount) => {
    setPortalToken(token);
    setAccount(acc);
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(() => {
    setPortalToken(null);
    setAccount(null);
    setClient(null);
  }, []);

  const value = useMemo<PortalAuthValue>(
    () => ({ account, client, isLoading, isAuthenticated: Boolean(account), login, loginWithToken, logout }),
    [account, client, isLoading, login, loginWithToken, logout]
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth deve ser usado dentro de PortalAuthProvider");
  return ctx;
}
