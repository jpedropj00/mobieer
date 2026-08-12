import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { z } from "zod";
import { Building2, KeyRound, Loader2, ShieldCheck, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/services/api";
import { initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Senha atual obrigatória"),
  newPassword: z.string().min(6, "A nova senha deve ter pelo menos 6 caracteres"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "As senhas não conferem",
  path: ["confirmPassword"],
});

type PasswordValues = z.infer<typeof passwordSchema>;

const settingsSchema = z.object({
  companyName: z.string().min(1, "Nome da empresa obrigatório"),
  companyDocument: z.string(),
  lowStockAlertDays: z.string().regex(/^\d+$/, "Informe um número de dias"),
  notificationsEnabled: z.string(),
});

type SettingsValues = z.infer<typeof settingsSchema>;

function AccountTab() {
  const { user } = useAuth();

  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });

  const mutation = useMutation({
    mutationFn: (values: PasswordValues) =>
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
    </div>
  );
}

function SystemTab() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ data: Record<string, string> }>("/settings"),
    enabled: can("settings.manage"),
  });

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      companyName: "",
      companyDocument: "",
      lowStockAlertDays: "0",
      notificationsEnabled: "true",
    },
  });

  useEffect(() => {
    if (data?.data) {
      form.reset({
        companyName: data.data.companyName ?? "",
        companyDocument: data.data.companyDocument ?? "",
        lowStockAlertDays: data.data.lowStockAlertDays ?? "0",
        notificationsEnabled: data.data.notificationsEnabled ?? "true",
      });
    }
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: (values: SettingsValues) => apiPut("/settings", values),
    onSuccess: () => {
      toast.success("Configurações salvas");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar configurações"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Dados da empresa e preferências
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando configurações...</p>
        ) : (
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="max-w-xl space-y-5">
            <div className="space-y-2">
              <Label htmlFor="s-company">Nome da empresa *</Label>
              <Input id="s-company" {...form.register("companyName")} />
              {form.formState.errors.companyName && <p className="text-xs text-destructive">{form.formState.errors.companyName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-doc">CNPJ</Label>
              <Input id="s-doc" placeholder="00.000.000/0000-00" {...form.register("companyDocument")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-days">Dias para alerta de estoque baixo</Label>
              <Input id="s-days" type="number" min="0" {...form.register("lowStockAlertDays")} />
              {form.formState.errors.lowStockAlertDays && <p className="text-xs text-destructive">{form.formState.errors.lowStockAlertDays.message}</p>}
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <Label>Notificações de estoque</Label>
                <p className="text-sm text-muted-foreground">Alertas quando o estoque estiver abaixo do mínimo</p>
              </div>
              <Switch
                checked={form.watch("notificationsEnabled") === "true"}
                onCheckedChange={(c) => form.setValue("notificationsEnabled", String(c))}
              />
            </div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar configurações
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { can } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Sua conta, perfil e preferências do sistema." />

      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Minha conta</TabsTrigger>
          {can("settings.manage") && <TabsTrigger value="system">Sistema</TabsTrigger>}
        </TabsList>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        {can("settings.manage") && (
          <TabsContent value="system">
            <SystemTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
