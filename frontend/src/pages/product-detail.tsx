import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Pencil, Package, Tag, Truck } from "lucide-react";
import { apiGet } from "@/services/api";
import type { Product } from "@/types";
import { formatCurrency, formatNumber, UNITS } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { MovementBadge, StockStatusBadge } from "@/components/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductFormDialog } from "@/features/products/product-form-dialog";
import { useState } from "react";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["product", id],
    queryFn: () => apiGet<{ data: Product }>(`/products/${id}`),
    enabled: Boolean(id),
  });

  const { data: historyData } = useQuery({
    queryKey: ["product-history", id],
    queryFn: () => apiGet<{ data: { movements: { id: string; type: string; quantity: number; date: string; responsible: { name: string } | null; note: string | null; balanceAfter: number }[] } }>(`/reports/product/${id}/history`),
    enabled: Boolean(id),
  });

  if (isLoading) return <TableSkeleton rows={8} cols={4} />;
  if (isError || !data?.data) return <ErrorState />;

  const p = data.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{p.name}</h1>
              <StockStatusBadge status={p.stockStatus} />
              {p.status === "INACTIVE" && <Badge variant="muted">Inativo</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {p.code} {p.sku ? `· SKU ${p.sku}` : ""} · cadastrado em {new Date(p.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setDialogOpen(true)}>
          <Pencil className="h-4 w-4" /> Editar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Estoque atual" value={`${formatNumber(p.stock)}`} sub={UNITS[p.unit] ?? p.unit} highlight />
        <InfoCard label="Estoque mínimo" value={formatNumber(p.minStock)} sub="mínimo" />
        <InfoCard label="Estoque máximo" value={p.maxStock ? formatNumber(p.maxStock) : "—"} sub="máximo" />
        <InfoCard label="Valor unitário" value={formatCurrency(p.unitValue)} sub="por unidade" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Informações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Tag className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">Categoria</p>
                <p className="text-muted-foreground">{p.category?.name ?? "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">Fornecedor</p>
                <p className="text-muted-foreground">{p.supplier?.name ?? "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">Localização</p>
                <p className="text-muted-foreground">{p.location?.full ?? "Não definida"}</p>
              </div>
            </div>
            {p.description && (
              <div>
                <p className="font-medium">Descrição</p>
                <p className="text-muted-foreground">{p.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Histórico de movimentações</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!historyData ? (
              <TableSkeleton rows={6} cols={4} />
            ) : historyData?.data.movements.length === 0 ? (
              <div className="px-5 pb-8 pt-4 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="text-right">Saldo após</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData?.data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(m.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <MovementBadge type={m.type as "ENTRY" | "EXIT" | "ADJUST"} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatNumber(m.quantity)}</TableCell>
                      <TableCell>{m.responsible?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold text-muted-foreground">{formatNumber(m.balanceAfter)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ProductFormDialog open={dialogOpen} onOpenChange={setDialogOpen} product={p} />
    </div>
  );
}

function InfoCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${highlight ? "text-primary" : ""}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
