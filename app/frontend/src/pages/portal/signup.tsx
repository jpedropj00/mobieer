import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { PortalWordmark } from "./layout";

/** Máscara 000.000.000-00 enquanto digita. */
function maskCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

/** Mesma conta dos dígitos verificadores do backend, para avisar antes de enviar. */
function cpfOk(v: string) {
  const c = v.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/**
 * Cadastro curto do cliente pelo site: nome, e-mail, CPF e senha.
 * Depois dele, o cliente tem acesso só ao briefing.
 */
export function PortalSignupPage() {
  const { signup } = usePortalAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", cpf: "", password: "", confirm: "", website: "" });
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const cpfFilled = form.cpf.replace(/\D/g, "").length === 11;
  const cpfInvalid = cpfFilled && !cpfOk(form.cpf);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const valid =
    form.name.trim().split(/\s+/).length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    cpfOk(form.cpf) &&
    form.password.length >= 8 &&
    form.password === form.confirm;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try {
      await signup({ name: form.name.trim(), email: form.email.trim(), cpf: form.cpf, password: form.password, website: form.website });
      toast.success("Cadastro criado! Agora conte sobre o seu projeto.");
      navigate("/portal/briefing", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível criar o cadastro"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <PortalWordmark className="text-2xl text-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Crie seu acesso para contar sobre o seu projeto</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input id="name" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChange={(e) => set("cpf", maskCpf(e.target.value))}
              aria-invalid={cpfInvalid}
              required
            />
            {cpfInvalid && <p className="text-xs text-destructive">CPF inválido — confira os números.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Crie uma senha</Label>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} required />
            <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres. Você vai usar para voltar ao portal.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Repita a senha</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} aria-invalid={mismatch} required />
            {mismatch && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
          </div>
          {/* campo invisível contra robôs */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            className="hidden"
            aria-hidden="true"
          />
          <Button type="submit" className="w-full" disabled={!valid || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar acesso
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Usamos seus dados só para o atendimento do seu projeto.
          </p>
        </form>
        <p className="mt-4 text-center text-sm">
          Já tem acesso?{" "}
          <Link to="/portal/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
