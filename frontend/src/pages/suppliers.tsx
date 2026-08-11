import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api";
import type { Supplier } from "@/types";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
  cnpj: z.string().optional().or(z.literal("")),
  contact: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
});

type Values = z.infer<typeof schema>;

export function SuppliersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => apiGet<{ data: Supplier[] }>("/suppliers", { search }),
  });

  const form = useForm<Values>({ resolver: zodResolver(schema) });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", cnpj: "", contact: "", phone: "", email: "", address: "" });
    setDialogOpen(true);
  };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    form.reset({
      name: s.name,
      cnpj: s.cnpj ?? "",
      contact: s.contact ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
    });
    setDialogOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (values: Values) => (editing ? apiPut(`/suppliers/${editing.id}`, values) : apiPost("/suppliers", values)),
    onSuccess: () => {
      toast.success(editing ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar"),
  });

  const remove = async (s: Supplier) => {
    if (!confirm(`Remover o fornecedor "${s.name}"?`)) return;
    try {
      await apiDelete(`/suppliers/${s.id}`);
      toast.success("Fornecedor removido");
      refetch();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao remover");
    }
  };

  const suppliers = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Fornecedores" description="Empresas que abastecem o almoxarifado.">
        {can("suppliers.create") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Novo fornecedor
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nome, CNPJ ou contato..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar fornecedores" />
        ) : suppliers.length === 0 ? (
          <EmptyState icon={Truck} title="Nenhum fornecedor encontrado" description="Cadastre fornecedores para vincular aos produtos." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Truck className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">desde {formatDate(s.createdAt)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.cnpj ?? "—"}</TableCell>
                  <TableCell>{s.contact ?? "—"}</TableCell>
                  <TableCell className="hidden max-w-[180px] truncate text-muted-foreground md:table-cell">{s.email ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{s.productCount}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "ACTIVE" ? "success" : "muted"}>{s.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {can("suppliers.update") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {can("suppliers.delete") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(s)}>
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
            <DialogTitle>{editing ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-name">Nome *</Label>
              <Input id="s-name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="s-cnpj">CNPJ</Label>
                <Input id="s-cnpj" {...form.register("cnpj")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-phone">Telefone</Label>
                <Input id="s-phone" {...form.register("phone")} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="s-contact">Contato</Label>
                <Input id="s-contact" {...form.register("contact")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-email">Email</Label>
                <Input id="s-email" type="email" {...form.register("email")} />
                {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-address">Endereço</Label>
              <Input id="s-address" {...form.register("address")} />
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
