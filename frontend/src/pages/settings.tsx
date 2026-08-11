import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2, ShieldCheck, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/services/api";
import { initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  currentPassword: z.string().min(1, "Senha atual obrigatória"),
  newPassword: z.string().min(6, "A nova senha deve ter pelo menos 6 caracteres"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "As senhas não conferem",
  path: ["confirmPassword"],
});

type Values = z.infer<typeof schema>;

export function SettingsPage() {
  const { user } = useAuth();

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });

  const mutation = useMutation({
    mutationFn: (values: Values) =>
      apiPost("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: () => {
      toast.success("Senha alterada com sucesso");
      form.reset();
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao alterar senha"),
  });

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Sua conta e preferências do sistema." />

      <Card>
        <CardHeader>
          <CardTitle>Meus dados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16 text-lg">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{user.name}</h3>
              <Badge variant="secondary">{user.roleLabel}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <UserCircle className="h-4 w-4" />
              {user.permissions.length} permissões
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              Perfil: {user.role}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Alterar senha
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-current">Senha atual</Label>
              <Input id="s-current" type="password" {...form.register("currentPassword")} />
              {form.formState.errors.currentPassword && <p className="text-xs text-destructive">{form.formState.errors.currentPassword.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-new">Nova senha</Label>
              <Input id="s-new" type="password" {...form.register("newPassword")} />
              {form.formState.errors.newPassword && <p className="text-xs text-destructive">{form.formState.errors.newPassword.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-confirm">Confirmar nova senha</Label>
              <Input id="s-confirm" type="password" {...form.register("confirmPassword")} />
              {form.formState.errors.confirmPassword && <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Alterar senha
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-1 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Sistema MOBIEER</p>
          <p>Entre em contato com o administrador para ajustar permissões ou atualizar seus dados.</p>
        </CardContent>
      </Card>
    </div>
  );
}
