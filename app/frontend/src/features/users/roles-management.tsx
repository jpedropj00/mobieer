import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, CheckSquare, Loader2, Pencil, Shield, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/services/api";
import type { Permission, RoleInfo } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { useAuth } from "@/hooks/use-auth";

export function RolesManagement() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleInfo | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["roles"],
    queryFn: () => apiGet<{ data: RoleInfo[] }>("/users/roles"),
  });

  const { data: permissionsData } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiGet<{ data: Permission[] }>("/users/permissions"),
    enabled: can("users.manage"),
  });

  const groups = useMemo(() => {
    const perms = permissionsData?.data ?? [];
    const map = new Map<string, Permission[]>();
    perms.forEach((p) => {
      const list = map.get(p.module) ?? [];
      list.push(p);
      map.set(p.module, list);
    });
    return Array.from(map.entries()).map(([module, items]) => ({ module, items }));
  }, [permissionsData]);

  const saveMutation = useMutation({
    mutationFn: (roleId: string) => apiPut(`/users/roles/${roleId}/permissions`, { permissions: selected }),
    onSuccess: () => {
      toast.success("Permissões do perfil atualizadas");
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setEditingRole(null);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar permissões"),
  });

  const roles = data?.data ?? [];

  const openEditor = (role: RoleInfo) => {
    setEditingRole(role);
    setSelected(role.permissions.map((p) => p.code));
  };

  const toggle = (code: string) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const allCodes = useMemo(() => groups.flatMap((g) => g.items.map((p) => p.code)), [groups]);

  return (
    <>
      {isLoading ? (
        <Card>
          <TableSkeleton rows={4} cols={4} />
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState title="Erro ao carregar perfis" />
        </Card>
      ) : roles.length === 0 ? (
        <Card>
          <EmptyState icon={Shield} title="Nenhum perfil encontrado" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <ShieldCheck className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">{role.label}</p>
                      <p className="text-xs text-muted-foreground">{role.name}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    <Users className="mr-1 h-3 w-3" />
                    {role.userCount}
                  </Badge>
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{role.description}</p>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">{role.permissions.length} permissões</p>
                  {can("users.manage") && (
                    <Button variant="outline" size="sm" onClick={() => openEditor(role)}>
                      <Pencil className="h-3.5 w-3.5" /> Gerenciar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editingRole !== null} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permissões — {editingRole?.label}</DialogTitle>
          </DialogHeader>

          {editingRole && (
            <>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
                <span className="text-muted-foreground">
                  {selected.length} de {allCodes.length} permissões selecionadas
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(selected.length === allCodes.length ? [] : allCodes)}
                >
                  <CheckSquare className="mr-1 h-3.5 w-3.5" />
                  {selected.length === allCodes.length ? "Limpar todas" : "Marcar todas"}
                </Button>
              </div>

              <div className="space-y-5">
                {groups.map((group) => (
                  <div key={group.module}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.module}</p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {group.items.map((p) => (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors hover:bg-muted/50"
                        >
                          <Checkbox checked={selected.includes(p.code)} onCheckedChange={() => toggle(p.code)} className="mt-0.5" />
                          <span className="min-w-0">
                            <span className="block leading-snug">{p.label}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingRole(null)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => saveMutation.mutate(editingRole.id)} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Salvar permissões
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
