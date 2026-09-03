import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/services/api";
import type { Inventory, Paginated } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { InventoryStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { ProductPicker } from "@/features/stock/product-picker";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  description: z.string().optional().or(z.literal("")),
});

export function InventoryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; code: string }[]>([]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inventories", page, search],
    queryFn: () => apiGet<Paginated<Inventory[]>>("/inventory", { page, perPage: 15, search }),
  });

  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      apiPost("/inventory", {
        name: values.name,
        description: values.description || null,
        productIds: selected.map((p) => p.id),
      }),
    onSuccess: (res) => {
      toast.success("Inventário criado");
      queryClient.invalidateQueries({ queryKey: ["inventories"] });
      setDialogOpen(false);
      form.reset();
      setSelected([]);
      const inv = (res as { data?: { id?: string } }).data;
      if (inv?.id) navigate(`/inventario/${inv.id}`);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao criar inventário"),
  });

  const inventories = data?.data ?? [];

  const startInventory = () => {
    setSelected([]);
    form.reset({ name: "", description: "" });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Inventário" description="Conferência periódica do estoque físico vs. registrado.">
        {can("inventory.create") && (
          <Button onClick={startInventory}>
            <Plus className="h-4 w-4" /> Novo inventário
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar inventário..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar inventários" />
        ) : inventories.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nenhum inventário" description="Crie um inventário para iniciar a conferência de estoque." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inventário</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Conferidos</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Divergências</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Iniciado por</TableHead>
                    <TableHead className="hidden lg:table-cell">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventories.map((inv) => (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => navigate(`/inventario/${inv.id}`)}>
                      <TableCell>
                        <p className="font-medium">{inv.name}</p>
                        {inv.description && <p className="max-w-[240px] truncate text-xs text-muted-foreground">{inv.description}</p>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{inv.itemCount}</TableCell>
                      <TableCell className="text-right text-muted-foreground hidden md:table-cell">{inv.counted ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground hidden md:table-cell">
                        {inv.divergences != null && inv.divergences > 0 ? <span className="font-semibold text-red-600">{inv.divergences}</span> : "—"}
                      </TableCell>
                      <TableCell>
                        <InventoryStatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{inv.startedBy.name}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                        {new Date(inv.createdAt).toLocaleDateString("pt-BR")}
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
            <DialogTitle>Novo inventário</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inv-name">Nome *</Label>
              <Input id="inv-name" placeholder="Ex.: Inventário mensal - Agosto" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-desc">Descrição</Label>
              <Textarea id="inv-desc" {...form.register("description")} />
            </div>
            <div className="space-y-2">
              <Label>Produtos</Label>
              {selected.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Nenhum produto selecionado. Adicione ao menos um.
                </p>
              ) : (
                <ul className="space-y-1">
                  {selected.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.code}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4" /> Adicionar produto
              </Button>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending || selected.length === 0}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar inventário
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ProductPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(p) => {
          if (!selected.some((s) => s.id === p.id)) {
            setSelected((prev) => [...prev, { id: p.id, name: p.name, code: p.code }]);
          }
        }}
        excludeIds={selected.map((s) => s.id)}
      />
    </div>
  );
}
