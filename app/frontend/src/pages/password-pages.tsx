import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { api, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo large />
          <h1 className="mt-6 text-2xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-sm text-white/60">{subtitle}</p>
        </div>
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-2xl sm:p-8">{children}</div>
      </div>
    </div>
  );
}

const HINT = "Use pelo menos 8 caracteres, com letra maiúscula, minúscula e número. Não use o seu nome nem o e-mail.";

/** Troca obrigatória: senha provisória (dada pelo admin) ou vencida pela política. */
export function ForcePasswordChangePage() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast.error("A confirmação não confere com a senha nova");
    setBusy(true);
    try {
      await apiPost("/auth/change-password", { currentPassword: current, newPassword: next });
      toast.success("Senha alterada");
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível trocar a senha"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Troque a sua senha" subtitle={`${user?.name ?? ""}, antes de continuar é preciso definir uma senha nova.`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cur">Senha atual (ou a provisória que você recebeu)</Label>
          <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new">Senha nova</Label>
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf">Confirme a senha nova</Label>
          <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">{HINT}</p>
        <Button type="submit" className="w-full" disabled={busy || !current || !next}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Salvar senha nova
        </Button>
        <button type="button" className="w-full text-center text-xs text-muted-foreground hover:underline" onClick={() => void logout()}>
          Sair
        </button>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível enviar"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Esqueci minha senha" subtitle="Enviamos um link para você criar uma senha nova.">
      {sent ? (
        <div className="space-y-3 text-center text-sm">
          <MailCheck className="mx-auto h-10 w-10 text-success" />
          <p>Se o e-mail estiver cadastrado, o link chega em alguns minutos. Ele vale por 1 hora.</p>
          <Link to="/login" className="text-primary hover:underline">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail do seu acesso</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !email.includes("@")}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enviar link
          </Button>
          <Link to="/login" className="block text-center text-xs text-muted-foreground hover:underline">Voltar para o login</Link>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast.error("A confirmação não confere com a senha nova");
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password: next } });
      toast.success("Senha redefinida. Entre com a senha nova.");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Link inválido ou expirado"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Criar senha nova" subtitle="Defina a senha que você vai usar para entrar.">
      {!token ? (
        <p className="text-sm">Link incompleto. Peça outro em <Link to="/esqueci-senha" className="text-primary hover:underline">Esqueci minha senha</Link>.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new">Senha nova</Label>
            <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf">Confirme a senha nova</Label>
            <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">{HINT}</p>
          <Button type="submit" className="w-full" disabled={busy || !next}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar senha nova
          </Button>
        </form>
      )}
    </Shell>
  );
}
