import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalAuthProvider, usePortalAuth } from "@/hooks/use-portal-auth";

/** Raiz do portal: injeta o contexto de autenticação do cliente. */
export function PortalRoot() {
  return (
    <PortalAuthProvider>
      <Outlet />
    </PortalAuthProvider>
  );
}

export function PortalWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[0.2em] ${className}`}>
      M&Oslash;BIEER
    </span>
  );
}

function PortalLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
    </div>
  );
}

export function PortalProtectedRoute() {
  const { isAuthenticated, isLoading } = usePortalAuth();
  const location = useLocation();
  if (isLoading) return <PortalLoader />;
  if (!isAuthenticated) return <Navigate to="/portal/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function PortalGuestRoute() {
  const { isAuthenticated, isLoading } = usePortalAuth();
  if (isLoading) return <PortalLoader />;
  if (isAuthenticated) return <Navigate to="/portal" replace />;
  return <Outlet />;
}

export function PortalLayout() {
  const { client, account, logout } = usePortalAuth();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/portal" className="text-lg text-foreground">
            <PortalWordmark />
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{client?.name}</p>
              <p className="text-xs text-muted-foreground leading-tight">{account?.email}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={logout} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-4xl px-5 pb-10 text-xs text-muted-foreground">
        Portal do cliente MOBIEER — dúvidas: WhatsApp (85) 99637-9339
      </footer>
    </div>
  );
}
