import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  History,
  Loader2,
  PackageCheck,
  PackageSearch,
  Plus,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  Trophy,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn, formatCurrency, formatDate, localIsoDate } from "@/lib/utils";
import type {
  Paginated,
  PriceHistory,
  Product,
  PurchaseComparison,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestStatus,
  PurchaseSummary,
  PurchaseUrgency,
  ReplenishmentRow,
  Supplier,
  Warehouse,
} from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "danger" | "warning" | "muted";

const REQUEST_VARIANT: Record<PurchaseRequestStatus, BadgeVariant> = {
  REQUESTED: "warning",
  APPROVED: "default",
  REJECTED: "danger",
  ORDERED: "success",
  CANCELLED: "muted",
};
const ORDER_VARIANT: Record<PurchaseOrderStatus, BadgeVariant> = {
  DRAFT: "muted",
  SENT: "default",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "muted",
};
const URGENCY_LABEL: Record<PurchaseUrgency, string> = { LOW: "Baixa", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente" };
const URGENCY_VARIANT: Record<PurchaseUrgency, BadgeVariant> = { LOW: "muted", NORMAL: "secondary", HIGH: "warning", URGENT: "danger" };

const toDateInput = (v: string | null) => (v ? v.slice(0, 10) : "");
const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível concluir"));

// ============================================================
// Página
// ============================================================

export function PurchasesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("aba") ?? "solicitacoes");
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState<DraftItem[] | null>(null);
  const [newOrder, setNewOrder] = useState(false);

  // atalho vindo da requisição parada por falta de material
  const requisitionId = params.get("requisicao");
  useEffect(() => {
    if (requisitionId && can("purchases.request")) setNewRequest([emptyItem()]);
  }, [requisitionId, can]);

  const summary = useQuery({ queryKey: ["purchases", "summary"], queryFn: () => apiGet<{ data: PurchaseSummary }>("/purchases/summary") });
  const s = summary.data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Compras" description="Solicitação, aprovação, cotação, pedido e recebimento com entrada no estoque.">
        {can("purchases.manage") && (
          <Button variant="outline" onClick={() => setNewOrder(true)}>
            <ShoppingCart className="h-4 w-4" /> Pedido direto
          </Button>
        )}
        {can("purchases.request") && (
          <Button onClick={() => setNewRequest([emptyItem()])}>
            <Plus className="h-4 w-4" /> Nova solicitação
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard title="Aguardando aprovação" value={s?.awaitingApproval ?? "—"} icon={ClipboardList} />
        <KpiCard title="Aprovadas para cotar" value={s?.approved ?? "—"} icon={CheckCircle2} />
        <KpiCard title="Pedidos em aberto" value={s?.openOrders ?? "—"} icon={Truck} />
        <KpiCard title="Valor em aberto" value={s ? formatCurrency(s.openOrdersValue) : "—"} icon={ShoppingCart} />
        <KpiCard title="Entregas atrasadas" value={s?.lateOrders ?? "—"} icon={AlertTriangle} iconBg={s?.lateOrders ? "bg-destructive/10 text-destructive" : undefined} />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setParams((p) => {
            p.set("aba", v);
            return p;
          }, { replace: true });
        }}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          {can("purchases.request") && (
            <TabsTrigger value="reposicao">
              Reposição {s?.lowStockProducts ? <Badge variant="warning" className="ml-2">{s.lowStockProducts}</Badge> : null}
            </TabsTrigger>
          )}
          <TabsTrigger value="precos">Histórico de preço</TabsTrigger>
        </TabsList>
        <TabsContent value="solicitacoes">
          <RequestsTab onOpen={setOpenRequest} />
        </TabsContent>
        <TabsContent value="pedidos">
          <OrdersTab onOpen={setOpenOrder} />
        </TabsContent>
        {can("purchases.request") && (
          <TabsContent value="reposicao">
            <ReplenishmentTab onCreate={(items) => setNewRequest(items)} />
          </TabsContent>
        )}
        <TabsContent value="precos">
          <PriceHistoryTab />
        </TabsContent>
      </Tabs>

      {newRequest && (
        <NewRequestDialog
          initial={newRequest}
          requisitionId={requisitionId}
          onClose={() => {
            setNewRequest(null);
            if (requisitionId)
              setParams((p) => {
                p.delete("requisicao");
                return p;
              });
          }}
          onCreated={(id) => {
            setNewRequest(null);
            setTab("solicitacoes");
            setOpenRequest(id);
          }}
        />
      )}
      {newOrder && (
        <NewOrderDialog
          onClose={() => setNewOrder(false)}
          onCreated={(id) => {
            setNewOrder(false);
            setTab("pedidos");
            setOpenOrder(id);
          }}
        />
      )}
      {openRequest && (
        <RequestDialog
          id={openRequest}
          onClose={() => setOpenRequest(null)}
          onOpenOrder={(id) => {
            setOpenRequest(null);
            setTab("pedidos");
            setOpenOrder(id);
          }}
        />
      )}
      {openOrder && <OrderDialog id={openOrder} onClose={() => setOpenOrder(null)} />}
    </div>
  );
}

function useInvalidatePurchases() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["purchases"] });
}

// ============================================================
// Solicitações
// ============================================================

function RequestsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["purchases", "requests", status, search],
    queryFn: () => apiGet<{ data: PurchaseRequest[] }>("/purchases/requests", { status, search }),
  });
  const rows = q.data?.data ?? [];

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Número, motivo ou item..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os status</SelectItem>
            <SelectItem value="REQUESTED">Aguardando aprovação</SelectItem>
            <SelectItem value="APPROVED">Aprovadas</SelectItem>
            <SelectItem value="ORDERED">Pedido emitido</SelectItem>
            <SelectItem value="REJECTED">Recusadas</SelectItem>
            <SelectItem value="CANCELLED">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
      {q.isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhuma solicitação" description="Abra uma solicitação quando faltar material ou pela aba Reposição." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Solicitação</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead className="hidden md:table-cell">Solicitante</TableHead>
              <TableHead>Urgência</TableHead>
              <TableHead className="hidden md:table-cell">Cotações</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                <TableCell>
                  <p className="font-medium">{r.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.createdAt)}
                    {r.project ? ` · ${r.project.code}` : ""}
                    {r.neededBy ? ` · precisa até ${formatDate(r.neededBy)}` : ""}
                  </p>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <p className="truncate text-sm">{r.items.map((i) => `${i.quantity}× ${i.description}`).join(", ")}</p>
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.requester.name}</TableCell>
                <TableCell>
                  <Badge variant={URGENCY_VARIANT[r.urgency]}>{URGENCY_LABEL[r.urgency]}</Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.quotes.length}</TableCell>
                <TableCell>
                  <Badge variant={REQUEST_VARIANT[r.status]}>{r.statusLabel}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ------------------------------------------------------------
// Seletor de produto (ou item livre)
// ------------------------------------------------------------

type DraftItem = { key: string; productId: string | null; productLabel: string; description: string; quantity: number; unitPrice?: number };
let seq = 0;
const emptyItem = (): DraftItem => ({ key: `i${++seq}`, productId: null, productLabel: "", description: "", quantity: 1 });

function ProductPicker({ value, onPick }: { value: DraftItem; onPick: (p: { id: string; label: string; name: string } | null) => void }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["products", "picker", term],
    queryFn: () => apiGet<Paginated<Product[]>>("/products", { search: term, perPage: 8, status: "ACTIVE" }),
    enabled: open && term.length >= 2,
  });
  if (value.productId) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
        <span className="truncate">{value.productLabel}</span>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onPick(null)} aria-label="Trocar produto">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        placeholder="Buscar produto do estoque..."
        value={term}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
      />
      {open && term.length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {q.isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Buscando...</p>
          ) : (q.data?.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhum produto. Deixe em branco e descreva o item ao lado.</p>
          ) : (
            q.data!.data.map((p) => (
              <button
                type="button"
                key={p.id}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick({ id: p.id, label: `${p.code} · ${p.name}`, name: p.name });
                  setTerm("");
                  setOpen(false);
                }}
              >
                <span className="truncate">
                  <span className="text-muted-foreground">{p.code}</span> {p.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">estoque {p.stock}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ItemsEditor({ items, onChange, withPrice }: { items: DraftItem[]; onChange: (items: DraftItem[]) => void; withPrice?: boolean }) {
  const patch = (key: string, p: Partial<DraftItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...p } : i)));
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <Label className="text-xs">Produto</Label>
            <ProductPicker
              value={i}
              onPick={(p) => patch(i.key, p ? { productId: p.id, productLabel: p.label, description: i.description || p.name } : { productId: null, productLabel: "" })}
            />
          </div>
          <div className={withPrice ? "sm:col-span-3" : "sm:col-span-4"}>
            <Label className="text-xs">Descrição {i.productId ? "" : "*"}</Label>
            <Input value={i.description} placeholder={i.productId ? "(nome do produto)" : "Item fora do cadastro"} onChange={(e) => patch(i.key, { description: e.target.value })} />
          </div>
          <div className={withPrice ? "sm:col-span-1" : "sm:col-span-2"}>
            <Label className="text-xs">Qtd *</Label>
            <Input type="number" min={1} value={i.quantity} onChange={(e) => patch(i.key, { quantity: Number(e.target.value) })} />
          </div>
          {withPrice && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Preço unit. *</Label>
              <Input type="number" min={0} step="0.01" value={i.unitPrice ?? ""} onChange={(e) => patch(i.key, { unitPrice: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </div>
          )}
          <div className="flex items-end sm:col-span-1">
            <Button type="button" variant="ghost" size="icon" disabled={items.length === 1} onClick={() => onChange(items.filter((x) => x.key !== i.key))} aria-label="Remover item">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, emptyItem()])}>
        <Plus className="h-4 w-4" /> Item
      </Button>
    </div>
  );
}

function NewRequestDialog({
  initial,
  requisitionId,
  onClose,
  onCreated,
}: {
  initial: DraftItem[];
  requisitionId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const invalidate = useInvalidatePurchases();
  const [items, setItems] = useState<DraftItem[]>(initial);
  const [urgency, setUrgency] = useState<PurchaseUrgency>("NORMAL");
  const [neededBy, setNeededBy] = useState("");
  const [reason, setReason] = useState(requisitionId ? "Requisição parada aguardando material" : "");
  const [projectId, setProjectId] = useState("");
  const projects = useQuery({
    queryKey: ["business-projects", "picklist"],
    queryFn: () => apiGet<{ data: { id: string; code: string; name: string }[] }>("/business/projects"),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      apiPost<{ data: PurchaseRequest; message: string }>("/purchases/requests", {
        urgency,
        neededBy: neededBy || null,
        reason: reason || null,
        projectId: projectId || null,
        requisitionId: requisitionId || null,
        items: items.map((i) => ({ productId: i.productId, description: i.description || null, quantity: i.quantity })),
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
      onCreated(r.data.id);
    },
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova solicitação de compra</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ItemsEditor items={items} onChange={setItems} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Urgência</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as PurchaseUrgency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(URGENCY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Precisa até</Label>
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Projeto (opcional)</Label>
              <Select value={projectId || "NONE"} onValueChange={(v) => setProjectId(v === "NONE" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sem projeto (estoque geral)</SelectItem>
                  {(projects.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Para que é a compra?" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar para aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Detalhe da solicitação: aprovação, cotações e comparação
// ------------------------------------------------------------

function RequestDialog({ id, onClose, onOpenOrder }: { id: string; onClose: () => void; onOpenOrder: (id: string) => void }) {
  const { can, user } = useAuth();
  const invalidate = useInvalidatePurchases();
  const q = useQuery({ queryKey: ["purchases", "request", id], queryFn: () => apiGet<{ data: PurchaseRequest }>(`/purchases/requests/${id}`) });
  const cmp = useQuery({
    queryKey: ["purchases", "request", id, "comparison"],
    queryFn: () => apiGet<{ data: PurchaseComparison }>(`/purchases/requests/${id}/comparison`),
  });
  const [note, setNote] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);

  const act = useMutation({
    mutationFn: (fn: () => Promise<{ message?: string }>) => fn(),
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      invalidate();
    },
    onError: fail,
  });

  const r = q.data?.data;
  const c = cmp.data?.data;
  const canQuote = can("purchases.manage") && r && (r.status === "APPROVED" || r.status === "ORDERED");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {r?.number ?? "Solicitação"} {r && <Badge variant={REQUEST_VARIANT[r.status]}>{r.statusLabel}</Badge>}
            {r && <Badge variant={URGENCY_VARIANT[r.urgency]}>{URGENCY_LABEL[r.urgency]}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {q.isLoading || !r ? (
          <TableSkeleton rows={4} cols={3} />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Info label="Solicitante" value={r.requester.name} />
              <Info label="Aberta em" value={formatDate(r.createdAt, true)} />
              <Info label="Precisa até" value={r.neededBy ? formatDate(r.neededBy) : "—"} />
              <Info label="Projeto" value={r.project ? `${r.project.code} · ${r.project.name}` : "Estoque geral"} />
              <Info label="Requisição de origem" value={r.requisition?.number ?? "—"} />
              <Info label="Decisão" value={r.decidedBy ? `${r.decidedBy.name} em ${formatDate(r.decidedAt)}` : "—"} />
            </div>
            {r.reason && <p className="rounded-md bg-muted/50 p-3 text-sm">{r.reason}</p>}
            {r.decisionNote && (
              <p className="rounded-md border-l-4 border-warning bg-warning/10 p-3 text-sm">
                <strong>Nota da decisão:</strong> {r.decisionNote}
              </p>
            )}

            {/* Itens + comparação de preços por item */}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    {c?.quotes.map((qt) => (
                      <TableHead key={qt.id} className="text-right">
                        {qt.supplierName}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((i) => {
                    const row = c?.items.find((x) => x.requestItemId === i.id);
                    return (
                      <TableRow key={i.id}>
                        <TableCell>
                          <p className="font-medium">{i.description}</p>
                          {i.product && (
                            <p className="text-xs text-muted-foreground">
                              {i.product.code} · estoque {i.product.stock}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{i.quantity}</TableCell>
                        {c?.quotes.map((qt) => {
                          const price = row?.prices.find((p) => p.quoteId === qt.id)?.unitPrice ?? null;
                          const best = row?.bestQuoteId === qt.id;
                          return (
                            <TableCell key={qt.id} className={cn("text-right", best && "font-semibold text-success")}>
                              {price == null ? <span className="text-muted-foreground">não cotou</span> : formatCurrency(price)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  {c && c.quotes.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={2} className="text-right text-muted-foreground">
                          Frete
                        </TableCell>
                        {c.quotes.map((qt) => (
                          <TableCell key={qt.id} className="text-right">
                            {formatCurrency(qt.freight)}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={2} className="text-right font-medium">
                          Total · prazo
                        </TableCell>
                        {c.quotes.map((qt) => (
                          <TableCell key={qt.id} className="text-right">
                            <p className={cn("font-semibold", qt.id === c.cheapestCompleteQuoteId && "text-success")}>
                              {qt.id === c.cheapestCompleteQuoteId && <Trophy className="mr-1 inline h-3.5 w-3.5" />}
                              {formatCurrency(qt.total)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {qt.deliveryDays != null ? `${qt.deliveryDays} dia(s)` : "prazo não informado"}
                              {qt.id === c.fastestCompleteQuoteId && " · mais rápido"}
                            </p>
                            {!qt.complete && <p className="text-xs text-warning">faltam {qt.missingItems.length} item(ns)</p>}
                          </TableCell>
                        ))}
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Cotações */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Cotações</h3>
                {canQuote && (
                  <Button size="sm" variant="outline" onClick={() => setQuoteOpen(true)}>
                    <Plus className="h-4 w-4" /> Registrar cotação
                  </Button>
                )}
              </div>
              {r.quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {r.status === "REQUESTED" ? "As cotações entram depois da aprovação." : "Nenhuma cotação registrada ainda."}
                </p>
              ) : (
                <div className="space-y-2">
                  {r.quotes.map((qt) => {
                    const info = c?.quotes.find((x) => x.id === qt.id);
                    return (
                      <div key={qt.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3", qt.selected && "border-success bg-success/5")}>
                        <div>
                          <p className="font-medium">
                            {qt.supplier.name} {qt.selected && <Badge variant="success">Escolhida</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {info ? formatCurrency(info.total) : ""}
                            {qt.paymentTerms ? ` · ${qt.paymentTerms}` : ""}
                            {qt.validUntil ? ` · válida até ${formatDate(qt.validUntil)}` : ""}
                            {qt.notes ? ` · ${qt.notes}` : ""}
                          </p>
                        </div>
                        {can("purchases.manage") && !qt.selected && (r.status === "APPROVED" || r.status === "ORDERED") && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => {
                                if (confirm(`Excluir a cotação de ${qt.supplier.name}?`)) act.mutate(() => apiDelete(`/purchases/quotes/${qt.id}`));
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              disabled={act.isPending}
                              onClick={() => {
                                if (info && !info.complete && !confirm(`Esta cotação não cobre: ${info.missingItems.join(", ")}. Gerar pedido só com os itens cotados?`)) return;
                                act.mutate(async () => {
                                  const res = await apiPost<{ data: PurchaseOrder; message: string }>(`/purchases/quotes/${qt.id}/order`, {});
                                  onOpenOrder(res.data.id);
                                  return res;
                                });
                              }}
                            >
                              <ShoppingCart className="h-4 w-4" /> Gerar pedido
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {r.orders.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold">Pedidos gerados</h3>
                {r.orders.map((o) => (
                  <button key={o.id} className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => onOpenOrder(o.id)}>
                    <span>
                      <strong>{o.number}</strong> · {o.supplier.name}
                    </span>
                    <Badge variant={ORDER_VARIANT[o.status]}>{o.statusLabel}</Badge>
                  </button>
                ))}
              </div>
            )}

            {r.status === "REQUESTED" && can("purchases.approve") && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label>Observação da decisão (obrigatória para recusar)</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="text-destructive"
                    disabled={act.isPending}
                    onClick={() => act.mutate(() => apiPost(`/purchases/requests/${id}/decision`, { action: "REJECT", note }))}
                  >
                    Recusar
                  </Button>
                  <Button disabled={act.isPending} onClick={() => act.mutate(() => apiPost(`/purchases/requests/${id}/decision`, { action: "APPROVE", note }))}>
                    <CheckCircle2 className="h-4 w-4" /> Aprovar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          {r && (r.status === "REQUESTED" || r.status === "APPROVED") && (r.requester.id === user?.id || can("purchases.manage")) && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                if (confirm(`Cancelar a solicitação ${r.number}?`)) act.mutate(() => apiPost(`/purchases/requests/${id}/cancel`));
              }}
            >
              Cancelar solicitação
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
        {quoteOpen && r && <QuoteDialog request={r} onClose={() => setQuoteOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function useSuppliers() {
  return useQuery({ queryKey: ["suppliers", ""], queryFn: () => apiGet<{ data: Supplier[] }>("/suppliers") });
}

function QuoteDialog({ request, onClose }: { request: PurchaseRequest; onClose: () => void }) {
  const invalidate = useInvalidatePurchases();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [freight, setFreight] = useState("0");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  // editar a cotação que já existe para o fornecedor escolhido
  useEffect(() => {
    const ex = request.quotes.find((q) => q.supplier.id === supplierId);
    if (!ex) return;
    setPrices(Object.fromEntries(ex.items.map((i) => [i.requestItemId, String(i.unitPrice)])));
    setFreight(String(ex.freight));
    setDeliveryDays(ex.deliveryDays != null ? String(ex.deliveryDays) : "");
    setPaymentTerms(ex.paymentTerms ?? "");
    setValidUntil(toDateInput(ex.validUntil));
    setNotes(ex.notes ?? "");
  }, [supplierId, request.quotes]);

  const save = useMutation({
    mutationFn: () =>
      apiPost<{ message: string }>(`/purchases/requests/${request.id}/quotes`, {
        supplierId,
        freight: Number(freight || 0),
        deliveryDays: deliveryDays === "" ? null : Number(deliveryDays),
        paymentTerms: paymentTerms || null,
        validUntil: validUntil || null,
        notes: notes || null,
        prices: Object.entries(prices)
          .filter(([, v]) => v !== "")
          .map(([requestItemId, v]) => ({ requestItemId, unitPrice: Number(v) })),
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
      onClose();
    },
    onError: fail,
  });

  const active = (suppliers.data?.data ?? []).filter((s) => s.status === "ACTIVE");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cotação · {request.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Fornecedor *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o fornecedor" />
              </SelectTrigger>
              <SelectContent>
                {active.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {request.quotes.some((q) => q.supplier.id === s.id) ? " (já cotado — editar)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Preço unitário por item (deixe em branco o que o fornecedor não cotou)</Label>
            {request.items.map((i) => (
              <div key={i.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm">
                  {i.quantity}× {i.description}
                </span>
                <Input
                  className="w-36"
                  type="number"
                  min={0}
                  step="0.01"
                  value={prices[i.id] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Frete (R$)</Label>
              <Input type="number" min={0} step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Prazo de entrega (dias)</Label>
              <Input type="number" min={0} value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Condição de pagamento</Label>
              <Input value={paymentTerms} placeholder="Ex.: 30/60 dias, boleto" onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Válida até</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!supplierId || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar cotação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Pedidos
// ============================================================

function OrdersTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const q = useQuery({
    queryKey: ["purchases", "orders", status],
    queryFn: () => apiGet<{ data: PurchaseOrder[] }>("/purchases/orders", status === "LATE" ? { late: 1 } : { status }),
  });
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os pedidos</SelectItem>
            <SelectItem value="DRAFT">Rascunho</SelectItem>
            <SelectItem value="SENT">Enviados</SelectItem>
            <SelectItem value="PARTIALLY_RECEIVED">Recebidos parcialmente</SelectItem>
            <SelectItem value="RECEIVED">Recebidos</SelectItem>
            <SelectItem value="LATE">Entrega atrasada</SelectItem>
            <SelectItem value="CANCELLED">Cancelados</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => apiDownload("/purchases/orders/export.csv", `pedidos-de-compra-${localIsoDate()}.csv`).catch(fail)}
        >
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
      </CardContent>
      {q.isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title="Nenhum pedido" description="Pedidos nascem de uma cotação escolhida ou do botão Pedido direto." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pedido</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="hidden md:table-cell">Previsão</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id} className="cursor-pointer" onClick={() => onOpen(o.id)}>
                <TableCell>
                  <p className="font-medium">{o.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(o.createdAt)}
                    {o.request ? ` · ${o.request.number}` : " · direto"}
                    {o.project ? ` · ${o.project.code}` : ""}
                  </p>
                </TableCell>
                <TableCell>{o.supplier.name}</TableCell>
                <TableCell className={cn("hidden md:table-cell", o.late && "font-medium text-destructive")}>
                  {o.expectedDeliveryAt ? formatDate(o.expectedDeliveryAt) : "—"}
                  {o.late && " · atrasado"}
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(o.total)}</TableCell>
                <TableCell>
                  <Badge variant={ORDER_VARIANT[o.status]}>{o.statusLabel}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function OrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const invalidate = useInvalidatePurchases();
  const q = useQuery({ queryKey: ["purchases", "order", id], queryFn: () => apiGet<{ data: PurchaseOrder }>(`/purchases/orders/${id}`) });
  const [receiving, setReceiving] = useState(false);
  const [expected, setExpected] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (fn: () => Promise<{ message?: string }>) => fn(),
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      invalidate();
    },
    onError: fail,
  });

  const o = q.data?.data;
  const manage = can("purchases.manage");
  const open = o && (o.status === "DRAFT" || o.status === "SENT" || o.status === "PARTIALLY_RECEIVED");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Pedido {o?.number} {o && <Badge variant={ORDER_VARIANT[o.status]}>{o.statusLabel}</Badge>}
            {o?.late && <Badge variant="danger">Entrega atrasada</Badge>}
          </DialogTitle>
        </DialogHeader>
        {!o ? (
          <TableSkeleton rows={4} cols={4} />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Info label="Fornecedor" value={o.supplier.name} />
              <Info label="Contato" value={[o.supplier.phone, o.supplier.email].filter(Boolean).join(" · ") || "—"} />
              <Info label="Solicitação" value={o.request?.number ?? "Pedido direto"} />
              <Info label="Projeto" value={o.project ? `${o.project.code} · ${o.project.name}` : "Estoque geral"} />
              <Info label="Pagamento" value={o.paymentTerms ?? "—"} />
              <Info
                label="Conta a pagar"
                value={o.payable ? `${formatCurrency(o.payable.amount)} · ${o.payable.status.toLowerCase()} · vence ${formatDate(o.payable.dueDate)}` : "gerada ao enviar"}
              />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Previsão de entrega</Label>
                <Input
                  type="date"
                  className="w-44"
                  disabled={!manage || !open}
                  value={expected ?? toDateInput(o.expectedDeliveryAt)}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </div>
              {expected != null && expected !== toDateInput(o.expectedDeliveryAt) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    act.mutate(async () => {
                      const r = await apiPatch<{ message: string }>(`/purchases/orders/${id}`, { expectedDeliveryAt: expected || null });
                      setExpected(null);
                      return r;
                    })
                  }
                >
                  Salvar previsão
                </Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Pedido</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <p className="font-medium">{i.description}</p>
                        <p className="text-xs text-muted-foreground">{i.product ? `${i.product.code} · entra no estoque` : "fora do cadastro · não movimenta estoque"}</p>
                      </TableCell>
                      <TableCell className="text-right">{i.quantity}</TableCell>
                      <TableCell className={cn("text-right", i.pendingQty > 0 && i.receivedQty > 0 && "text-warning")}>
                        {i.receivedQty}
                        {i.pendingQty > 0 && <span className="text-xs text-muted-foreground"> (falta {i.pendingQty})</span>}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(i.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(i.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Frete
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(o.freight)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(o.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {o.receipts.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold">Recebimentos</h3>
                {o.receipts.map((r) => (
                  <div key={r.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">
                      {formatDate(r.receivedAt, true)} · {r.receivedBy?.name ?? "—"}
                      {r.invoiceNumber ? ` · NF ${r.invoiceNumber}` : ""}
                      {r.warehouse ? ` · ${r.warehouse.name}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {r.items
                        .map((ri) => {
                          const it = o.items.find((x) => x.id === ri.orderItemId);
                          return `${ri.quantity}× ${it?.description ?? "item"}`;
                        })
                        .join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {o.notes && <p className="whitespace-pre-line rounded-md bg-muted/50 p-3 text-sm">{o.notes}</p>}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {o && manage && (o.status === "DRAFT" || o.status === "SENT") && !o.items.some((i) => i.receivedQty > 0) && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                const reason = prompt(`Motivo do cancelamento do pedido ${o.number}:`);
                if (reason) act.mutate(() => apiPost(`/purchases/orders/${id}/cancel`, { reason }));
              }}
            >
              Cancelar pedido
            </Button>
          )}
          {o && manage && o.status === "DRAFT" && (
            <Button
              disabled={act.isPending}
              onClick={() => {
                if (confirm(`Enviar ${o.number} ao fornecedor? Isto lança ${formatCurrency(o.total)} em contas a pagar.`))
                  act.mutate(() => apiPost(`/purchases/orders/${id}/send`));
              }}
            >
              <Send className="h-4 w-4" /> Enviar ao fornecedor
            </Button>
          )}
          {o && manage && (o.status === "SENT" || o.status === "PARTIALLY_RECEIVED") && (
            <Button onClick={() => setReceiving(true)}>
              <PackageCheck className="h-4 w-4" /> Registrar recebimento
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
        {receiving && o && <ReceiveDialog order={o} onClose={() => setReceiving(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const invalidate = useInvalidatePurchases();
  const qc = useQueryClient();
  const pending = order.items.filter((i) => i.pendingQty > 0);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(pending.map((i) => [i.id, String(i.pendingQty)])));
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => apiGet<{ data: Warehouse[] }>("/warehouses"), retry: false });

  const save = useMutation({
    mutationFn: () =>
      apiPost<{ message: string }>(`/purchases/orders/${order.id}/receive`, {
        invoiceNumber: invoiceNumber || null,
        warehouseId: warehouseId || null,
        notes: notes || null,
        items: Object.entries(qty)
          .filter(([, v]) => Number(v) > 0)
          .map(([orderItemId, v]) => ({ orderItemId, quantity: Number(v) })),
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
      // o estoque mudou
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Recebimento · {order.number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Quantidade recebida agora</Label>
            {pending.map((i) => (
              <div key={i.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm">
                  {i.description}
                  <span className="block text-xs text-muted-foreground">
                    saldo {i.pendingQty}
                    {i.product ? "" : " · não movimenta estoque"}
                  </span>
                </span>
                <Input className="w-24" type="number" min={0} max={i.pendingQty} value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nota fiscal</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Almoxarifado</Label>
              <Select value={warehouseId || "DEFAULT"} onValueChange={(v) => setWarehouseId(v === "DEFAULT" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFAULT">Padrão de cada produto</SelectItem>
                  {(warehouses.data?.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Avarias, divergências..." />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const invalidate = useInvalidatePurchases();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [expected, setExpected] = useState("");
  const [freight, setFreight] = useState("0");
  const [paymentTerms, setPaymentTerms] = useState("");
  const total = useMemo(() => items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0) + Number(freight || 0), [items, freight]);

  const save = useMutation({
    mutationFn: () =>
      apiPost<{ data: PurchaseOrder; message: string }>("/purchases/orders", {
        supplierId,
        expectedDeliveryAt: expected || null,
        freight: Number(freight || 0),
        paymentTerms: paymentTerms || null,
        items: items.map((i) => ({ productId: i.productId, description: i.description || null, quantity: i.quantity, unitPrice: i.unitPrice ?? 0 })),
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
      onCreated(r.data.id);
    },
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pedido direto</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Para reposição de rotina com fornecedor já definido. Compras que precisam de aprovação devem passar por uma solicitação.</p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fornecedor *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {(suppliers.data?.data ?? [])
                    .filter((s) => s.status === "ACTIVE")
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Previsão de entrega</Label>
              <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Frete (R$)</Label>
              <Input type="number" min={0} step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Condição de pagamento</Label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
          </div>
          <ItemsEditor items={items} onChange={setItems} withPrice />
          <p className="text-right text-sm">
            Total: <strong>{formatCurrency(total)}</strong>
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!supplierId || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Criar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Reposição (estoque abaixo do mínimo)
// ============================================================

function ReplenishmentTab({ onCreate }: { onCreate: (items: DraftItem[]) => void }) {
  const q = useQuery({ queryKey: ["purchases", "replenishment"], queryFn: () => apiGet<{ data: ReplenishmentRow[] }>("/purchases/replenishment") });
  const rows = q.data?.data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    // pré-seleciona o que ainda precisa comprar (não coberto por pedido aberto)
    setSelected(new Set(rows.filter((r) => r.suggestedQty > 0).map((r) => r.id)));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Produtos no mínimo ou abaixo</CardTitle>
        <Button
          size="sm"
          disabled={!selected.size}
          onClick={() =>
            onCreate(
              rows
                .filter((r) => selected.has(r.id))
                .map((r) => ({ key: `i${++seq}`, productId: r.id, productLabel: `${r.code} · ${r.name}`, description: r.name, quantity: Math.max(1, r.suggestedQty) }))
            )
          }
        >
          <Plus className="h-4 w-4" /> Solicitar compra ({selected.size})
        </Button>
      </CardHeader>
      {q.isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nenhum produto abaixo do mínimo" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Estoque</TableHead>
              <TableHead className="text-right">Mínimo / ideal</TableHead>
              <TableHead className="text-right">A caminho</TableHead>
              <TableHead className="text-right">Sugerido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <input type="checkbox" className="h-4 w-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Selecionar ${r.name}`} />
                </TableCell>
                <TableCell>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.code}
                    {r.supplier ? ` · ${r.supplier.name}` : ""}
                  </p>
                </TableCell>
                <TableCell className={cn("text-right font-medium", r.stock === 0 && "text-destructive")}>{r.stock}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {r.minStock} / {r.maxStock ?? r.minStock * 2}
                </TableCell>
                <TableCell className="text-right">{r.onOrder || "—"}</TableCell>
                <TableCell className="text-right font-semibold">{r.suggestedQty || "coberto"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ============================================================
// Histórico de preço
// ============================================================

function PriceHistoryTab() {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<DraftItem>(emptyItem());
  const params = picked.productId ? { productId: picked.productId } : term.length >= 2 ? { search: term } : null;
  const q = useQuery({
    queryKey: ["purchases", "price-history", params],
    queryFn: () => apiGet<{ data: PriceHistory }>("/purchases/price-history", params!),
    enabled: !!params,
  });
  const h = q.data?.data;

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Produto do estoque</Label>
          <ProductPicker value={picked} onPick={(p) => setPicked(p ? { ...picked, productId: p.id, productLabel: p.label } : emptyItem())} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">ou item pela descrição</Label>
          <Input disabled={!!picked.productId} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Ex.: MDF 18" />
        </div>
      </CardContent>
      {!params ? (
        <EmptyState icon={History} title="Escolha um produto" description="Mostra os preços cotados e pagos, do mais recente ao mais antigo." />
      ) : q.isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !h || h.points.length === 0 ? (
        <EmptyState icon={History} title="Sem histórico para este item" />
      ) : (
        <>
          {h.stats && (
            <div className="grid gap-3 border-y p-4 text-sm sm:grid-cols-5">
              <Info label="Último pago" value={formatCurrency(h.stats.last)} />
              <Info label="Menor" value={formatCurrency(h.stats.min)} />
              <Info label="Maior" value={formatCurrency(h.stats.max)} />
              <Info label="Médio" value={formatCurrency(h.stats.avg)} />
              <Info
                label="Variação vs. anterior"
                value={
                  h.stats.change == null ? (
                    "—"
                  ) : (
                    <span className={h.stats.change > 0 ? "text-destructive" : "text-success"}>
                      {h.stats.change > 0 ? "+" : ""}
                      {h.stats.change}%
                    </span>
                  )
                }
              />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="hidden md:table-cell">Item</TableHead>
                <TableHead className="text-right">Preço unit.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {h.points.map((p, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(p.date)}</TableCell>
                  <TableCell>
                    <Badge variant={p.source === "ORDER" ? "success" : "muted"}>{p.source === "ORDER" ? "Pedido" : "Cotação"}</Badge>{" "}
                    <span className="text-xs text-muted-foreground">{p.reference}</span>
                  </TableCell>
                  <TableCell>{p.supplier.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{p.description}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(p.unitPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Card>
  );
}
