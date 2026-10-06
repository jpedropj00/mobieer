import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api, apiPost, getToken, setToken } from "@/services/api";
import type { AuthUser } from "@/types";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Há login guardado, mas o servidor não respondeu: a tela oferece tentar de novo. */
  sessionError: boolean;
  /** Devolve `mfaToken` quando a conta pede o código do autenticador antes de entrar. */
  login: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [initialToken] = useState(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);

  const {
    data: meData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["me"],
    // Sem tempo limite, um pedido que o servidor não respondia deixava a tela em
    // "Carregando sessão..." até a pessoa recarregar. Agora desiste em 10 s e
    // tenta de novo sozinho, que é o que o recarregar fazia.
    queryFn: () => api<{ data: AuthUser }>("/auth/me", { timeoutMs: 10_000 }),
    enabled: Boolean(initialToken),
    // sessão recusada (401/403) não adianta repetir; rede, demora e 5xx, sim
    retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status < 500),
    retryDelay: 800,
  });

  // Copia o usuário no mesmo render em que /auth/me responde. Com useEffect
  // havia um render "carregado, sem usuário": o guard mandava para /login e
  // o link direto (ou recarregar a página) acabava no Dashboard.
  const [syncedMe, setSyncedMe] = useState(meData);
  if (meData !== syncedMe) {
    setSyncedMe(meData);
    if (meData) setUser(meData.data);
  }

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener("mobieer:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("mobieer:unauthorized", handleUnauthorized);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api<{ data: { token?: string; user?: AuthUser; mfaRequired?: boolean; mfaToken?: string } }>("/auth/login", { method: "POST", body: credentials }),
    onSuccess: (data) => {
      // com verificação em duas etapas a sessão só vem depois do código
      if (!data.data.token || !data.data.user) return;
      setToken(data.data.token);
      setUser(data.data.user);
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await loginMutation.mutateAsync({ email, password });
      return r.data.mfaRequired && r.data.mfaToken ? { mfaToken: r.data.mfaToken } : {};
    },
    [loginMutation]
  );

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const r = await api<{ data: { token: string; user: AuthUser } }>("/auth/mfa/verify", { method: "POST", body: { mfaToken, code } });
    setToken(r.data.token);
    setUser(r.data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } catch {
      // ignore
    }
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      isLoading: Boolean(initialToken) && isLoading && !user,
      isAuthenticated: Boolean(user),
      // o 401 apaga o token (aí é login mesmo); com o token ainda guardado, foi o servidor que não respondeu
      sessionError: Boolean(initialToken) && isError && !isFetching && !user && Boolean(getToken()),
      login,
      verifyMfa,
      logout,
      can,
      // relê o /auth/me (ex.: depois de trocar a senha obrigatória)
      refresh: async () => {
        const r = await refetch();
        if (r.data) setUser(r.data.data);
      },
    }),
    [user, initialToken, isLoading, isError, isFetching, login, verifyMfa, logout, can, refetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
