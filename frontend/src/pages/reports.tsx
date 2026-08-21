import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BarChart3, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, getToken } from "@/services/api";
import type { Category, Movement } from "@/types";
import { formatCurrency, formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { MovementBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

const REPORT_TYPES = [
  { value: "stock", label: "Posição de estoque" },
  { value: "entries", label: "Entradas" },
  { value: "exits", label: "Saídas" },
  { value: "movements", label: "Movimentações" },
  { value: "low-stock", label: "Estoque baixo" },
  { value: "inactive-products", label: "Produtos sem saída" },
  { value: "inventories", label: "Inventários" },
  { value: "consumption-period", label: "Consumo por período" },
  { value: "consumption-sector", label: "Consumo por setor" },
  { value: "consumption-employee", label: "Consumo por colaborador" },
];

type Row = Record<string, unknown>;

function downloadExport(url: string) {
  const token = getToken();
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async (res) => {
      if (!res.ok) {
        let msg = `Erro ${res.status}`;
        try {
          const j = await res.json();
          msg = j.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] ?? "relatorio";
      const blob = await res.blob();
      const url2 = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url2;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url2);
    });
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return o.name ? String(o.name) : JSON.stringify(o);
  }
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).toLocaleDateString("pt-BR");
  return s;
}

export function ReportsPage() {
  const { can } = useAuth();
  const [type, setType] = useState("stock");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiGet<{ data: Category[] }>("/categories"),
    enabled: can("categories.read"),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["reports", type, filters],
    queryFn: () => apiGet<{ data: Row[] }>("/reports/" + type, filters),
  });

  const exportMutation = useMutation({
    mutationFn: (format: string) => downloadExport(`/api/reports/export/${type}?format=${format}` + toQuery(filters)),
    onSuccess: () => toast.success("Exportação iniciada"),
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao exportar"),
  });

  const setFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value.trim() }));
  };

  const rows = data?.data ?? [];

  if (!can("reports.read")) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Sem permissão</p>
        <p className="text-sm text-muted-foreground">Você não tem permissão para acessar relatórios.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios" description="Análises e exportações de dados do almoxarifado.">
        {can("reports.export") && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportMutation.mutate("pdf")} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportMutation.mutate("xlsx")} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
            </Button>
          </div>
        )}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Relatório</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Data inicial</Label>
            <Input type="date" value={filters.dateFrom ?? ""} onChange={(e) => setFilter("dateFrom", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Data final</Label>
            <Input type="date" value={filters.dateTo ?? ""} onChange={(e) => setFilter("dateTo", e.target.value)} />
          </div>
          {can("categories.read") && (
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={filters.categoryId ?? ""}
                onValueChange={(v) => setFilter("categoryId", v === "__all__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {categoriesData?.data.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(type === "exits" || type === "movements") && (
            <div className="space-y-2">
              <Label>Setor</Label>
              <Input placeholder="Ex.: Montagem" value={filters.sector ?? ""} onChange={(e) => setFilter("sector", e.target.value)} />
            </div>
          )}
          {type === "movements" && (
            <div className="space-y-2">
              <Label>Tipo de movimentação</Label>
              <Select
                value={filters.type ?? ""}
                onValueChange={(v) => setFilter("type", v === "__all__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  <SelectItem value="ENTRY">Entrada</SelectItem>
                  <SelectItem value="EXIT">Saída</SelectItem>
                  <SelectItem value="ADJUST">Ajuste</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-end">
            <Button variant="outline" onClick={() => refetch()}>
              Aplicar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar relatório" />
        ) : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="Sem dados para exibir" description="Ajuste os filtros ou escolha outro relatório." />
        ) : (
          <div className="overflow-x-auto">
            <ReportTable type={type} rows={rows} />
          </div>
        )}
      </Card>
    </div>
  );
}

function toQuery(filters: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) search.set(k, v);
  });
  const qs = search.toString();
  return qs ? `&${qs}` : "";
}

const COLUMNS: Record<string, { key: string; label: string }[]> = {
  stock: [
    { key: "code", label: "Código" },
    { key: "name", label: "Produto" },
    { key: "category", label: "Categoria" },
    { key: "warehouse", label: "Almoxarifado" },
    { key: "stock", label: "Estoque" },
    { key: "minStock", label: "Mínimo" },
    { key: "unitValue", label: "Valor unit." },
  ],
  low_stock: [
    { key: "code", label: "Código" },
    { key: "name", label: "Produto" },
    { key: "stock", label: "Estoque" },
    { key: "minStock", label: "Mínimo" },
    { key: "deficit", label: "Déficit" },
    { key: "category", label: "Categoria" },
  ],
  inactive_products: [
    { key: "code", label: "Código" },
    { key: "name", label: "Produto" },
    { key: "stock", label: "Estoque" },
    { key: "category", label: "Categoria" },
  ],
  inventories: [
    { key: "name", label: "Inventário" },
    { key: "status", label: "Status" },
    { key: "startedBy", label: "Iniciado por" },
    { key: "itemCount", label: "Itens" },
    { key: "createdAt", label: "Criado em" },
    { key: "concludedAt", label: "Concluído em" },
  ],
  consumption_period: [
    { key: "date", label: "Data" },
    { key: "quantity", label: "Quantidade" },
  ],
  consumption_sector: [
    { key: "sector", label: "Setor" },
    { key: "quantity", label: "Quantidade" },
  ],
  consumption_employee: [
    { key: "employee", label: "Colaborador" },
    { key: "quantity", label: "Quantidade" },
  ],
};

function ReportTable({ type, rows }: { type: string; rows: Row[] }) {
  if (["entries", "exits", "movements"].includes(type)) {
    const movements = rows as unknown as Movement[];
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Quantidade</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead className="hidden lg:table-cell">Referência</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(m.date).toLocaleDateString("pt-BR")}
              </TableCell>
              <TableCell>
                <MovementBadge type={m.type} />
              </TableCell>
              <TableCell>{m.product.name}</TableCell>
              <TableCell className="text-right font-semibold">
                {formatNumber(m.quantity)} {UNITS[m.product.unit] ?? m.product.unit}
              </TableCell>
              <TableCell>{m.responsible?.name ?? "—"}</TableCell>
              <TableCell className="hidden max-w-[180px] truncate lg:table-cell">{m.invoiceNumber ?? m.requesterName ?? m.reason ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const cols = COLUMNS[type] ?? [];
  if (cols.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {cols.map((c) => (
            <TableHead key={c.key}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {cols.map((c) => (
              <TableCell key={c.key} className={c.key === "stock" || c.key === "minStock" || c.key === "deficit" ? "text-right font-semibold" : ""}>
                {c.key === "unitValue" ? formatCurrency(Number(r[c.key])) : cellValue(r[c.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
