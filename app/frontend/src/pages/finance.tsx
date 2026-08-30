import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, ComposedChart, Bar, BarChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownCircle, ArrowUpCircle, Calculator, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage, formatCurrency } from "@/lib/utils";
import type { CashflowPoint, Dre, FinanceSummary, FinanceTransaction, RegimeTributario, TaxApuracao, TaxCompany, TaxRule } from "@/types";

const REGIME_LABEL: Record<RegimeTributario, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

const CATEGORIES: Record<"RECEITA" | "DESPESA", string[]> = {
  RECEITA: ["Contrato — sinal", "Contrato — parcela", "Assistência técnica", "Venda avulsa", "Outros"],
  DESPESA: ["Matéria-prima", "Ferragens", "Acabamento", "Folha de pagamento", "Frete", "Impostos", "Aluguel", "Serviços de terceiros", "Outros"],
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString("pt-BR", { month: "short" });
};

type Picklist = { id: string; name: string }[];

export function FinancePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("finance.manage");

  const [filters, setFilters] = useState({ type: "", status: "" });
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (filters.type) p.type = filters.type;
    if (filters.status) p.status = filters.status;
    return p;
  }, [filters]);

  const summary = useQuery({ queryKey: ["finance", "summary"], queryFn: () => apiGet<{ data: FinanceSummary }>("/finance/summary") });
  const txs = useQuery({
    queryKey: ["finance", "transactions", params],
    queryFn: () => apiGet<{ data: FinanceTransaction[] }>("/finance/transactions", params),
  });
  const projects = useQuery({ queryKey: ["business-projects", "picklist"], queryFn: () => apiGet<{ data: Picklist }>("/business/projects") });
  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: Picklist }>("/business/clients") });
  const suppliers = useQuery({ queryKey: ["suppliers", "picklist"], queryFn: () => apiGet<{ data: Picklist }>("/suppliers") });
  const cashflow = useQuery({ queryKey: ["finance", "cashflow"], queryFn: () => apiGet<{ data: CashflowPoint[] }>("/finance/cashflow", { back: 3, forward: 6 }) });
  const [dreRange, setDreRange] = useState({ from: `${new Date().getFullYear()}-01-01`, to: new Date().toISOString().slice(0, 10), base: "PAGO" });
  const dre = useQuery({
    queryKey: ["finance", "dre", dreRange],
    queryFn: () => apiGet<{ data: Dre }>("/finance/dre", { from: dreRange.from, to: dreRange.to, status: dreRange.base }),
  });
  const company = useQuery({ queryKey: ["finance", "tax", "company"], queryFn: () => apiGet<{ data: TaxCompany }>("/finance/tax/company") });
  const rules = useQuery({ queryKey: ["finance", "tax", "rules"], queryFn: () => apiGet<{ data: TaxRule[] }>("/finance/tax/rules") });

  const [comp, setComp] = useState<TaxCompany | null>(null);
  const currentComp = comp ?? company.data?.data ?? null;
  const saveCompany = useMutation({
    mutationFn: () =>
      apiPatch("/finance/tax/company", {
        regimeTributario: currentComp?.regimeTributario,
        cnae: currentComp?.cnae ?? "",
        uf: currentComp?.uf ?? "",
        municipio: currentComp?.municipio ?? "",
        inscricaoEstadual: currentComp?.inscricaoEstadual ?? "",
      }),
    onSuccess: () => {
      toast.success("Dados fiscais salvos");
      setComp(null);
      qc.invalidateQueries({ queryKey: ["finance", "tax"] });
      setApuracao(null);
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  const [fatInput, setFatInput] = useState("");
  const [apComp, setApComp] = useState(new Date().toISOString().slice(0, 7));
  const [apuracao, setApuracao] = useState<TaxApuracao | null>(null);
  const apurar = useMutation({
    mutationFn: () =>
      apiPost<{ data: TaxApuracao }>("/finance/tax/apurar", {
        competencia: apComp,
        ...(fatInput ? { faturamentoMensal: Number(fatInput) } : {}),
      }),
    onSuccess: (r) => setApuracao(r.data),
    onError: (e) => {
      setApuracao(null);
      toast.error(errorMessage(e, "Não foi possível apurar"));
    },
  });

  const [dialog, setDialog] = useState(false);
  const blank = { type: "DESPESA", category: "", amount: "", date: new Date().toISOString().slice(0, 10), dueDate: "", description: "", status: "PENDENTE", projectId: "", clientId: "", supplierId: "" };
  const [form, setForm] = useState(blank);

  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/finance/transactions", {
        type: form.type,
        category: form.category,
        amount: Number(form.amount),
        date: form.date,
        dueDate: form.dueDate || null,
        description: form.description || null,
        status: form.status,
        projectId: form.projectId || null,
        clientId: form.clientId || null,
        supplierId: form.supplierId || null,
      }),
    onSuccess: () => {
      toast.success("Lançamento registrado");
      setDialog(false);
      setForm(blank);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar")),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/finance/transactions/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/finance/transactions/${id}`),
    onSuccess: () => {
      toast.success("Lançamento removido");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  if (summary.isLoading) return <PageSkeleton />;
  const s = summary.data?.data;
  const rows = txs.data?.data ?? [];
  const chartData = (s?.porMes ?? []).map((m) => ({ mes: monthLabel(m.month), Receitas: m.receitas, Despesas: m.despesas }));

  return (
    <div className="space-y-6">
      <PageHeader title="Financeiro" description="Receitas, despesas e contas a pagar/receber.">
        {canManage && (
          <Button size="sm" onClick={() => setDialog(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo lançamento
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="resumo">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos ({rows.length})</TabsTrigger>
          <TabsTrigger value="fluxo">Fluxo de caixa</TabsTrigger>
          <TabsTrigger value="dre">DRE</TabsTrigger>
          <TabsTrigger value="impostos">Impostos</TabsTrigger>
        </TabsList>

        {/* ---- Resumo ---- */}
        <TabsContent value="resumo" className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard title="Receitas realizadas" value={formatCurrency(s?.totalReceitas ?? 0)} icon={ArrowUpCircle} iconBg="bg-success/10" />
            <KpiCard title="Despesas realizadas" value={formatCurrency(s?.totalDespesas ?? 0)} icon={ArrowDownCircle} iconBg="bg-destructive/10" />
            <KpiCard title="Saldo" value={formatCurrency(s?.saldo ?? 0)} icon={Wallet} />
            <KpiCard title="A receber" value={formatCurrency(s?.aReceber ?? 0)} icon={ArrowUpCircle} iconBg="bg-success/10" />
            <KpiCard title="A pagar" value={formatCurrency(s?.aPagar ?? 0)} icon={ArrowDownCircle} iconBg="bg-destructive/10" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receitas x Despesas — últimos meses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] w-full">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados no período</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v) => [formatCurrency(Number(v)), ""]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Receitas" fill="#15803d" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por categoria</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(s?.porCategoria ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
              ) : (
                s!.porCategoria.map((c) => (
                  <div key={`${c.type}-${c.category}`} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${c.type === "RECEITA" ? "bg-success" : "bg-destructive"}`} />
                      {c.category}
                    </span>
                    <span className="font-medium tabular-nums">{formatCurrency(c.total)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Lançamentos ---- */}
        <TabsContent value="lancamentos" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={filters.type || "ALL"} onValueChange={(v) => setFilters({ ...filters, type: v === "ALL" ? "" : v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os tipos</SelectItem>
                <SelectItem value="RECEITA">Receitas</SelectItem>
                <SelectItem value="DESPESA">Despesas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status || "ALL"} onValueChange={(v) => setFilters({ ...filters, status: v === "ALL" ? "" : v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os status</SelectItem>
                <SelectItem value="PENDENTE">Pendentes</SelectItem>
                <SelectItem value="PAGO">Pagos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {txs.isLoading ? (
            <PageSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState title="Nenhum lançamento" description="Registre receitas e despesas para acompanhar o caixa." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Vínculo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {fmtDate(t.date)}
                        {t.dueDate && t.status === "PENDENTE" && (
                          <span className="block text-xs text-muted-foreground">vence {fmtDate(t.dueDate)}</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <p className="truncate text-sm">{t.description || "—"}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.category}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.project ? `Proj. ${t.project.code}` : t.client ? t.client.name : t.supplier ? t.supplier.name : "—"}
                      </TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${t.type === "RECEITA" ? "text-success" : "text-destructive"}`}>
                        {t.type === "RECEITA" ? "+" : "−"} {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.status === "PAGO" ? "success" : "warning"}>{t.status === "PAGO" ? "Pago" : "Pendente"}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {canManage && t.status === "PENDENTE" && (
                          <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t.id, status: "PAGO" })}>
                            Marcar pago
                          </Button>
                        )}
                        {canManage && t.status === "PAGO" && (
                          <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t.id, status: "PENDENTE" })}>
                            Reabrir
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm("Remover este lançamento?")) remove.mutate(t.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ---- Fluxo de caixa ---- */}
        <TabsContent value="fluxo" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fluxo de caixa operacional — realizado e previsto</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                {(cashflow.data?.data ?? []).length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={cashflow.data!.data.map((p) => ({ ...p, mes: monthLabel(p.month) }))} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }} formatter={(v) => [formatCurrency(Number(v)), ""]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="entradas" name="Entradas (real.)" stackId="e" fill="#15803d" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="entradasPrevistas" name="Entradas (prev.)" stackId="e" fill="#86efac" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="saidas" name="Saídas (real.)" stackId="s" fill="#dc2626" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="saidasPrevistas" name="Saídas (prev.)" stackId="s" fill="#fca5a5" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="saldoAcumulado" name="Saldo acumulado" stroke="#ea580c" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">Saldo acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cashflow.data?.data ?? []).map((p) => (
                  <TableRow key={p.month}>
                    <TableCell className="text-sm">{monthLabel(p.month)}/{p.month.slice(0, 4)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-success">
                      {formatCurrency(p.entradas + p.entradasPrevistas)}
                      {p.entradasPrevistas > 0 && <span className="block text-xs text-muted-foreground">prev. {formatCurrency(p.entradasPrevistas)}</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-destructive">
                      {formatCurrency(p.saidas + p.saidasPrevistas)}
                      {p.saidasPrevistas > 0 && <span className="block text-xs text-muted-foreground">prev. {formatCurrency(p.saidasPrevistas)}</span>}
                    </TableCell>
                    <TableCell className={`text-right text-sm font-medium tabular-nums ${p.resultado >= 0 ? "text-success" : "text-destructive"}`}>{formatCurrency(p.resultado)}</TableCell>
                    <TableCell className={`text-right text-sm font-semibold tabular-nums ${p.saldoAcumulado >= 0 ? "text-foreground" : "text-destructive"}`}>{formatCurrency(p.saldoAcumulado)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---- DRE ---- */}
        <TabsContent value="dre" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="De">
              <Input type="date" value={dreRange.from} onChange={(e) => setDreRange({ ...dreRange, from: e.target.value })} />
            </Field>
            <Field label="Até">
              <Input type="date" value={dreRange.to} onChange={(e) => setDreRange({ ...dreRange, to: e.target.value })} />
            </Field>
            <Field label="Base">
              <Select value={dreRange.base} onValueChange={(v) => setDreRange({ ...dreRange, base: v })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAGO">Realizado (pagos)</SelectItem>
                  <SelectItem value="ALL">Competência (todos)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {dre.isLoading || !dre.data ? (
            <PageSkeleton />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Demonstrativo de Resultado — {dre.data.data.periodo.de} a {dre.data.data.periodo.ate}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">({dre.data.data.periodo.base})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receitas</p>
                {dre.data.data.receitas.length === 0 && <p className="text-muted-foreground">—</p>}
                {dre.data.data.receitas.map((r) => (
                  <div key={r.categoria} className="flex justify-between">
                    <span className="pl-3 text-muted-foreground">{r.categoria}</span>
                    <span className="tabular-nums text-success">{formatCurrency(r.valor)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <span>Total de receitas</span>
                  <span className="tabular-nums text-success">{formatCurrency(dre.data.data.totalReceitas)}</span>
                </div>

                <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">(−) Despesas</p>
                {dre.data.data.despesas.length === 0 && <p className="text-muted-foreground">—</p>}
                {dre.data.data.despesas.map((r) => (
                  <div key={r.categoria} className="flex justify-between">
                    <span className="pl-3 text-muted-foreground">{r.categoria}</span>
                    <span className="tabular-nums text-destructive">({formatCurrency(r.valor)})</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <span>Total de despesas</span>
                  <span className="tabular-nums text-destructive">({formatCurrency(dre.data.data.totalDespesas)})</span>
                </div>

                <div className="mt-4 flex justify-between border-t-2 border-foreground/20 pt-2 text-base font-bold">
                  <span>Resultado do período</span>
                  <span className={`tabular-nums ${dre.data.data.resultado >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatCurrency(dre.data.data.resultado)}
                  </span>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  Margem: {dre.data.data.margem}% · {dre.data.data.totalLancamentos} lançamento(s)
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Impostos ---- */}
        <TabsContent value="impostos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identidade fiscal da empresa</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Regime tributário">
                <Select
                  value={currentComp?.regimeTributario ?? "SIMPLES_NACIONAL"}
                  onValueChange={(v) => currentComp && setComp({ ...currentComp, regimeTributario: v as RegimeTributario })}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REGIME_LABEL) as RegimeTributario[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {REGIME_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="CNAE principal">
                <Input value={currentComp?.cnae ?? ""} disabled={!canManage} onChange={(e) => currentComp && setComp({ ...currentComp, cnae: e.target.value })} />
              </Field>
              <Field label="UF">
                <Input maxLength={2} value={currentComp?.uf ?? ""} disabled={!canManage} onChange={(e) => currentComp && setComp({ ...currentComp, uf: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Município">
                <Input value={currentComp?.municipio ?? ""} disabled={!canManage} onChange={(e) => currentComp && setComp({ ...currentComp, municipio: e.target.value })} />
              </Field>
              <Field label="Inscrição estadual">
                <Input value={currentComp?.inscricaoEstadual ?? ""} disabled={!canManage} onChange={(e) => currentComp && setComp({ ...currentComp, inscricaoEstadual: e.target.value })} />
              </Field>
              {canManage && (
                <div className="flex items-end">
                  <Button disabled={!comp || saveCompany.isPending} onClick={() => saveCompany.mutate()}>
                    {saveCompany.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Apuração de impostos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Competência">
                  <Input type="month" value={apComp} onChange={(e) => setApComp(e.target.value)} />
                </Field>
                <Field label="Faturamento (opcional)">
                  <Input type="number" placeholder="usa receitas pagas do mês" value={fatInput} onChange={(e) => setFatInput(e.target.value)} />
                </Field>
                <Button disabled={apurar.isPending} onClick={() => apurar.mutate()}>
                  {apurar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
                  Apurar
                </Button>
              </div>

              {apuracao && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-muted-foreground">
                      Regime: <span className="font-medium text-foreground">{REGIME_LABEL[apuracao.regime]}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Faturamento: <span className="font-medium text-foreground">{formatCurrency(apuracao.faturamento)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Carga efetiva: <span className="font-medium text-foreground">{apuracao.cargaEfetiva}%</span>
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Imposto</TableHead>
                          <TableHead className="text-right">Base</TableHead>
                          <TableHead className="text-right">Alíquota</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apuracao.impostos.map((i, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-sm">
                              {i.tipoImposto}
                              {i.descricao && <span className="block text-xs text-muted-foreground">{i.descricao}</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatCurrency(i.base)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{(i.aliquotaAplicada * 100).toFixed(2)}%</TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums">{formatCurrency(i.valor)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell className="text-sm font-semibold">Total de impostos</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right text-sm font-bold tabular-nums text-destructive">{formatCurrency(apuracao.totalImpostos)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Estimativa gerencial com base nas regras cadastradas. Não substitui a apuração fiscal oficial.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regras fiscais ({rules.data?.data.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regime</TableHead>
                      <TableHead>Imposto</TableHead>
                      <TableHead className="text-right">Alíquota</TableHead>
                      <TableHead className="text-right">Presunção</TableHead>
                      <TableHead>Faixa faturamento</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rules.data?.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{REGIME_LABEL[r.regimeTributario]}</TableCell>
                        <TableCell className="text-sm">
                          {r.tipoImposto}
                          {r.descricao && <span className="block text-xs text-muted-foreground">{r.descricao}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{(r.aliquota * 100).toFixed(2)}%</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.reducaoBase != null ? `${(r.reducaoBase * 100).toFixed(0)}%` : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.faixaFaturamentoMin != null || r.faixaFaturamentoMax != null
                            ? `${formatCurrency(r.faixaFaturamentoMin ?? 0)} – ${r.faixaFaturamentoMax != null ? formatCurrency(r.faixaFaturamentoMax) : "∞"}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.ativo ? "success" : "muted"}>{r.ativo ? "Ativa" : "Inativa"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Alíquotas de desenvolvimento — substitua por regras oficiais e vigentes antes de usar em produção.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---- Dialog ---- */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo lançamento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo">
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category: "" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECEITA">Receita</SelectItem>
                  <SelectItem value="DESPESA">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={form.category || "NONE"} onValueChange={(v) => setForm({ ...form, category: v === "NONE" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {CATEGORIES[form.type as "RECEITA" | "DESPESA"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="PAGO">Pago</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Data (competência)">
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Vencimento (opcional)">
              <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <Field label="Projeto (opcional)">
              <Picker value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} items={projects.data?.data ?? []} />
            </Field>
            {form.type === "RECEITA" ? (
              <Field label="Cliente (opcional)">
                <Picker value={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} items={clients.data?.data ?? []} />
              </Field>
            ) : (
              <Field label="Fornecedor (opcional)">
                <Picker value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} items={suppliers.data?.data ?? []} />
              </Field>
            )}
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Cancelar
            </Button>
            <Button
              disabled={create.isPending || !form.category || !(Number(form.amount) > 0) || !form.date}
              onClick={() => create.mutate()}
            >
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Picker({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: Picklist }) {
  return (
    <Select value={value || "NONE"} onValueChange={(v) => onChange(v === "NONE" ? "" : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Nenhum" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="NONE">Nenhum</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
