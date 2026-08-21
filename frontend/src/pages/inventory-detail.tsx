import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/services/api";
import type { Inventory } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { InventoryStatusBadge } from "@/components/badges";
import { useAuth } from "@/hooks/use-auth";

const STATUS_ACTIONS: Record<string, { to: string; label: string }> = {
  OPEN: { to: "IN_PROGRESS", label: "Iniciar contagem" },
  IN_PROGRESS: { to: "CONCLUDED", label: "Concluir inventário" },
};

export function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [adjusting, setAdjusting] = useState<{ itemId: string; reason: string } | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["inventory", id],
    queryFn: () => apiGet<{ data: Inventory }>(`/inventory/${id}`),
    enabled: Boolean(id),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiPatch(`/inventory/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Status atualizado");
      queryClient.invalidateQueries({ queryKey: ["inventory", id] });
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao atualizar status"),
  });

  const countMutation = useMutation({
    mutationFn: ({ itemId, countedQty }: { itemId: string; countedQty: number }) =>
      apiPatch(`/inventory/${id}/items/${itemId}/count`, { countedQty }),
    onSuccess: () => {
      toast.success("Contagem registrada");
      queryClient.invalidateQueries({ queryKey: ["inventory", id] });
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao registrar contagem"),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) => apiPost(`/inventory/${id}/items/${itemId}/adjust`, { reason }),
    onSuccess: () => {
      toast.success("Estoque ajustado");
      queryClient.invalidateQueries({ queryKey: ["inventory", id] });
      setAdjusting(null);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao ajustar estoque"),
  });

  if (isLoading) return <TableSkeleton rows={10} cols={5} />;
  if (isError || !data?.data) return <EmptyState title="Erro ao carregar inventário" action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>} />;

  const inv = data.data;
  const items = inv.items ?? [];
  const progress = inv.itemCount > 0 ? Math.round(((inv.counted ?? 0) / inv.itemCount) * 100) : 0;
  const nextAction = STATUS_ACTIONS[inv.status];
  const editable = inv.status !== "CONCLUDED" && inv.status !== "CANCELLED";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{inv.name}</h1>
              <InventoryStatusBadge status={inv.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Iniciado por {inv.startedBy.name} em {new Date(inv.createdAt).toLocaleDateString("pt-BR")}
              {inv.concludedAt ? ` · Concluído em ${new Date(inv.concludedAt).toLocaleDateString("pt-BR")}` : ""}
            </p>
          </div>
        </div>
        {can("inventory.update") && nextAction && (
          <Button onClick={() => statusMutation.mutate(nextAction.to)} disabled={statusMutation.isPending}>
            {statusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {nextAction.label}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Itens</p>
            <p className="mt-1 text-2xl font-bold">{inv.itemCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Conferidos</p>
            <p className="mt-1 text-2xl font-bold">{inv.counted ?? 0}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Divergências</p>
            <p className={`mt-1 text-2xl font-bold ${(inv.divergences ?? 0) > 0 ? "text-red-600" : ""}`}>{inv.divergences ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Produtos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState icon={Package} title="Sem itens" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Contado</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Status</TableHead>
                    {editable && <TableHead className="w-[220px]">Ação</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const diff = item.difference;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.product.code} · {item.product.warehouse?.name ?? "Sem almoxarifado"}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatNumber(item.expectedQty)} <span className="text-xs font-normal text-muted-foreground">{UNITS[item.product.unit] ?? item.product.unit}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.countedQty != null ? formatNumber(item.countedQty) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {diff != null ? (
                            <span className={`font-semibold ${diff === 0 ? "text-green-600" : "text-red-600"}`}>
                              {diff > 0 ? "+" : ""}
                              {formatNumber(diff)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {item.status === "PENDING" ? (
                            <Badge variant="muted">Pendente</Badge>
                          ) : item.status === "COUNTED" ? (
                            <Badge variant="secondary">Contado</Badge>
                          ) : (
                            <Badge variant="success">Ajustado</Badge>
                          )}
                        </TableCell>
                        {editable && (
                          <TableCell>
                            {item.status === "ADJUSTED" ? (
                              <span className="text-xs text-muted-foreground">Estoque sincronizado</span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  placeholder="Qtd."
                                  value={counts[item.id] ?? ""}
                                  onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  className="h-8 w-20"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => {
                                    const q = Number.parseInt(counts[item.id], 10);
                                    if (!Number.isInteger(q) || q < 0) return toast.error("Informe uma contagem válida");
                                    countMutation.mutate({ itemId: item.id, countedQty: q });
                                  }}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                {item.countedQty != null && diff != null && diff !== 0 && can("inventory.adjust") && (
                                  adjusting?.itemId === item.id ? (
                                    <div className="flex items-center gap-1.5">
                                      <Input
                                        value={adjusting.reason}
                                        onChange={(e) => setAdjusting({ itemId: item.id, reason: e.target.value })}
                                        placeholder="Motivo"
                                        className="h-8 w-32"
                                      />
                                      <Button
                                        size="sm"
                                        className="h-8"
                                        onClick={() => adjustMutation.mutate({ itemId: item.id, reason: adjusting.reason })}
                                        disabled={adjustMutation.isPending || adjusting.reason.trim().length < 3}
                                      >
                                        <Loader2 className={`h-4 w-4 ${adjustMutation.isPending ? "animate-spin" : "hidden"}`} />
                                        Ajustar
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button size="sm" variant="ghost" className="h-8 text-primary" onClick={() => setAdjusting({ itemId: item.id, reason: "" })}>
                                      <RefreshCw className="h-4 w-4" /> Ajustar
                                    </Button>
                                  )
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
