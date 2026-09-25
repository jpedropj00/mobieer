import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-sidebar">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-white/60">Carregando sessão...</p>
      </div>
    </div>
  );
}

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function GuestRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenLoader />;
  if (isAuthenticated) {
    // volta para onde a pessoa ia antes de passar pelo login
    const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
    return <Navigate to={from ? `${from.pathname}${from.search ?? ""}` : "/"} replace />;
  }
  return <Outlet />;
}

/**
 * Página inicial conforme o perfil: montador vai direto para a área dele;
 * quem não vê o dashboard de estoque cai no painel da loja ou no chat.
 */
export function HomeRoute({ dashboard }: { dashboard: React.ReactNode }) {
  const { user, can } = useAuth();
  if (can("dashboard.read")) return <>{dashboard}</>;
  if (user?.role === "MONTADOR") return <Navigate to="/montador" replace />;
  if (can("finance.read") || can("commercial.read")) return <Navigate to="/painel-loja" replace />;
  if (can("chat.use")) return <Navigate to="/chat" replace />;
  return <>{dashboard}</>;
}
