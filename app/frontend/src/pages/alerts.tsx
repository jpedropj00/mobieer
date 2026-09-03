import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, CircleAlert, PackageX, TriangleAlert } from "lucide-react";
import { apiGet } from "@/services/api";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { StockStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";

type Alert = {
  productId: string;
  name: string;
  code: string;
  unit: string;
  stock: number;
  minStock: number;
  maxStock: number | null;
  status: string;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  location: string | null;
};

export function AlertsPage() {
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["stock", "alerts"],
    queryFn: () => apiGet<{ data: { alerts: Alert[]; counts: { normal: number; atencao: number; critico: number; semEstoque: number } } }>("/stock/alerts"),
  });

  const alerts = data?.data.alerts ?? [];
  const counts = data?.data.counts ?? { normal: 0, atencao: 0, critico: 0, semEstoque: 0 };

  const stats = [
    { label: "Sem estoque", value: counts.semEstoque, icon: PackageX, className: "text-muted-foreground" },
    { label: "Críticos", value: counts.critico, icon: CircleAlert, className: "text-red-600" },
    { label: "Atenção", value: counts.atencao, icon: TriangleAlert, className: "text-amber-600" },
    { label: "Normal", value: counts.normal, icon: AlertTriangle, className: "text-green-600" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Alertas de estoque" description="Produtos com estoque igual ou abaixo do mínimo.">
        <Button onClick={() => navigate("/entrada")}>
          <ArrowDownToLine className="h-4 w-4" /> Registrar entrada
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-5">
              <s.icon className={`h-8 w-8 ${s.className}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar alertas" description="Não foi possível buscar os dados." action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>} />
        ) : alerts.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nenhum alerta ativo" description="Todos os produtos estão acima do estoque mínimo." />
        ) : (
          <div className="divide-y">
            {alerts.map((a) => (
              <div
                key={a.productId}
                className="flex cursor-pointer flex-col gap-3 px-5 py-4 hover:bg-muted/40 sm:flex-row sm:items-center"
                onClick={() => navigate(`/produtos/${a.productId}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{a.name}</p>
                    <StockStatusBadge status={a.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.code} · {a.category?.name ?? "Sem categoria"}
                    {a.supplier ? ` · ${a.supplier.name}` : ""}
                  </p>
                  {a.location && <p className="mt-0.5 text-xs text-muted-foreground">{a.location}</p>}
                </div>
                <div className="flex items-center gap-6 sm:shrink-0">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Atual</p>
                    <p className="font-semibold text-red-600">
                      {formatNumber(a.stock)} {UNITS[a.unit] ?? a.unit}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Mínimo</p>
                    <p className="font-semibold">
                      {formatNumber(a.minStock)} {UNITS[a.unit] ?? a.unit}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
