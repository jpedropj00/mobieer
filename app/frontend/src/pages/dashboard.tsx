import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowRight, Boxes, ClipboardList, FileClock, ListTodo, Package, Scale, Scissors } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/services/api";
import type { Dashboard } from "@/types";
import { KpiCard, KpiSkeleton } from "@/components/kpi-card";
import { MovementsChart } from "@/components/charts/movements-chart";
import { MovementBadge } from "@/components/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router-dom";
import { UsagePanel } from "@/features/stock/usage-panel";

export function DashboardPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<{ data: Dashboard }>("/dashboard"),
  });
  const taskMetrics = useQuery({ queryKey: ["kanban-metrics"], queryFn: () => apiGet<{ data: { mine:number; overdue:number; upcoming:number; urgent:number; completed:number } }>("/organization/metrics"), enabled: can("organization.read") });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <KpiSkeleton />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-[380px] animate-pulse rounded-xl bg-muted lg:col-span-2" />
          <div className="h-[380px] animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-10">
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  const { kpis, recentMovements, balance, requisitions, activities } = data.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Visão Geral</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gestão inteligente em um só lugar — {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="flex gap-2">
          {can("stock.entry") && (
            <Button onClick={() => navigate("/entrada")}>
              <ArrowDownToLine className="h-4 w-4" /> Registrar entrada
            </Button>
          )}
          {can("stock.exit") && (
            <Button variant="outline" onClick={() => navigate("/saida")}>
              <ArrowUpFromLine className="h-4 w-4" /> Registrar saída
            </Button>
          )}
        </div>
      </div>

      {can("requisitions.read") && <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" />Requisições de Peças</CardTitle><Link to="/requisicoes" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ver requisições <ArrowRight className="h-3.5 w-3.5" /></Link></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><MiniMetric label="Abertas" value={requisitions.open} /><MiniMetric label="Aguard. material" value={requisitions.waitingMaterial} /><MiniMetric label="Liberadas" value={requisitions.released} /><MiniMetric label="Em corte" value={requisitions.inCutting} icon={<Scissors className="h-4 w-4" />} /><MiniMetric label="Atrasadas" value={requisitions.overdue} danger /><MiniMetric label="Concluídas (30d)" value={requisitions.recentlyCompleted} /></div></CardContent></Card>}

      {can("activities.read") && <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><FileClock className="h-4 w-4 text-primary" />Relatórios de Atividades</CardTitle><Link to="/atividades" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ver atividades <ArrowRight className="h-3.5 w-3.5" /></Link></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><MiniMetric label="Realizadas hoje" value={activities.today} /><MiniMetric label="Em andamento" value={activities.inProgress} /><MiniMetric label="Concluídas" value={activities.completed} /><MiniMetric label="Com problemas" value={activities.withProblems} danger /><MiniMetric label="Horas registradas" value={activities.hours} /></div></CardContent></Card>}

      {can("organization.read") && taskMetrics.data && <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-primary" />Organização interna</CardTitle><Link to="/minhas-tarefas" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ver minhas tarefas <ArrowRight className="h-3.5 w-3.5" /></Link></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><MiniMetric label="Minhas tarefas" value={taskMetrics.data.data.mine}/><MiniMetric label="Atrasadas" value={taskMetrics.data.data.overdue} danger/><MiniMetric label="Próximos 7 dias" value={taskMetrics.data.data.upcoming}/><MiniMetric label="Urgentes" value={taskMetrics.data.data.urgent} danger/><MiniMetric label="Concluídas (30d)" value={taskMetrics.data.data.completed}/></div></CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard title="Itens cadastrados" value={formatNumber(kpis.totalItems)} icon={Package} iconBg="bg-primary/10" />
        <KpiCard title="Estoque total" value={formatNumber(kpis.totalStock)} unit="unidades" icon={Boxes} iconBg="bg-primary/10" />
        <KpiCard
          title="Entradas do mês"
          value={formatNumber(kpis.entriesMonth)}
          icon={ArrowDownToLine}
          iconBg="bg-success/10"
          change={kpis.previous.entriesChangePercent}
          changeLabel="vs. mês anterior"
        />
        <KpiCard
          title="Saídas do mês"
          value={formatNumber(kpis.exitsMonth)}
          icon={ArrowUpFromLine}
          iconBg="bg-destructive/10"
          change={kpis.previous.exitsChangePercent}
          changeLabel="vs. mês anterior"
        />
        <KpiCard
          title="Itens em alerta"
          value={formatNumber(kpis.alerts)}
          icon={AlertTriangle}
          iconBg="bg-warning/15"
          change={null}
          changeLabel={kpis.alerts > 0 ? "atenção necessária" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              Movimentações
            </CardTitle>
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{formatNumber(balance)} unidades em estoque</span>
          </CardHeader>
          <CardContent>
            <MovementsChart />
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Movimentações recentes</CardTitle>
            <Link to="/movimentacoes" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ver todas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentMovements.length === 0 ? (
              <div className="px-5 pb-8 pt-4 text-center text-sm text-muted-foreground">Nenhuma movimentação recente</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentMovements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="max-w-[140px]">
                        <p className="truncate font-medium">{m.product.name}</p>
                        <p className="text-xs text-muted-foreground">{m.product.code}</p>
                      </TableCell>
                      <TableCell>
                        <MovementBadge type={m.type} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatNumber(m.quantity)}</TableCell>
                      <TableCell className="max-w-[110px]">
                        <p className="truncate">{m.responsible?.name ?? "—"}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(m.date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      {can("stock.read") && <UsagePanel />}
    </div>
  );
}

function MiniMetric({ label, value, danger = false, icon }: { label: string; value: number; danger?: boolean; icon?: React.ReactNode }) {
  return <div className="rounded-lg border p-3"><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span>{icon}</div><p className={danger && value > 0 ? "mt-1 text-xl font-bold text-destructive" : "mt-1 text-xl font-bold"}>{value}</p></div>;
}
