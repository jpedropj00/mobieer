import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Factory,
  LifeBuoy,
  Loader2,
  Ruler,
  Settings2,
  Table2,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageSkeleton } from "@/components/ui/states";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type BreakEven = {
  source: { fixedCost: "CALCULADO" | "MANUAL"; margin: "CALCULADO" | "MANUAL" };
  referenceMonths: number;
  configuredReferenceMonths: number;
  averageMonthlyRevenue: number;
  averageMonthlyVariableCost: number;
  fixedCostMonthly: number;
  calculatedFixedCostMonthly: number;
  contributionMarginPct: number | null;
  calculatedContributionMarginPct: number | null;
  breakEvenRevenue: number | null;
  currentMonthRevenue: number;
  projectedMonthRevenue: number;
  progressPct: number | null;
  missingRevenue: number | null;
  reached: boolean;
  projectedToReach: boolean;
  averageTicket: number | null;
  ticketSample: number;
  salesNeededPerMonth: number | null;
  salesStillNeeded: number | null;
  topFixedCosts: { category: string; monthly: number }[];
  topVariableCosts: { category: string; monthly: number }[];
  warnings: string[];
  config: { fixedCostMonthly?: number | null; contributionMarginPct?: number | null; referenceMonths?: number };
};

type Money = { total: number; count: number };
type Dashboard = {
  month: { year: number; month: number; day: number; daysInMonth: number };
  commercial: {
    salesCount: number;
    salesValue: number;
    salesValueChangePct: number | null;
    salesCountPrev: number;
    newLeads: number;
    newLeadsChangePct: number | null;
    openPipelineCount: number;
    openPipelineValue: number;
    averageTicket: number | null;
    conversion90dPct: number | null;
  } | null;
  finance: {
    revenue: number;
    expense: number;
    result: number;
    revenueChangePct: number | null;
    expenseChangePct: number | null;
    receivable30d: Money;
    payable30d: Money;
    overdueReceivable: Money;
    overduePayable: Money;
    series: { month: string; revenue: number; expense: number; result: number }[];
  } | null;
  operation: { inProduction: number; measurementsScheduled: number; openAssistances: number; unconfirmedVisits: number };
  breakEven: BreakEven | null;
};

// Paleta categórica validada (CVD e contraste) para as duas séries do gráfico.
const SERIES = { revenue: "#2a78d6", expense: "#eb6834" };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlCompact = (n: number) =>
  Math.abs(n) >= 1000 ? `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(n);
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function Change({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">sem base no mês anterior</span>;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs", good ? "text-success" : "text-destructive")}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
      <span className="text-muted-foreground"> vs. mesmo ponto do mês anterior</span>
    </span>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function StoreDashboardPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["store", "dashboard"], queryFn: () => apiGet<{ data: Dashboard }>("/store/dashboard") });
  const [showTable, setShowTable] = useState(false);

  if (!can("finance.read") && !can("commercial.read")) {
    return <p className="text-sm text-muted-foreground">Seu perfil não tem acesso ao painel da loja.</p>;
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar o painel")}</p>;
  const d = q.data!.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Painel da loja" description={`Resumo comercial e financeiro de ${MONTHS[d.month.month - 1]} (até o dia ${d.month.day}).`} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OpTile icon={Factory} label="Pedidos na fábrica / entrega" value={d.operation.inProduction} to="/producao" />
        <OpTile icon={Ruler} label="Medições agendadas" value={d.operation.measurementsScheduled} to="/medicoes" />
        <OpTile icon={LifeBuoy} label="Assistências abertas" value={d.operation.openAssistances} to="/pipeline" />
        <OpTile
          icon={CalendarClock}
          label="Visitas sem confirmação (48h)"
          value={d.operation.unconfirmedVisits}
          to="/pipeline"
          alert={d.operation.unconfirmedVisits > 0}
        />
      </div>

      {d.commercial && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comercial</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={`Vendas no mês (${d.commercial.salesCount})`} value={brl(d.commercial.salesValue)}>
              <Change pct={d.commercial.salesValueChangePct} />
            </Tile>
            <Tile label="Novos leads no mês" value={String(d.commercial.newLeads)}>
              <Change pct={d.commercial.newLeadsChangePct} />
            </Tile>
            <Tile label={`Em negociação (${d.commercial.openPipelineCount})`} value={brl(d.commercial.openPipelineValue)}>
              <Link to="/comercial" className="text-xs text-primary hover:underline">
                ver funil
              </Link>
            </Tile>
            <Tile label="Ticket médio (6 meses)" value={d.commercial.averageTicket != null ? brl(d.commercial.averageTicket) : "—"}>
              <span className="text-xs text-muted-foreground">
                conversão lead → venda (90 dias): {d.commercial.conversion90dPct != null ? `${d.commercial.conversion90dPct.toLocaleString("pt-BR")}%` : "—"}
              </span>
            </Tile>
          </div>
        </section>
      )}

      {d.breakEven && <BreakEvenCard be={d.breakEven} canManage={can("finance.manage")} daysLeft={d.month.daysInMonth - d.month.day} />}

      {d.finance && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Financeiro</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Receitas recebidas no mês" value={brl(d.finance.revenue)}>
              <Change pct={d.finance.revenueChangePct} />
            </Tile>
            <Tile label="Despesas pagas no mês" value={brl(d.finance.expense)}>
              <Change pct={d.finance.expenseChangePct} invert />
            </Tile>
            <Tile label="Resultado do mês" value={brl(d.finance.result)}>
              <span className={cn("text-xs", d.finance.result >= 0 ? "text-success" : "text-destructive")}>
                {d.finance.result >= 0 ? "positivo" : "negativo"}
              </span>
            </Tile>
            <Tile label="A receber / a pagar (30 dias)" value={`${brlCompact(d.finance.receivable30d.total)} / ${brlCompact(d.finance.payable30d.total)}`}>
              {(d.finance.overdueReceivable.count > 0 || d.finance.overduePayable.count > 0) && (
                <span className="inline-flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  vencidos: {brlCompact(d.finance.overdueReceivable.total)} a receber · {brlCompact(d.finance.overduePayable.total)} a pagar
                </span>
              )}
            </Tile>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">Receitas e despesas pagas por mês</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
                <Table2 className="mr-2 h-4 w-4" />
                {showTable ? "Ver gráfico" : "Ver tabela"}
              </Button>
            </CardHeader>
            <CardContent>
              {showTable ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2">Mês</th>
                        <th className="py-2 text-right">Receitas</th>
                        <th className="py-2 text-right">Despesas</th>
                        <th className="py-2 text-right">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.finance.series.map((r) => (
                        <tr key={r.month} className="border-b border-border/60">
                          <td className="py-2">{r.month}</td>
                          <td className="py-2 text-right tabular-nums">{brl(r.revenue)}</td>
                          <td className="py-2 text-right tabular-nums">{brl(r.expense)}</td>
                          <td className={cn("py-2 text-right tabular-nums", r.result < 0 && "text-destructive")}>{brl(r.result)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-[280px] w-full" role="img" aria-label="Gráfico de barras de receitas e despesas pagas por mês">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.finance.series} barGap={2} barCategoryGap="28%">
                      <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.6} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                        tickFormatter={(v: number) => brlCompact(v)}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                        contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v, name) => [brl(Number(v)), name]}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="revenue" name="Receitas" fill={SERIES.revenue} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="expense" name="Despesas" fill={SERIES.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function OpTile({ icon: Icon, label, value, to, alert }: { icon: typeof Factory; label: string; value: number; to: string; alert?: boolean }) {
  return (
    <Link to={to} className={cn("flex items-center gap-3 rounded-lg border bg-card p-4 transition hover:bg-muted/40", alert ? "border-warning/60" : "border-border")}>
      <Icon className={cn("h-5 w-5", alert ? "text-warning" : "text-primary")} />
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Link>
  );
}

function BreakEvenCard({ be, canManage, daysLeft }: { be: BreakEven; canManage: boolean; daysLeft: number }) {
  const [open, setOpen] = useState(false);
  const pct = be.progressPct ?? 0;
  const projectedPct = be.breakEvenRevenue ? Math.min(150, (be.projectedMonthRevenue / be.breakEvenRevenue) * 100) : 0;
  // escala do medidor vai até 150% da meta
  const toScale = (v: number) => `${Math.min(100, (v / 150) * 100)}%`;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ponto de equilíbrio</h2>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Ajustar cálculo
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="space-y-5 pt-6">
          {be.breakEvenRevenue === null ? (
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
              <div>
                <p className="font-medium">Ainda não dá para calcular</p>
                {be.warnings.map((w) => (
                  <p key={w} className="text-muted-foreground">{w}</p>
                ))}
                {canManage && <p className="text-muted-foreground">Você pode informar o custo fixo e a margem manualmente em “Ajustar cálculo”.</p>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">A loja precisa faturar por mês</p>
                  <p className="text-3xl font-semibold tabular-nums">{brl(be.breakEvenRevenue)}</p>
                  {be.salesNeededPerMonth != null && (
                    <p className="text-sm text-muted-foreground">
                      ≈ <strong className="text-foreground">{be.salesNeededPerMonth} venda(s)</strong> no ticket médio de {brl(be.averageTicket!)}
                    </p>
                  )}
                </div>
                {be.reached ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Equilíbrio atingido
                  </Badge>
                ) : be.projectedToReach ? (
                  <Badge variant="secondary" className="gap-1">
                    <Target className="h-3.5 w-3.5" /> No ritmo para atingir
                  </Badge>
                ) : (
                  <Badge variant="warning" className="gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Abaixo do ritmo
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <div className="relative h-3 rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={150} aria-valuenow={Math.round(pct)} aria-label="Faturamento do mês em relação ao ponto de equilíbrio">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: toScale(projectedPct) }} title="Projeção do mês" />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: toScale(pct) }} />
                  <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-foreground" style={{ left: toScale(100) }} aria-hidden />
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Faturado: <strong className="text-foreground">{brl(be.currentMonthRevenue)}</strong> ({pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)
                  </span>
                  <span>Projeção do mês: {brl(be.projectedMonthRevenue)}</span>
                  <span>▏equilíbrio</span>
                </div>
                {!be.reached && be.missingRevenue != null && (
                  <p className="text-sm">
                    Faltam <strong>{brl(be.missingRevenue)}</strong>
                    {be.salesStillNeeded != null && <> — cerca de <strong>{be.salesStillNeeded} venda(s)</strong></>} em {daysLeft} dia(s).
                  </p>
                )}
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <Info label="Custo fixo mensal" value={brl(be.fixedCostMonthly)} source={be.source.fixedCost} />
                <Info
                  label="Margem de contribuição"
                  value={be.contributionMarginPct != null ? `${be.contributionMarginPct.toLocaleString("pt-BR")}%` : "—"}
                  source={be.source.margin}
                />
                <Info label="Receita média de referência" value={brl(be.averageMonthlyRevenue)} source={null} />
              </div>

              {be.topFixedCosts.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">De onde vêm os custos (média dos últimos {be.referenceMonths} mês/meses)</summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <CostList title="Fixos" rows={be.topFixedCosts} />
                    <CostList title="Variáveis (sobem com a venda)" rows={be.topVariableCosts} />
                  </div>
                </details>
              )}
              {be.warnings.length > 0 && (
                <p className="text-xs text-muted-foreground">{be.warnings.join(" ")}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {canManage && <BreakEvenDialog open={open} onOpenChange={setOpen} be={be} />}
    </section>
  );
}

function Info({ label, value, source }: { label: string; value: string; source: "CALCULADO" | "MANUAL" | null }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
      {source && <p className="text-[11px] text-muted-foreground">{source === "MANUAL" ? "informado manualmente" : "calculado dos lançamentos"}</p>}
    </div>
  );
}

function CostList({ title, rows }: { title: string; rows: { category: string; monthly: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        rows.map((r) => (
          <div key={r.category} className="flex justify-between border-b border-border/60 py-1">
            <span className="truncate pr-2">{r.category}</span>
            <span className="tabular-nums">{brl(r.monthly)}</span>
          </div>
        ))
      )}
    </div>
  );
}

function BreakEvenDialog({ open, onOpenChange, be }: { open: boolean; onOpenChange: (v: boolean) => void; be: BreakEven }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fixed: be.config.fixedCostMonthly != null ? String(be.config.fixedCostMonthly) : "",
    margin: be.config.contributionMarginPct != null ? String(be.config.contributionMarginPct) : "",
    months: String(be.configuredReferenceMonths),
  });
  const save = useMutation({
    mutationFn: () =>
      apiPut("/store/break-even", {
        fixedCostMonthly: form.fixed.trim() === "" ? null : Number(form.fixed.replace(",", ".")),
        contributionMarginPct: form.margin.trim() === "" ? null : Number(form.margin.replace(",", ".")),
        referenceMonths: Number(form.months),
      }),
    onSuccess: () => {
      toast.success("Cálculo atualizado");
      qc.invalidateQueries({ queryKey: ["store", "dashboard"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar ponto de equilíbrio</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Por padrão tudo é calculado dos lançamentos pagos, separando custos fixos e variáveis pela classificação da DRE. Deixe um campo vazio para voltar ao calculado.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Custo fixo mensal (R$)</Label>
            <Input inputMode="decimal" placeholder={`calculado: ${Math.round(be.calculatedFixedCostMonthly)}`} value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Margem de contribuição (%)</Label>
            <Input
              inputMode="decimal"
              placeholder={be.calculatedContributionMarginPct != null ? `calculada: ${be.calculatedContributionMarginPct}` : "sem dados"}
              value={form.margin}
              onChange={(e) => setForm({ ...form, margin: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Meses de referência para a média</Label>
            <Input type="number" min={1} max={12} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
