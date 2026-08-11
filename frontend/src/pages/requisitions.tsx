import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Loader2, Package, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/services/api";
import type { Paginated, Product, Requisition } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { RequisitionStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { ProductPicker } from "@/features/stock/product-picker";
import { useAuth } from "@/hooks/use-auth";

const statusOptions = [
  { value: "ALL", label: "Todos os status" },
  { value: "PENDING", label: "Pendente" },
  { value: "IN_REVIEW", label: "Em análise" },
  { value: "APPROVED", label: "Aprovada" },
  { value: "SEPARATION", label: "Separação" },
  { value: "CONCLUDED", label: "Concluída" },
  { value: "REFUSED", label: "Recusada" },
  { value: "CANCELLED", label: "Cancelada" },
];

export function RequisitionsPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [myOnly, setMyOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<{ product: Product; quantity: string }[]>([]);
  const [sector, setSector] = useState("");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["requisitions", page, search, status, myOnly],
    queryFn: () =>
      apiGet<Paginated<Requisition[]>>("/requisitions", {
        page,
        perPage: 15,
        search,
        status: status === "ALL" ? undefined : status,
        my: myOnly ? "true" : undefined,
      }),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiPost("/requisitions", {
        sector: sector || null,
        destination: destination || null,
        note: note || null,
        items: items.map((i) => ({ productId: i.product.id, quantity: Number.parseInt(i.quantity, 10) })),
      }),
    onSuccess: (res) => {
      toast.success("Requisição criada");
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
      setDialogOpen(false);
      setItems([]);
      setSector("");
      setDestination("");
      setNote("");
      const req = (res as { data?: { id?: string } }).data;
      if (req?.id) navigate(`/requisicoes/${req.id}`);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao criar requisição"),
  });

  const requisitions = data?.data ?? [];

  const addItem = (product: Product) => {
    if (items.some((i) => i.product.id === product.id)) return toast.error("Produto já adicionado");
    setItems((prev) => [...prev, { product, quantity: "1" }]);
  };

  const submit = () => {
    const parsed = items.map((i) => Number.parseInt(i.quantity, 10));
    if (items.length === 0) return toast.error("Adicione ao menos um produto");
    if (parsed.some((q) => !Number.isInteger(q) || q <= 0)) return toast.error("Informe quantidades válidas");
    mutation.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Requisições" description="Solicitações de materiais feitas pelos setores.">
        {can("requisitions.create") && (
          <Button
            onClick={() => {
              setItems([]);
              setSector("");
              setDestination("");
              setNote("");
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Nova requisição
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por número, solicitante ou produto..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant={myOnly ? "default" : "outline"} onClick={() => { setMyOnly((v) => !v); setPage(1); }}>
              Minhas
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar requisições" />
        ) : requisitions.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nenhuma requisição encontrada" description="Ajuste os filtros ou crie uma nova requisição." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead className="hidden md:table-cell">Setor</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Qtd. total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requisitions.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/requisicoes/${r.id}`)}>
                      <TableCell className="font-semibold text-primary">{r.number}</TableCell>
                      <TableCell>{r.requester.name}{user?.id === r.requester.id ? " (você)" : ""}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.sector ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{r.itemCount}</TableCell>
                      <TableCell className="text-right text-muted-foreground hidden md:table-cell">{formatNumber(r.totalQty)}</TableCell>
                      <TableCell>
                        <RequisitionStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                        {new Date(r.createdAt).toLocaleDateString("pt-BR")}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova requisição</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Setor</Label>
                <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Ex.: Produção" />
              </div>
              <div className="space-y-2">
                <Label>Destino</Label>
                <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Itens</Label>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhum produto adicionado.
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((it, i) => (
                    <li key={it.product.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{it.product.name}</span>
                        <span className="text-xs text-muted-foreground">disp. {formatNumber(it.product.stock)} {UNITS[it.product.unit] ?? it.product.unit}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => setItems((prev) => prev.map((p, idx) => (idx === i ? { ...p, quantity: e.target.value } : p)))}
                          className="w-24"
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}>
                          <Plus className="h-4 w-4 rotate-45" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4" /> Adicionar produto
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={mutation.isPending || items.length === 0}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar requisição
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ProductPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addItem} excludeIds={items.map((i) => i.product.id)} />
    </div>
  );
}
