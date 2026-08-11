import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api";
import type { Category } from "@/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  description: z.string().optional().or(z.literal("")),
});

type Values = z.infer<typeof schema>;

export function CategoriesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiGet<{ data: Category[] }>("/categories"),
  });

  const form = useForm<Values>({ resolver: zodResolver(schema) });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", description: "" });
    setDialogOpen(true);
  };
  const openEdit = (c: Category) => {
    setEditing(c);
    form.reset({ name: c.name, description: c.description ?? "" });
    setDialogOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (values: Values) => (editing ? apiPut(`/categories/${editing.id}`, values) : apiPost("/categories", values)),
    onSuccess: () => {
      toast.success(editing ? "Categoria atualizada" : "Categoria criada");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setDialogOpen(false);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar"),
  });

  const remove = async (c: Category) => {
    if (!confirm(`Remover a categoria "${c.name}"?`)) return;
    try {
      await apiDelete(`/categories/${c.id}`);
      toast.success("Categoria removida");
      refetch();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao remover");
    }
  };

  const categories = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Categorias" description="Classificação dos materiais do almoxarifado.">
        {can("categories.create") && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nova categoria
          </Button>
        )}
      </PageHeader>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar categorias" />
        ) : categories.length === 0 ? (
          <EmptyState icon={Tags} title="Nenhuma categoria" description="Cadastre categorias para organizar os produtos." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Produtos</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground">{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{c.productCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {can("categories.update") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {can("categories.delete") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(c)}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="c-name">Nome *</Label>
              <Input id="c-name" placeholder="Ex.: Fixadores" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-desc">Descrição</Label>
              <Textarea id="c-desc" placeholder="Descreva a categoria" {...form.register("description")} />
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
