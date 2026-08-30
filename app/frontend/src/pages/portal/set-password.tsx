import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/utils";
import { portalApi, portalPost } from "@/services/portal-api";
import { usePortalAuth, type PortalAccount } from "@/hooks/use-portal-auth";
import { PortalWordmark } from "./layout";

/** mode="invite" → primeiro acesso (define senha e entra). mode="reset" → redefinição. */
export function PortalSetPasswordPage({ mode }: { mode: "invite" | "reset" }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { loginWithToken } = usePortalAuth();

  const [checking, setChecking] = useState(mode === "invite");
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "invite") return;
    if (!token) {
      setInvalid(true);
      setChecking(false);
      return;
    }
    portalApi<{ data: { name: string; email: string } }>(`/auth/invite/${token}`)
      .then((res) => setName(res.data.name))
      .catch(() => setInvalid(true))
      .finally(() => setChecking(false));
  }, [mode, token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("A senha deve ter ao menos 8 caracteres");
    if (password !== confirm) return toast.error("As senhas não coincidem");
    setSubmitting(true);
    try {
      if (mode === "invite") {
        const res = await portalPost<{ data: { token: string; account: PortalAccount } }>("/auth/accept-invite", { token, password });
        await loginWithToken(res.data.token, res.data.account);
        toast.success("Senha definida");
        navigate("/portal", { replace: true });
      } else {
        await portalPost("/auth/reset", { token, password });
        toast.success("Senha redefinida. Faça login.");
        navigate("/portal/login", { replace: true });
      }
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível concluir"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <PortalWordmark className="text-2xl text-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {mode === "invite" ? "Primeiro acesso" : "Redefinir senha"}
          </p>
        </div>

        {checking ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : invalid ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm">
            <p className="text-muted-foreground">Este link é inválido ou expirou.</p>
            <Link to="/portal/login" className="mt-3 inline-block text-primary hover:underline">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
            {mode === "invite" && name && (
              <p className="text-sm text-muted-foreground">
                Olá, <span className="font-medium text-foreground">{name}</span>. Defina uma senha para acessar o portal.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="pw">Nova senha</Label>
              <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirmar senha</Label>
              <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "invite" ? "Definir senha e entrar" : "Redefinir senha"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
