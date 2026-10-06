import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** O login está guardado, mas o servidor não respondeu: tentar de novo sem perder a sessão. */
function SessionRetry() {
  const { refresh, logout } = useAuth();
  return (
    <div className="flex h-screen items-center justify-center bg-sidebar p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <WifiOff className="h-8 w-8 text-primary" />
        <p className="font-medium text-white">Não foi possível carregar sua sessão</p>
        <p className="text-sm text-white/60">O servidor demorou para responder. Sua sessão continua guardada — é só tentar de novo.</p>
        <Button onClick={() => void refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Tentar de novo
        </Button>
        <button type="button" className="text-xs text-white/50 underline" onClick={() => void logout()}>
          Entrar com outra conta
        </button>
      </div>
    </div>
  );
}

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, sessionError, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (sessionError) return <SessionRetry />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  // senha provisória ou vencida: nada abre antes da troca (o backend também barra)
  if (user?.passwordChangeRequired && location.pathname !== "/trocar-senha") return <Navigate to="/trocar-senha" replace />;
  return <Outlet />;
}

export function GuestRoute() {
  const { isAuthenticated, isLoading, sessionError } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullScreenLoader />;
  if (sessionError) return <SessionRetry />;
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
  // só quem é apenas montador cai direto na tela da montagem
  if (user && (user.roles ?? [user.role]).every((r) => r === "MONTADOR")) return <Navigate to="/montador" replace />;
  if (can("finance.read") || can("commercial.read")) return <Navigate to="/painel-loja" replace />;
  if (can("chat.use")) return <Navigate to="/chat" replace />;
  return <>{dashboard}</>;
}
