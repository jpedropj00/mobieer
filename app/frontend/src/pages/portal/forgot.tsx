import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/utils";
import { portalPost } from "@/services/portal-api";
import { PortalWordmark } from "./layout";

export function PortalForgotPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await portalPost("/auth/forgot", { email: email.trim() });
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível enviar"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <PortalWordmark className="text-2xl text-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Recuperar acesso</p>
        </div>
        {sent ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm">
            <p className="text-muted-foreground">
              Se houver uma conta com este e-mail, enviamos um link para redefinir a senha.
            </p>
            <Link to="/portal/login" className="mt-3 inline-block text-primary hover:underline">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar link
            </Button>
            <p className="text-center text-sm">
              <Link to="/portal/login" className="text-primary hover:underline">Voltar ao login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
