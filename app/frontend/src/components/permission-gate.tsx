import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function PermissionGate({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();

  if (can(permission)) return <>{children}</>;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <ShieldAlert className="h-12 w-12 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-lg font-semibold">Acesso restrito</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Seu perfil não possui permissão para acessar esta página. Entre em contato com o administrador.
        </p>
      </div>
    </div>
  );
}
