import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";
import { Logo } from "@/components/layout/logo";

const loginSchema = z.object({
  email: z.string().email("Informe um email válido"),
  password: z.string().min(1, "Informe a senha"),
});

type LoginValues = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS = [
  { label: "Administrador", email: "admin@mobieer.com.br", password: "admin123" },
  { label: "Almoxarife", email: "almoxarife@mobieer.com.br", password: "almox123" },
  { label: "Solicitante", email: "solicitante@mobieer.com.br", password: "sol123" },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      toast.success("Login realizado com sucesso");
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      navigate(from ?? "/", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao entrar"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <Logo />
          <h1 className="mt-6 text-2xl font-bold text-white">Bem-vindo de volta</h1>
          <p className="mt-1 text-sm text-white/50">Acesse o sistema de gestão de almoxarifado</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email" type="email" placeholder="voce@mobieer.com.br" className="pl-9" {...register("email")} autoComplete="email" />
            </div>
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="password" type="password" placeholder="••••••••" className="pl-9" {...register("password")} autoComplete="current-password" />
            </div>
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <div className="mt-6 rounded-2xl border border-sidebar-border bg-sidebar-muted/20 p-4">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-white/40">Acessos de demonstração</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setValue("email", acc.email);
                  setValue("password", acc.password);
                }}
                className="rounded-lg border border-sidebar-border bg-sidebar-muted/10 px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-sidebar-muted/30"
              >
                <p className="text-xs font-medium text-white">{acc.label}</p>
                <p className="mt-0.5 truncate text-[10px] text-white/40">{acc.email}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
