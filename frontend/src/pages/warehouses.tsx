import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2, MapPin, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api";
import type { Warehouse } from "@/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  code: z.string().min(1, "Código obrigatório"),
  address: z.string().optional().or(z.literal("")),
});

type Values = z.infer<typeof schema>;

export function WarehousesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: () => apiGet<{ data: Warehouse[] }>("/warehouses"),
  });

  const form = useForm<Values>({ resolver: zodResolver(schema) });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", code: "", address: "" });
    setDialogOpen(true);
  };
  const openEdit = (w: Warehouse) => {
    setEditing(w);
    form.reset({ name: w.name, code: w.code, address: w.address ?? "" });
    setDialogOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (values: Values) => (editing ? apiPut(`/warehouses/${editing.id}`, values) : apiPost("/warehouses", values)),
    onSuccess: () => {
      toast.success(editing ? "Almoxarifado atualizado" : "Almoxarifado criado");
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar"),
  });

  const remove = async (w: Warehouse) => {
    if (!confirm(`Remover o almoxarifado "${w.name}"?`)) return;
    try {
      await apiDelete(`/warehouses/${w.id}`);
      toast.success("Almoxarifado removido");
      refetch();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao remover");
    }
  };

  const warehouses = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Almoxarifados" description="Locais físicos onde os materiais são armazenados.">
        {can("warehouses.create") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Novo almoxarifado
          </Button>
        )}
      </PageHeader>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar almoxarifados" />
        ) : warehouses.length === 0 ? (
          <EmptyState icon={WarehouseIcon} title="Nenhum almoxarifado" description="Cadastre almoxarifados para armazenar os produtos." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Almoxarifado</TableHead>
                <TableHead>Código</TableHead>
                <TableHead className="hidden md:table-cell">Endereço</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <WarehouseIcon className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">{w.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{w.code}</TableCell>
                  <TableCell className="hidden max-w-[260px] truncate text-muted-foreground md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {w.address ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{w.productCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(w.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {can("warehouses.update") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(w)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {can("warehouses.delete") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(w)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar almoxarifado" : "Novo almoxarifado"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="w-name">Nome *</Label>
                <Input id="w-name" placeholder="Ex.: Almoxarifado Central" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="w-code">Código *</Label>
                <Input id="w-code" placeholder="Ex.: ALX-01" {...form.register("code")} />
                {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-address">Endereço</Label>
              <Input id="w-address" placeholder="Localização do almoxarifado" {...form.register("address")} />
            </div>
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
    </div>
  );
}
