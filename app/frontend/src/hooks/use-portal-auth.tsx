import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPortalToken, portalApi, portalPost, setPortalToken } from "@/services/portal-api";

export type PortalAccount = { id: string; name: string; email: string };
export type PortalClient = { id: string; name: string };
/** BRIEFING = cadastro curto pelo site (só o briefing); FULL = portal completo. */
export type PortalLevel = "BRIEFING" | "FULL";

type Session = {
  account: PortalAccount;
  level: PortalLevel;
  hasClient: boolean;
  briefing: { submittedAt: string | null; leadStatus: string | null } | null;
};

type AuthResponse = { data: { token: string; level: PortalLevel; account: PortalAccount; client: PortalClient | null } };

type PortalAuthValue = {
  account: PortalAccount | null;
  client: PortalClient | null;
  level: PortalLevel | null;
  briefing: Session["briefing"];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<PortalLevel>;
  signup: (input: { name: string; email: string; cpf: string; password: string; website?: string }) => Promise<void>;
  loginWithToken: (token: string, account: PortalAccount) => Promise<void>;
  /** Recarrega a sessão (ex.: depois de enviar o briefing ou quando o acesso é ampliado). */
  refresh: () => Promise<void>;
  logout: () => void;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<PortalClient | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(getPortalToken()));

  const clear = useCallback(() => {
    setSession(null);
    setClient(null);
  }, []);

  const loadSession = useCallback(async () => {
    if (!getPortalToken()) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await portalApi<{ data: Session }>("/session");
      setSession(res.data);
      if (res.data.level === "FULL") {
        const me = await portalApi<{ data: { client: PortalClient } }>("/me");
        setClient(me.data.client);
      } else {
        setClient(null);
      }
    } catch {
      clear();
    } finally {
      setIsLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    window.addEventListener("mobieer:portal-unauthorized", clear);
    return () => window.removeEventListener("mobieer:portal-unauthorized", clear);
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await portalPost<AuthResponse>("/auth/login", { email, password });
      setPortalToken(res.data.token);
      await loadSession();
      return res.data.level;
    },
    [loadSession]
  );

  const signup = useCallback(
    async (input: { name: string; email: string; cpf: string; password: string; website?: string }) => {
      const res = await portalPost<AuthResponse>("/auth/signup", input);
      setPortalToken(res.data.token);
      await loadSession();
    },
    [loadSession]
  );

  const loginWithToken = useCallback(
    async (token: string) => {
      setPortalToken(token);
      await loadSession();
    },
    [loadSession]
  );

  const logout = useCallback(() => {
    setPortalToken(null);
    clear();
  }, [clear]);

  const value = useMemo<PortalAuthValue>(
    () => ({
      account: session?.account ?? null,
      client,
      level: session?.level ?? null,
      briefing: session?.briefing ?? null,
      isLoading,
      isAuthenticated: Boolean(session),
      login,
      signup,
      loginWithToken,
      refresh: loadSession,
      logout,
    }),
    [session, client, isLoading, login, signup, loginWithToken, loadSession, logout]
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error("usePortalAuth deve ser usado dentro de PortalAuthProvider");
  return ctx;
}
