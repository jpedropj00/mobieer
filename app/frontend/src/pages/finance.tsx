import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, ComposedChart, Bar, BarChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownCircle, ArrowUpCircle, Calculator, CreditCard as CreditCardIcon, Layers, Loader2, Plus, Target, Trash2, Upload, Wallet } from "lucide-react";
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
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, apiPut } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage, formatCurrency } from "@/lib/utils";
import type { BreakEven, CardAnalysis, CardStatementDetail, CashflowPoint, CreditCard, Dre, FinanceSummary, FinanceTransaction, InstallmentGroup, RegimeTributario, TaxApuracao, TaxCompany, TaxRule } from "@/types";

const REGIME_LABEL: Record<RegimeTributario, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

const CATEGORIES: Record<"RECEITA" | "DESPESA", string[]> = {
  RECEITA: ["Contrato — sinal", "Contrato — parcela", "Assistência técnica", "Venda avulsa", "Outros"],
  DESPESA: ["Matéria-prima", "Ferragens", "Acabamento", "Folha de pagamento", "Frete", "Impostos", "Aluguel", "Serviços de terceiros", "Outros"],
};

const CARD_EXPENSE_CATEGORIES = ["Matéria-prima", "Ferragens", "Acabamento", "Combustível", "Alimentação", "Ferramentas", "Software / assinaturas", "Marketing", "Viagem", "Manutenção", "Outros"];

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
  const [dreRange, setDreRange] = useState({ from: `${new Date().getFullYear()}-01-01`, to: new Date().toISOString().slice(0, 10), basis: "accrual" });
  const dre = useQuery({
    queryKey: ["finance", "dre", dreRange],
    queryFn: () => apiGet<{ data: Dre }>("/finance/dre", { from: dreRange.from, to: dreRange.to, basis: dreRange.basis }),
  });
  const dreLines = useQuery({ queryKey: ["finance", "dre-lines"], queryFn: () => apiGet<{ data: { key: string; label: string }[] }>("/finance/dre/lines") });
  const dreMappings = useQuery({ queryKey: ["finance", "dre-mappings"], queryFn: () => apiGet<{ data: { category: string; dreLine: string }[] }>("/finance/dre/mappings") });
  const [mapEdits, setMapEdits] = useState<Record<string, string>>({});
  const saveMappings = useMutation({
    mutationFn: (all: { category: string; dreLine: string }[]) => apiPut("/finance/dre/mappings", { mappings: all }),
    onSuccess: () => {
      toast.success("Classificação salva");
      setMapEdits({});
      qc.invalidateQueries({ queryKey: ["finance", "dre"] });
      qc.invalidateQueries({ queryKey: ["finance", "dre-mappings"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const company = useQuery({ queryKey: ["finance", "tax", "company"], queryFn: () => apiGet<{ data: TaxCompany }>("/finance/tax/company") });
  const rules = useQuery({ queryKey: ["finance", "tax", "rules"], queryFn: () => apiGet<{ data: TaxRule[] }>("/finance/tax/rules") });
  const breakEven = useQuery({ queryKey: ["finance", "break-even"], queryFn: () => apiGet<{ data: BreakEven }>("/finance/break-even") });
  const cards = useQuery({ queryKey: ["finance", "cards"], queryFn: () => apiGet<{ data: CreditCard[] }>("/finance/cards") });
  const cardAnalysis = useQuery({ queryKey: ["finance", "cards", "analysis"], queryFn: () => apiGet<{ data: CardAnalysis }>("/finance/cards/analysis") });
  const installments = useQuery({ queryKey: ["finance", "installments"], queryFn: () => apiGet<{ data: InstallmentGroup[] }>("/finance/installments") });

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

  // ---- Ponto de equilíbrio ----
  const [beForm, setBeForm] = useState<{ fixedCostMonthly: string; contributionMarginPct: string } | null>(null);
  const be = breakEven.data?.data;
  const beEdit = beForm ?? (be ? { fixedCostMonthly: String(be.fixedCostMonthly), contributionMarginPct: String(be.contributionMarginPct) } : { fixedCostMonthly: "", contributionMarginPct: "" });
  const saveBreakEven = useMutation({
    mutationFn: () => apiPatch("/finance/break-even", { fixedCostMonthly: Number(beEdit.fixedCostMonthly || 0), contributionMarginPct: Number(beEdit.contributionMarginPct || 0) }),
    onSuccess: () => { toast.success("Ponto de equilíbrio atualizado"); setBeForm(null); qc.invalidateQueries({ queryKey: ["finance", "break-even"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  // ---- Compra parcelada ----
  const [instDialog, setInstDialog] = useState(false);
  const instBlank = { category: "", description: "", supplierId: "", firstDueDate: new Date().toISOString().slice(0, 10), installments: "12", totalAmount: "", method: "Cartão de crédito" };
  const [instForm, setInstForm] = useState(instBlank);
  const createInstallments = useMutation({
    mutationFn: () => apiPost("/finance/installments", {
      category: instForm.category,
      description: instForm.description || null,
      supplierId: instForm.supplierId || null,
      firstDueDate: instForm.firstDueDate,
      installments: Number(instForm.installments),
      totalAmount: Number(instForm.totalAmount),
      method: instForm.method || null,
    }),
    onSuccess: () => { toast.success("Compra parcelada lançada"); setInstDialog(false); setInstForm(instBlank); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao lançar")),
  });

  // ---- Cartões ----
  const [cardDialog, setCardDialog] = useState<null | "card" | "statement" | "expense">(null);
  const [cardForm, setCardForm] = useState({ name: "", lastDigits: "", closingDay: "", dueDay: "" });
  const [stmtForm, setStmtForm] = useState<{ cardId: string; referenceMonth: string; file: File | null }>({ cardId: "", referenceMonth: new Date().toISOString().slice(0, 7), file: null });
  const [openStatementId, setOpenStatementId] = useState<string | null>(null);
  const [expForm, setExpForm] = useState({ description: "", category: "", amount: "", date: new Date().toISOString().slice(0, 10), installment: "" });

  const statementDetail = useQuery({
    queryKey: ["finance", "cards", "statement", openStatementId],
    queryFn: () => apiGet<{ data: CardStatementDetail }>(`/finance/cards/statements/${openStatementId}`),
    enabled: Boolean(openStatementId),
  });
  const refreshCards = () => qc.invalidateQueries({ queryKey: ["finance", "cards"] });

  const createCard = useMutation({
    mutationFn: () => apiPost("/finance/cards", {
      name: cardForm.name,
      lastDigits: cardForm.lastDigits || null,
      closingDay: cardForm.closingDay ? Number(cardForm.closingDay) : null,
      dueDay: cardForm.dueDay ? Number(cardForm.dueDay) : null,
    }),
    onSuccess: () => { toast.success("Cartão cadastrado"); setCardDialog(null); setCardForm({ name: "", lastDigits: "", closingDay: "", dueDay: "" }); refreshCards(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao cadastrar")),
  });
  const uploadStatement = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("referenceMonth", stmtForm.referenceMonth);
      if (stmtForm.file) fd.append("file", stmtForm.file);
      return apiPostForm(`/finance/cards/${stmtForm.cardId}/statements`, fd);
    },
    onSuccess: (r: unknown) => {
      toast.success("Fatura registrada");
      setCardDialog(null);
      const id = (r as { data?: { id?: string } })?.data?.id ?? null;
      setOpenStatementId(id);
      setStmtForm({ cardId: "", referenceMonth: new Date().toISOString().slice(0, 7), file: null });
      refreshCards();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar fatura")),
  });
  const addExpense = useMutation({
    mutationFn: () => apiPost(`/finance/cards/statements/${openStatementId}/expenses`, {
      description: expForm.description,
      category: expForm.category,
      amount: Number(expForm.amount),
      date: expForm.date,
      installment: expForm.installment || null,
    }),
    onSuccess: () => {
      toast.success("Despesa adicionada");
      setExpForm({ description: "", category: "", amount: "", date: new Date().toISOString().slice(0, 10), installment: "" });
      statementDetail.refetch();
      qc.invalidateQueries({ queryKey: ["finance", "cards"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const removeExpense = useMutation({
    mutationFn: (id: string) => apiDelete(`/finance/cards/expenses/${id}`),
    onSuccess: () => { statementDetail.refetch(); qc.invalidateQueries({ queryKey: ["finance", "cards"] }); },
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
          <TabsTrigger value="cartoes">Cartões ({cards.data?.data.length ?? 0})</TabsTrigger>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> Ponto de equilíbrio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Custo fixo mensal (R$)">
                  <Input type="number" min="0" disabled={!canManage} value={beEdit.fixedCostMonthly}
                    onChange={(e) => setBeForm({ ...beEdit, fixedCostMonthly: e.target.value })} />
                </Field>
                <Field label="Margem de contribuição (%)">
                  <Input type="number" min="0" max="100" disabled={!canManage} value={beEdit.contributionMarginPct}
                    onChange={(e) => setBeForm({ ...beEdit, contributionMarginPct: e.target.value })} />
                </Field>
              </div>
              {canManage && (
                <Button size="sm" disabled={!beForm || saveBreakEven.isPending} onClick={() => saveBreakEven.mutate()}>
                  {saveBreakEven.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar parâmetros
                </Button>
              )}
              {be && (
                <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Faturamento de equilíbrio</span><span className="font-semibold tabular-nums">{be.breakEvenRevenue > 0 ? formatCurrency(be.breakEvenRevenue) : "— defina a margem"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Receita realizada no mês</span><span className="tabular-nums">{formatCurrency(be.currentMonthRevenue)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2 font-medium">
                    <span>{be.reached ? "Acima do equilíbrio" : "Falta para o equilíbrio"}</span>
                    <span className={`tabular-nums ${be.reached ? "text-success" : "text-destructive"}`}>{be.reached ? `+${formatCurrency(-be.gap)}` : formatCurrency(be.gap)}</span>
                  </div>
                  {be.breakEvenRevenue > 0 && (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${be.reached ? "bg-success" : "bg-warning"}`} style={{ width: `${Math.min(100, Math.round((be.currentMonthRevenue / be.breakEvenRevenue) * 100))}%` }} />
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Faturamento de equilíbrio = custo fixo ÷ margem de contribuição. Considera as receitas pagas do mês atual.</p>
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
            {canManage && (
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setInstForm(instBlank); setInstDialog(true); }}>
                <Layers className="mr-2 h-4 w-4" /> Compra parcelada
              </Button>
            )}
          </div>

          {(installments.data?.data ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Compras parceladas em aberto</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {installments.data!.data.map((g) => (
                  <div key={g.group} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                    <div>
                      <p className="font-medium">{g.category}{g.supplier ? ` · ${g.supplier}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.count}x · pago {formatCurrency(g.paid)} de {formatCurrency(g.total)}
                        {g.nextDue ? ` · próxima ${fmtDate(g.nextDue)}` : ""}
                      </p>
                    </div>
                    <span className="tabular-nums font-semibold">{formatCurrency(g.total - g.paid)}<span className="ml-1 text-xs font-normal text-muted-foreground">restante</span></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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

        {/* ---- Cartões ---- */}
        <TabsContent value="cartoes" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Faturas de cartão de crédito e gastos por categoria.</p>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setStmtForm({ cardId: cards.data?.data[0]?.id ?? "", referenceMonth: new Date().toISOString().slice(0, 7), file: null }); setCardDialog("statement"); }} disabled={!cards.data?.data.length}>
                  <Upload className="mr-2 h-4 w-4" /> Enviar fatura
                </Button>
                <Button size="sm" onClick={() => { setCardForm({ name: "", lastDigits: "", closingDay: "", dueDay: "" }); setCardDialog("card"); }}>
                  <Plus className="mr-2 h-4 w-4" /> Cartão
                </Button>
              </div>
            )}
          </div>

          {cards.isLoading ? (
            <PageSkeleton />
          ) : (cards.data?.data ?? []).length === 0 ? (
            <EmptyState title="Nenhum cartão" description="Cadastre um cartão para acompanhar as faturas." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.data!.data.map((c) => (
                <Card key={c.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2"><CreditCardIcon className="h-4 w-4" /> {c.name}</span>
                      {!c.active && <Badge variant="muted">Inativo</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {c.lastDigits ? `final ${c.lastDigits}` : "sem final"}
                      {c.closingDay ? ` · fecha dia ${c.closingDay}` : ""}
                      {c.dueDay ? ` · vence dia ${c.dueDay}` : ""}
                    </p>
                    {c.statements.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhuma fatura enviada.</p>
                    ) : (
                      c.statements.map((st) => (
                        <button key={st.id} onClick={() => setOpenStatementId(st.id)} className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-sm transition-colors hover:border-primary/50">
                          <span>{st.referenceMonth}</span>
                          <span className="tabular-nums font-medium">{formatCurrency(st.total)}</span>
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {cardAnalysis.data?.data && cardAnalysis.data.data.total > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Gasto por categoria</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {cardAnalysis.data.data.byCategory.map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-sm">
                      <span>{r.key}</span>
                      <span className="font-medium tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                    <span>Total</span><span className="tabular-nums">{formatCurrency(cardAnalysis.data.data.total)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Gasto por cartão</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {cardAnalysis.data.data.byCard.map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-sm">
                      <span>{r.key}</span>
                      <span className="font-medium tabular-nums">{formatCurrency(r.total)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
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

        {/* ---- DRE formal ---- */}
        <TabsContent value="dre" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="De">
              <Input type="date" value={dreRange.from} onChange={(e) => setDreRange({ ...dreRange, from: e.target.value })} />
            </Field>
            <Field label="Até">
              <Input type="date" value={dreRange.to} onChange={(e) => setDreRange({ ...dreRange, to: e.target.value })} />
            </Field>
            <Field label="Base">
              <Select value={dreRange.basis} onValueChange={(v) => setDreRange({ ...dreRange, basis: v })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="accrual">Competência</SelectItem>
                  <SelectItem value="cash">Caixa (pagos)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {dre.isLoading || !dre.data ? (
            <PageSkeleton />
          ) : (() => {
            const d = dre.data.data;
            const result = d.lines.find((l) => l.key === "LUCRO_LIQUIDO")?.value ?? 0;
            const chart = [
              { name: "Receita líq.", v: d.lines.find((l) => l.key === "RECEITA_LIQUIDA")?.value ?? 0 },
              { name: "Lucro bruto", v: d.lines.find((l) => l.key === "LUCRO_BRUTO")?.value ?? 0 },
              { name: "EBITDA", v: d.lines.find((l) => l.key === "EBITDA")?.value ?? 0 },
              { name: "Lucro líq.", v: result },
            ];
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <KpiCard title="Margem bruta" value={d.margins.bruta == null ? "—" : `${d.margins.bruta}%`} icon={Target} />
                  <KpiCard title="Margem operacional" value={d.margins.operacional == null ? "—" : `${d.margins.operacional}%`} icon={Target} />
                  <KpiCard title="Margem líquida" value={d.margins.liquida == null ? "—" : `${d.margins.liquida}%`} icon={Target} />
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Demonstração do Resultado — {d.from ?? "início"} a {d.to ?? "hoje"}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({d.basis === "cash" ? "caixa" : "competência"} · {d.transactionCount} lançamentos)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-0.5 text-sm">
                    {d.lines.map((l) => {
                      const shown = l.sign === -1 ? -Math.abs(l.value) : l.value;
                      const isTotal = l.kind === "subtotal" || l.kind === "result";
                      return (
                        <div
                          key={l.key}
                          className={`flex justify-between py-1 ${isTotal ? "border-t border-border font-semibold" : ""} ${l.kind === "result" ? "mt-1 border-t-2 border-foreground/30 pt-2 text-base" : ""}`}
                        >
                          <span className={isTotal ? "" : "pl-3 text-muted-foreground"}>{l.label}</span>
                          <span className={`tabular-nums ${shown < 0 ? "text-destructive" : isTotal ? "text-success" : ""}`}>
                            {formatCurrency(shown)}
                          </span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm">Cascata do resultado</CardTitle></CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -6 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                          <Tooltip formatter={(v: number) => formatCurrency(v)} />
                          <Bar dataKey="v" radius={[4, 4, 0, 0]} className="fill-primary" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {canManage && d.byCategory.length > 0 && (
                  <Card>
                    <CardHeader className="flex-row items-center justify-between py-3">
                      <CardTitle className="text-sm">Classificação das categorias na DRE</CardTitle>
                      {Object.keys(mapEdits).length > 0 && (
                        <Button
                          size="sm"
                          disabled={saveMappings.isPending}
                          onClick={() => {
                            const current = new Map((dreMappings.data?.data ?? []).map((m) => [m.category, m.dreLine]));
                            for (const [cat, line] of Object.entries(mapEdits)) current.set(cat, line);
                            saveMappings.mutate([...current.entries()].map(([category, dreLine]) => ({ category, dreLine })));
                          }}
                        >
                          {saveMappings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {[...new Map(d.byCategory.map((r) => [r.category, r])).values()].map((r) => {
                        const cur = mapEdits[r.category] ?? r.dreLine;
                        return (
                          <div key={r.category} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 text-xs last:border-0">
                            <span className="min-w-0 flex-1">
                              {r.category}
                              {!r.mapped && <span className="ml-1 text-muted-foreground">(auto)</span>}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{formatCurrency(r.value)}</span>
                            <Select value={cur} onValueChange={(v) => setMapEdits((s) => ({ ...s, [r.category]: v }))}>
                              <SelectTrigger className="h-7 w-56 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(dreLines.data?.data ?? []).map((ln) => (
                                  <SelectItem key={ln.key} value={ln.key}>{ln.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
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

      {/* ---- Compra parcelada ---- */}
      <Dialog open={instDialog} onOpenChange={setInstDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Compra parcelada</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria">
              <Select value={instForm.category || "NONE"} onValueChange={(v) => setInstForm({ ...instForm, category: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {CATEGORIES.DESPESA.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fornecedor (opcional)">
              <Picker value={instForm.supplierId} onChange={(v) => setInstForm({ ...instForm, supplierId: v })} items={suppliers.data?.data ?? []} />
            </Field>
            <Field label="Valor total (R$)">
              <Input type="number" step="0.01" min="0" value={instForm.totalAmount} onChange={(e) => setInstForm({ ...instForm, totalAmount: e.target.value })} />
            </Field>
            <Field label="Nº de parcelas">
              <Input type="number" min="2" max="120" value={instForm.installments} onChange={(e) => setInstForm({ ...instForm, installments: e.target.value })} />
            </Field>
            <Field label="1º vencimento">
              <Input type="date" value={instForm.firstDueDate} onChange={(e) => setInstForm({ ...instForm, firstDueDate: e.target.value })} />
            </Field>
            <Field label="Forma de pagamento">
              <Input value={instForm.method} onChange={(e) => setInstForm({ ...instForm, method: e.target.value })} />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea rows={2} value={instForm.description} onChange={(e) => setInstForm({ ...instForm, description: e.target.value })} />
            </Field>
          </div>
          {Number(instForm.totalAmount) > 0 && Number(instForm.installments) >= 2 && (
            <p className="text-xs text-muted-foreground">
              {instForm.installments}x de {formatCurrency(Number(instForm.totalAmount) / Number(instForm.installments))} — lança {instForm.installments} despesas pendentes mensais.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstDialog(false)}>Cancelar</Button>
            <Button disabled={createInstallments.isPending || !instForm.category || !(Number(instForm.totalAmount) > 0) || !(Number(instForm.installments) >= 2)} onClick={() => createInstallments.mutate()}>
              {createInstallments.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lançar parcelas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Novo cartão ---- */}
      <Dialog open={cardDialog === "card"} onOpenChange={(v) => !v && setCardDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo cartão</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2"><Input value={cardForm.name} onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })} placeholder="Ex.: Nubank PJ" /></Field>
            <Field label="4 últimos dígitos"><Input maxLength={4} value={cardForm.lastDigits} onChange={(e) => setCardForm({ ...cardForm, lastDigits: e.target.value.replace(/\D/g, "") })} /></Field>
            <div />
            <Field label="Dia de fechamento"><Input type="number" min="1" max="31" value={cardForm.closingDay} onChange={(e) => setCardForm({ ...cardForm, closingDay: e.target.value })} /></Field>
            <Field label="Dia de vencimento"><Input type="number" min="1" max="31" value={cardForm.dueDay} onChange={(e) => setCardForm({ ...cardForm, dueDay: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCardDialog(null)}>Cancelar</Button>
            <Button disabled={createCard.isPending || cardForm.name.trim().length < 2} onClick={() => createCard.mutate()}>
              {createCard.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Enviar fatura ---- */}
      <Dialog open={cardDialog === "statement"} onOpenChange={(v) => !v && setCardDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviar fatura</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Cartão">
              <Select value={stmtForm.cardId} onValueChange={(v) => setStmtForm({ ...stmtForm, cardId: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{(cards.data?.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Mês de referência"><Input type="month" value={stmtForm.referenceMonth} onChange={(e) => setStmtForm({ ...stmtForm, referenceMonth: e.target.value })} /></Field>
            <Field label="Arquivo PDF (opcional)"><Input type="file" accept="application/pdf" onChange={(e) => setStmtForm({ ...stmtForm, file: e.target.files?.[0] ?? null })} /></Field>
            <p className="text-xs text-muted-foreground">A leitura automática do PDF virá em uma evolução. Por enquanto as despesas são lançadas manualmente por categoria.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCardDialog(null)}>Cancelar</Button>
            <Button disabled={uploadStatement.isPending || !stmtForm.cardId || !/^\d{4}-\d{2}$/.test(stmtForm.referenceMonth)} onClick={() => uploadStatement.mutate()}>
              {uploadStatement.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar fatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Detalhe da fatura ---- */}
      <Dialog open={Boolean(openStatementId)} onOpenChange={(v) => { if (!v) setOpenStatementId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Fatura {statementDetail.data?.data.card ?? ""} — {statementDetail.data?.data.referenceMonth ?? ""}
            </DialogTitle>
          </DialogHeader>
          {statementDetail.isLoading || !statementDetail.data ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total da fatura</span>
                <span className="font-semibold tabular-nums">{formatCurrency(statementDetail.data.data.total)}</span>
              </div>

              {statementDetail.data.data.expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma despesa lançada.</p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {statementDetail.data.data.expenses.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0">
                      <div className="min-w-0">
                        <p className="truncate">{e.description}</p>
                        <p className="text-xs text-muted-foreground">{e.category} · {fmtDate(e.date)}{e.installment ? ` · ${e.installment}` : ""}</p>
                      </div>
                      <span className="tabular-nums">{formatCurrency(e.amount)}</span>
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => removeExpense.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Adicionar despesa</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Descrição" className="sm:col-span-2"><Input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} /></Field>
                    <Field label="Categoria">
                      <Select value={expForm.category || "NONE"} onValueChange={(v) => setExpForm({ ...expForm, category: v === "NONE" ? "" : v })}>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">Selecione</SelectItem>
                          {CARD_EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Valor (R$)"><Input type="number" step="0.01" min="0" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} /></Field>
                    <Field label="Data"><Input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} /></Field>
                    <Field label="Parcela (ex.: 2/10)"><Input value={expForm.installment} onChange={(e) => setExpForm({ ...expForm, installment: e.target.value })} /></Field>
                  </div>
                  <Button size="sm" disabled={addExpense.isPending || !expForm.description || !expForm.category || !(Number(expForm.amount) > 0)} onClick={() => addExpense.mutate()}>
                    {addExpense.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar
                  </Button>
                </div>
              )}
            </div>
          )}
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
