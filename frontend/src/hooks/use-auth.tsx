import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, apiPost, getToken, setToken } from "@/services/api";
import type { AuthUser } from "@/types";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [initialToken] = useState(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);

  const {
    data: meData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ data: AuthUser }>("/auth/me"),
    enabled: Boolean(initialToken),
    retry: false,
  });

  useEffect(() => {
    if (meData) {
      setUser(meData.data);
    }
  }, [meData]);

  useEffect(() => {
    if (!initialToken) return;
    const onMeError = () => {};
    void refetch().catch(onMeError);
  }, [initialToken, refetch]);

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
      api<{ data: { token: string; user: AuthUser } }>("/auth/login", { method: "POST", body: credentials }),
    onSuccess: (data) => {
      setToken(data.data.token);
      setUser(data.data.user);
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await loginMutation.mutateAsync({ email, password });
    },
    [loginMutation]
  );

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
      login,
      logout,
      can,
    }),
    [user, initialToken, isLoading, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
