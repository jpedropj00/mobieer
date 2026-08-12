import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2, Pencil, Plus, Search, Shield, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/services/api";
import type { Paginated, RoleInfo, User } from "@/types";
import { formatDate, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { RolesManagement } from "@/features/users/roles-management";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres").optional().or(z.literal("")),
  position: z.string().optional().or(z.literal("")),
  sector: z.string().optional().or(z.literal("")),
  roleId: z.string().min(1, "Perfil obrigatório"),
});

type Values = z.infer<typeof schema>;

export function UsersPage() {
  const { can, user: me } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users", page, search],
    queryFn: () => apiGet<Paginated<User[]>>("/users", { page, perPage: 15, search }),
  });

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: () => apiGet<{ data: RoleInfo[] }>("/users/roles"),
    enabled: can("users.read"),
  });

  const form = useForm<Values>({ resolver: zodResolver(schema) });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", email: "", password: "", position: "", sector: "", roleId: "" });
    setDialogOpen(true);
  };
  const openEdit = (u: User) => {
    setEditing(u);
    form.reset({
      name: u.name,
      email: u.email,
      password: "",
      position: u.position ?? "",
      sector: u.sector ?? "",
      roleId: u.role.id,
    });
    setDialogOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (values: Values) => {
      const body: Record<string, unknown> = {
        name: values.name,
        email: values.email,
        position: values.position || null,
        sector: values.sector || null,
        roleId: values.roleId,
      };
      if (editing) return apiPut(`/users/${editing.id}`, body);
      body.password = values.password || "mudar123";
      return apiPost("/users", body);
    },
    onSuccess: () => {
      toast.success(editing ? "Usuário atualizado" : "Usuário criado");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar"),
  });

  const toggleStatus = async (u: User) => {
    if (u.id === me?.id) return toast.error("Você não pode inativar a si mesmo");
    try {
      await apiPatch(`/users/${u.id}/status`, { status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      toast.success(u.status === "ACTIVE" ? "Usuário inativado" : "Usuário ativado");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao alterar status");
    }
  };

  const remove = async (u: User) => {
    if (u.id === me?.id) return toast.error("Você não pode remover a si mesmo");
    if (!confirm(`Inativar o usuário "${u.name}"?`)) return;
    try {
      await apiDelete(`/users/${u.id}`);
      toast.success("Usuário inativado");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao remover");
    }
  };

  const users = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Usuários" description="Controle de acesso e perfis do sistema.">
        {can("users.manage") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Novo usuário
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="roles">Perfis e permissões</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nome, email, cargo ou setor..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar usuários" />
        ) : users.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum usuário encontrado" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead className="hidden md:table-cell">Cargo / Setor</TableHead>
                    <TableHead className="hidden lg:table-cell">Último acesso</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback>{initials(u.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {u.name}
                              {u.id === me?.id && <span className="text-xs text-muted-foreground"> (você)</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <Shield className="mr-1 h-3 w-3" />
                          {u.role.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <p className="text-sm">{u.position ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{u.sector ?? ""}</p>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                        {u.lastLogin ? formatDate(u.lastLogin, true) : "Nunca acessou"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.status === "ACTIVE" ? "success" : "muted"}>{u.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {can("users.manage") && (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => toggleStatus(u)} title={u.status === "ACTIVE" ? "Inativar" : "Ativar"}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data?.meta && <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total} perPage={data.meta.perPage} onChange={setPage} />}
          </>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-name">Nome *</Label>
              <Input id="u-name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-email">Email *</Label>
              <Input id="u-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="u-position">Cargo</Label>
                <Input id="u-position" {...form.register("position")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-sector">Setor</Label>
                <Input id="u-sector" {...form.register("sector")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Perfil *</Label>
              <Select value={form.watch("roleId")} onValueChange={(v) => form.setValue("roleId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.data.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.roleId && <p className="text-xs text-destructive">{form.formState.errors.roleId.message}</p>}
            </div>
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="u-password">Senha</Label>
                <Input id="u-password" type="password" placeholder="Deixe vazio para usar mudar123" {...form.register("password")} />
                {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
        </TabsContent>

        <TabsContent value="roles">
          <RolesManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
