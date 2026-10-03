import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Copy, FileDown, Plus, Send, Settings2, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ------------------------------------------------------------------ tipos

type PaymentMethod = "AVISTA" | "PIX" | "BOLETO" | "CARTAO" | "FINANCEIRA";
type FinancingPlan = { id: string; name: string; method: "CARTAO" | "FINANCEIRA"; installments: number; feePercent: number; requiresDownPayment: boolean };
type CommissionRole = { role: string; label: string; defaultPercent: number };
type QuoteDocumentConfig = { supplier: string; line: string; deliveryDays: number; deliveryText: string; notes: string[] };
type PricingConfig = { defaultMarkup: number; minScore: number; validityDays: number; commissionRoles: CommissionRole[]; financingPlans: FinancingPlan[]; document: QuoteDocumentConfig };
type Approval = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
type QuoteStatus = "DRAFT" | "SENT" | "VIEWED" | "NEGOTIATION" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

type Quote = {
  id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  issuedAt: string;
  validUntil: string | null;
  notes: string | null;
  paymentTerms: string | null;
  deliveryText?: string | null;
  deliveryDays?: number | null;
  client: { id: string; name: string };
  opportunity: { id: string; title: string } | null;
  project: { id: string; code: string; name: string } | null;
  seller: { id: string; name: string };
  items: { room: string | null; description: string; quantity: number; unitCost: number; unitPrice: number; total: number; corpo?: string | null; porta?: string | null; puxador?: string | null; complemento?: string | null; modelo?: string | null }[];
  commissions: { userId: string | null; referrerId?: string | null; name: string; role: string; percent: number; amount: number }[];
  referrer?: { id: string; name: string } | null;
  costTotal: number;
  markup: number;
  subtotal: number;
  discount: number;
  total: number;
  freight: number;
  otherCosts: number;
  payment: { method: PaymentMethod; planId: string | null; planName: string | null; installments: number; downPayment: number; feePercent: number; financingFee: number };
  result: number;
  marginPercent: number | null;
  score: number | null;
  approval: { status: Approval; decidedBy: { name: string } | null; decidedAt: string | null; note: string | null };
  finance?: FinanceEntry[];
  kind?: "PADRAO" | "ADENDO";
  parentId?: string | null;
  competenceDate?: string | null;
  cancelReason?: string | null;
  futureSale?: boolean;
  futureReleaseDate?: string | null;
};
type FinanceEntry = { id: string; type: "RECEITA" | "DESPESA"; category: string; amount: number; dueDate: string; status: string; description: string | null };
type PlannedEntry = { type: "RECEITA" | "DESPESA"; category: string; amount: number; dueDay: string; description: string };
// vencimento é data de calendário (meia-noite UTC): mostra o dia sem converter fuso
const dayBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

type Calc = {
  items: { total: number; unitPrice: number }[];
  costTotal: number;
  commissionPercent: number;
  subtotal: number;
  discount: number;
  total: number;
  freight: number;
  otherCosts: number;
  commissions: { name: string; percent: number; amount: number }[];
  commissionTotal: number;
  payment: { method: PaymentMethod; planName: string | null; downPayment: number; financed: number; installments: number; installmentValue: number; feePercent: number; financingFee: number };
  netRevenue: number;
  result: number;
  marginPercent: number | null;
  score: number | null;
  minScore: number;
  needsApproval: boolean;
};

const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  VIEWED: "Visto",
  NEGOTIATION: "Em negociação",
  APPROVED: "Aceito pelo cliente",
  REJECTED: "Recusado",
  EXPIRED: "Vencido",
  CANCELLED: "Cancelado",
};
const METHOD_LABEL: Record<PaymentMethod, string> = { AVISTA: "À vista", PIX: "PIX", BOLETO: "Boleto parcelado", CARTAO: "Cartão de crédito", FINANCEIRA: "Financeira" };
const EDITABLE: QuoteStatus[] = ["DRAFT", "NEGOTIATION"];

const pts = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2).replace(".", ","));
const num = (s: string) => {
  const v = Number(String(s).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
// campo numérico em pt-BR: aceita "1.234,56" e "1234.56"
const toField = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n).replace(".", ","));
const parse = (s: string) => {
  const t = s.trim();
  if (!t) return 0;
  return t.includes(",") ? num(t) : Number(t) || 0;
};

function ApprovalBadge({ status }: { status: Approval }) {
  if (status === "PENDING") return <Badge variant="warning">aguarda liberação</Badge>;
  if (status === "APPROVED") return <Badge variant="success">liberado</Badge>;
  if (status === "REJECTED") return <Badge variant="danger">liberação recusada</Badge>;
  return null;
}

// ------------------------------------------------------------------ lista (aba do comercial)

export function QuotesTab() {
  const { can } = useAuth();
  const [pendingOnly, setPendingOnly] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const q = useQuery({
    queryKey: ["quotes", pendingOnly],
    queryFn: () => apiGet<{ data: Quote[] }>("/commercial/quotes", pendingOnly ? { approval: "PENDING" } : undefined),
  });
  const rows = q.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {can("commercial.quotes.manage") && (
          <Button size="sm" asChild>
            <Link to="/comercial/orcamentos/novo"><Plus className="mr-1 h-4 w-4" /> Novo orçamento</Link>
          </Button>
        )}
        <Button size="sm" variant={pendingOnly ? "default" : "outline"} onClick={() => setPendingOnly((v) => !v)}>
          <ShieldAlert className="mr-1 h-4 w-4" /> Aguardando liberação
        </Button>
        {can("commercial.manage") && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setConfigOpen(true)}>
            <Settings2 className="mr-1 h-4 w-4" /> Configurar preços
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {q.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{pendingOnly ? "Nenhum orçamento aguardando liberação." : "Nenhum orçamento ainda."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orçamento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pontuação</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Emitido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/comercial/orcamentos/${r.id}`} className="font-medium hover:underline">
                        {r.number}{r.version > 1 ? ` v${r.version}` : ""}
                      </Link>
                      {r.kind === "ADENDO" && <Badge variant="muted" className="ml-2">adendo</Badge>}
                      {r.futureSale && <Badge variant="warning" className="ml-2">venda futura{r.futureReleaseDate ? ` · ${dayBR(r.futureReleaseDate)}` : ""}</Badge>}
                    </TableCell>
                    <TableCell>{r.client.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.total)}</TableCell>
                    <TableCell className="text-right">{pts(r.score)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary">{STATUS_LABEL[r.status]}</Badge>
                        <ApprovalBadge status={r.approval.status} />
                      </div>
                    </TableCell>
                    <TableCell>{r.seller.name}</TableCell>
                    <TableCell>{formatDate(r.issuedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {configOpen && <PricingConfigDialog onClose={() => setConfigOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ editor

type ItemForm = { room: string; description: string; quantity: string; unitCost: string; corpo: string; porta: string; puxador: string; complemento: string; modelo: string };
/** Acabamentos do ambiente: saem na segunda tabela do orçamento da loja. */
const FINISHES = [
  ["corpo", "Caixaria", "MDF 15mm Branco TX"],
  ["porta", "Porta", "MDF 15mm Areia"],
  ["puxador", "Puxador", "Cava usinado"],
  ["complemento", "Complemento", ""],
  ["modelo", "Modelo", ""],
] as const;
type CommissionForm = { userId: string; referrerId?: string; name: string; role: string; percent: string };
type Referrer = { id: string; name: string; kind: string; defaultRtPercent: number };
const RT_ROLE = "INDICADOR";
type Form = {
  clientId: string;
  opportunityId: string;
  projectId: string;
  referrerId: string;
  items: ItemForm[];
  markup: string;
  commissions: CommissionForm[];
  discount: string;
  freight: string;
  otherCosts: string;
  method: PaymentMethod;
  planId: string;
  installments: string;
  downPayment: string;
  feePercent: string;
  paymentTerms: string;
  deliveryText: string;
  deliveryDays: string;
  validUntil: string;
  notes: string;
  futureSale: boolean;
  futureReleaseDate: string;
};

const emptyItem = (): ItemForm => ({ room: "", description: "", quantity: "1", unitCost: "", corpo: "", porta: "", puxador: "", complemento: "", modelo: "" });

function fromQuote(q: Quote): Form {
  return {
    clientId: q.client.id,
    opportunityId: q.opportunity?.id ?? "",
    projectId: q.project?.id ?? "",
    referrerId: q.referrer?.id ?? "",
    items: q.items.map((i) => ({ room: i.room ?? "", description: i.description, quantity: String(i.quantity).replace(".", ","), unitCost: toField(i.unitCost), corpo: i.corpo ?? "", porta: i.porta ?? "", puxador: i.puxador ?? "", complemento: i.complemento ?? "", modelo: i.modelo ?? "" })),
    markup: String(q.markup).replace(".", ","),
    commissions: q.commissions.map((c) => ({ userId: c.userId ?? "", referrerId: c.referrerId ?? "", name: c.name, role: c.role, percent: toField(c.percent) })),
    discount: toField(q.discount),
    freight: toField(q.freight),
    otherCosts: toField(q.otherCosts),
    method: q.payment.method,
    planId: q.payment.planId ?? "",
    installments: String(q.payment.installments),
    downPayment: toField(q.payment.downPayment),
    feePercent: toField(q.payment.feePercent),
    paymentTerms: q.paymentTerms ?? "",
    deliveryText: q.deliveryText ?? "",
    deliveryDays: q.deliveryDays ? String(q.deliveryDays) : "",
    validUntil: q.validUntil ? q.validUntil.slice(0, 10) : "",
    notes: q.notes ?? "",
    futureSale: Boolean(q.futureSale),
    futureReleaseDate: q.futureReleaseDate ? q.futureReleaseDate.slice(0, 10) : "",
  };
}

function toPayload(f: Form, roleLabel: (role: string) => string, addendumOf?: string | null) {
  return {
    addendumOf: addendumOf || null,
    clientId: f.clientId,
    opportunityId: f.opportunityId || null,
    projectId: f.projectId || null,
    referrerId: f.referrerId || null,
    items: f.items
      .filter((i) => i.description.trim() || parse(i.unitCost) > 0)
      .map((i) => ({ room: i.room || null, description: i.description.trim() || i.room || "Item", quantity: parse(i.quantity) || 1, unitCost: parse(i.unitCost), corpo: i.corpo.trim() || null, porta: i.porta.trim() || null, puxador: i.puxador.trim() || null, complemento: i.complemento.trim() || null, modelo: i.modelo.trim() || null })),
    markup: parse(f.markup),
    // percentual sem pessoa escolhida ainda conta no preço, com o nome do papel
    commissions: f.commissions.filter((c) => parse(c.percent) > 0).map((c) => ({ userId: c.userId || null, referrerId: c.referrerId || null, name: c.name.trim() || roleLabel(c.role), role: c.role, percent: parse(c.percent) })),
    discount: parse(f.discount),
    freight: parse(f.freight),
    otherCosts: parse(f.otherCosts),
    payment: {
      method: f.method,
      planId: f.planId || null,
      installments: parse(f.installments) || 1,
      downPayment: parse(f.downPayment),
      feePercent: parse(f.feePercent),
    },
    paymentTerms: f.paymentTerms || null,
    deliveryText: f.deliveryText.trim() || null,
    deliveryDays: parse(f.deliveryDays) > 0 ? Math.round(parse(f.deliveryDays)) : null,
    // meio-dia: a data não escorrega de dia por causa do fuso
    validUntil: f.validUntil ? `${f.validUntil}T15:00:00.000Z` : null,
    notes: f.notes || null,
    futureSale: f.futureSale,
    futureReleaseDate: f.futureSale && f.futureReleaseDate ? `${f.futureReleaseDate}T12:00:00.000Z` : null,
  };
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** /comercial/orcamentos/:id — `novo` cria; aceita ?clientId=&opportunityId= vindos do funil. */
export function QuoteEditorPage() {
  const { id = "novo" } = useParams();
  const isNew = id === "novo";
  const q = useQuery({ queryKey: ["quote", id], queryFn: () => apiGet<{ data: Quote }>(`/commercial/quotes/${id}`), enabled: !isNew });
  const config = useQuery({ queryKey: ["quotes", "config"], queryFn: () => apiGet<{ data: PricingConfig }>("/commercial/quotes/config") });

  if ((!isNew && q.isLoading) || config.isLoading) return <PageSkeleton />;
  if (!config.data) return <p className="py-10 text-center text-sm text-destructive">{errorMessage(config.error, "Falha ao carregar a configuração de preços")}</p>;
  if (!isNew && !q.data) return <p className="py-10 text-center text-sm text-destructive">{errorMessage(q.error, "Orçamento não encontrado")}</p>;
  return <QuoteEditor key={q.data?.data.id ?? "novo"} quote={q.data?.data ?? null} config={config.data.data} />;
}

function QuoteEditor({ quote, config }: { quote: Quote | null; config: PricingConfig }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editable = !quote || EDITABLE.includes(quote.status);
  const canEdit = editable && can("commercial.quotes.manage");

  const [form, setForm] = useState<Form>(() =>
    quote
      ? fromQuote(quote)
      : {
          clientId: params.get("clientId") ?? "",
          opportunityId: params.get("opportunityId") ?? "",
          projectId: "",
          referrerId: "",
          items: [emptyItem()],
          markup: String(config.defaultMarkup).replace(".", ","),
          commissions: config.commissionRoles
            .filter((r) => r.defaultPercent > 0)
            .map((r) => ({ userId: r.role === "VENDEDOR" ? user?.id ?? "" : "", name: r.role === "VENDEDOR" ? user?.name ?? "" : "", role: r.role, percent: toField(r.defaultPercent) })),
          discount: "",
          freight: "",
          otherCosts: "",
          method: "AVISTA",
          planId: "",
          installments: "1",
          downPayment: "",
          feePercent: "",
          paymentTerms: "",
          deliveryText: "",
          deliveryDays: "",
          validUntil: "",
          notes: "",
          futureSale: false,
          futureReleaseDate: "",
        }
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/business/clients") });
  const people = useQuery({ queryKey: ["kanban-people"], queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/organization/people") });
  const referrers = useQuery({ queryKey: ["referrers"], queryFn: () => apiGet<{ data: Referrer[] }>("/referrers") });
  /** Escolher o indicador cria/atualiza a linha de reserva técnica nas comissões. */
  const pickReferrer = (id: string) => {
    const r = (referrers.data?.data ?? []).find((x) => x.id === id);
    setForm((f) => {
      const others = f.commissions.filter((c) => c.role !== RT_ROLE);
      if (!r) return { ...f, referrerId: "", commissions: others };
      const cur = f.commissions.find((c) => c.role === RT_ROLE);
      return { ...f, referrerId: r.id, commissions: [...others, { userId: "", referrerId: r.id, name: r.name, role: RT_ROLE, percent: cur?.percent || toField(r.defaultRtPercent) }] };
    });
  };
  const opps = useQuery({
    queryKey: ["commercial", "opportunities", "client", form.clientId],
    queryFn: () => apiGet<{ data: { id: string; title: string }[] }>("/commercial/opportunities", { clientId: form.clientId, closed: "1" }),
    enabled: Boolean(form.clientId),
  });
  const projects = useQuery({
    queryKey: ["business-projects", "client", form.clientId],
    queryFn: () => apiGet<{ data: { id: string; code: string; name: string }[] }>("/business/projects", { clientId: form.clientId }),
    enabled: Boolean(form.clientId),
  });

  // cálculo ao vivo pelo backend (a regra fica num lugar só)
  const payload = useMemo(
    () => toPayload(form, (role) => config.commissionRoles.find((r) => r.role === role)?.label ?? role, quote ? null : params.get("addendumOf")),
    [form, config.commissionRoles, quote, params]
  );
  const calcBody = useDebounced(
    { items: payload.items, markup: payload.markup, commissions: payload.commissions, discount: payload.discount, freight: payload.freight, otherCosts: payload.otherCosts, payment: payload.payment },
    350
  );
  const preview = useQuery({
    queryKey: ["quote-preview", calcBody],
    queryFn: () => apiPost<{ data: Calc }>("/commercial/quotes/preview", calcBody),
    enabled: canEdit && calcBody.items.length > 0 && calcBody.markup > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const calc: Calc | null = canEdit ? preview.data?.data ?? null : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["quote"] });
  };
  const save = useMutation({
    mutationFn: () => {
      if (!form.clientId) throw new Error("Escolha o cliente");
      if (!payload.items.length) throw new Error("Inclua pelo menos um ambiente com custo");
      return quote ? apiPut<{ data: Quote; message: string }>(`/commercial/quotes/${quote.id}`, payload) : apiPost<{ data: Quote; message: string }>("/commercial/quotes", payload);
    },
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
      if (!quote) navigate(`/comercial/orcamentos/${r.data.id}`, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar o orçamento")),
  });

  const plans = config.financingPlans.filter((p) => p.method === form.method);
  const pickMethod = (m: PaymentMethod) => setForm((f) => ({ ...f, method: m, planId: "", installments: m === "AVISTA" || m === "PIX" ? "1" : f.installments }));

  const title = quote ? `Orçamento ${quote.number}${quote.version > 1 ? ` v${quote.version}` : ""}` : "Novo orçamento";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link to="/comercial?aba=orcamentos"><ArrowLeft className="mr-1 h-4 w-4" /> Orçamentos</Link>
        </Button>
        <div className="flex-1">
          <PageHeader title={title} description="Custo de cada ambiente (peças e mão de obra), acabamentos, mark-up e comissões. Custo, comissões e resultado não saem no PDF do cliente." />
        </div>
      </div>

      {!quote && params.get("addendumOf") && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          Adendo de contrato: inclua só o que foi acrescentado. Ao ser aceito, lança no financeiro apenas o valor do adendo.
        </p>
      )}
      {quote?.status === "CANCELLED" && quote.cancelReason && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">Cancelado: {quote.cancelReason}</p>
      )}
      {quote && (
        <div className="flex flex-wrap items-center gap-2">
          {quote.kind === "ADENDO" && <Badge variant="muted">Adendo</Badge>}
          <Badge variant="secondary">{STATUS_LABEL[quote.status]}</Badge>
          {quote.status === "APPROVED" && quote.competenceDate && (
            <span className="text-xs text-muted-foreground">competência {dayBR(quote.competenceDate)}</span>
          )}
          <ApprovalBadge status={quote.approval.status} />
          {quote.approval.decidedBy && (
            <span className="text-xs text-muted-foreground">
              por {quote.approval.decidedBy.name} em {formatDate(quote.approval.decidedAt)}{quote.approval.note ? ` — ${quote.approval.note}` : ""}
            </span>
          )}
          {!editable && <span className="text-xs text-muted-foreground">Enviado ou fechado: para mudar, crie uma nova versão.</span>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Cliente</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <Field label="Cliente">
                <Select disabled={!canEdit} value={form.clientId || "NONE"} onValueChange={(v) => setForm((f) => ({ ...f, clientId: v === "NONE" ? "" : v, opportunityId: "", projectId: "" }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Selecione</SelectItem>
                    {(clients.data?.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Oportunidade">
                <Select disabled={!canEdit || !form.clientId} value={form.opportunityId || "NONE"} onValueChange={(v) => set("opportunityId", v === "NONE" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhuma</SelectItem>
                    {(opps.data?.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Projeto">
                <Select disabled={!canEdit || !form.clientId} value={form.projectId || "NONE"} onValueChange={(v) => set("projectId", v === "NONE" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhum</SelectItem>
                    {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Indicador (arquiteto/parceiro)">
                <Select disabled={!canEdit} value={form.referrerId || "NONE"} onValueChange={(v) => pickReferrer(v === "NONE" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Sem indicador</SelectItem>
                    {(referrers.data?.data ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-3">
              <CardTitle className="text-base">Ambientes e custos</CardTitle>
              {canEdit && form.projectId && <PromobImportButton projectId={form.projectId} onPick={(items) => set("items", items)} />}
            </CardHeader>
            <CardContent className="space-y-2">
              {form.items.map((it, i) => {
                const upd = (patch: Partial<ItemForm>) => set("items", form.items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.6fr_70px_130px_120px_32px] md:items-end">
                      <Field label="Ambiente"><Input disabled={!canEdit} placeholder="Cozinha" value={it.room} onChange={(e) => upd({ room: e.target.value })} /></Field>
                      <Field label="Qtd"><Input disabled={!canEdit} inputMode="decimal" value={it.quantity} onChange={(e) => upd({ quantity: e.target.value })} /></Field>
                      <Field label="Custo unitário"><Input disabled={!canEdit} inputMode="decimal" placeholder="0,00" value={it.unitCost} onChange={(e) => upd({ unitCost: e.target.value })} /></Field>
                      <div className="pb-2 text-right">
                        <p className="text-xs text-muted-foreground">Venda</p>
                        <p className="text-sm font-medium">{formatCurrency(calc?.items[i]?.total ?? quote?.items[i]?.total ?? 0)}</p>
                      </div>
                      {canEdit ? (
                        <Button variant="ghost" size="icon" aria-label="Remover ambiente" disabled={form.items.length === 1} onClick={() => set("items", form.items.filter((_, k) => k !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : <span />}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      {FINISHES.map(([key, label, hint]) => (
                        <Field key={key} label={label}><Input disabled={!canEdit} placeholder={hint} value={it[key]} onChange={(e) => upd({ [key]: e.target.value } as Partial<ItemForm>)} /></Field>
                      ))}
                    </div>
                    <Field label="Observação do ambiente (o que será feito — sai no orçamento do cliente)">
                      <Textarea disabled={!canEdit} rows={2} maxLength={3000} placeholder="Armário alto com 4 portas de giro, 2 gavetões…" value={it.description} onChange={(e) => upd({ description: e.target.value })} />
                    </Field>
                  </div>
                );
              })}
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => set("items", [...form.items, emptyItem()])}>
                  <Plus className="mr-1 h-4 w-4" /> Ambiente
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-base">Preço</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Field label="Mark-up (fator)"><Input disabled={!canEdit} inputMode="decimal" value={form.markup} onChange={(e) => set("markup", e.target.value)} /></Field>
                <Field label="Desconto (R$)"><Input disabled={!canEdit} inputMode="decimal" placeholder="0,00" value={form.discount} onChange={(e) => set("discount", e.target.value)} /></Field>
                <Field label="Frete (R$)"><Input disabled={!canEdit} inputMode="decimal" placeholder="0,00" value={form.freight} onChange={(e) => set("freight", e.target.value)} /></Field>
                <Field label="Outros custos (R$)"><Input disabled={!canEdit} inputMode="decimal" placeholder="0,00" value={form.otherCosts} onChange={(e) => set("otherCosts", e.target.value)} /></Field>
                <p className="col-span-2 text-xs text-muted-foreground">O custo já inclui peças e montagem. Frete e outros custos saem do resultado, não entram no preço.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3"><CardTitle className="text-base">Comissões</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {form.commissions.map((c, i) => c.role === RT_ROLE ? (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_60px_32px] items-center gap-2">
                    <span className="truncate text-sm">{c.name}</span>
                    <span className="text-xs text-muted-foreground">Reserva técnica</span>
                    <Input disabled={!canEdit} inputMode="decimal" aria-label="% RT" value={c.percent} onChange={(e) => set("commissions", form.commissions.map((x, k) => (k === i ? { ...x, percent: e.target.value } : x)))} />
                    {canEdit ? <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => pickReferrer("")}><Trash2 className="h-4 w-4" /></Button> : <span />}
                  </div>
                ) : (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_60px_32px] items-center gap-2">
                    <Select
                      disabled={!canEdit}
                      value={c.userId || "NONE"}
                      onValueChange={(v) => {
                        const p = (people.data?.data ?? []).find((x) => x.id === v);
                        set("commissions", form.commissions.map((x, k) => (k === i ? { ...x, userId: p?.id ?? "", name: p?.name ?? x.name } : x)));
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Pessoa" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">{c.name || "Pessoa"}</SelectItem>
                        {(people.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select disabled={!canEdit} value={c.role} onValueChange={(v) => set("commissions", form.commissions.map((x, k) => (k === i ? { ...x, role: v } : x)))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {config.commissionRoles.map((r) => <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>)}
                        {!config.commissionRoles.some((r) => r.role === c.role) && <SelectItem value={c.role}>{c.role}</SelectItem>}
                      </SelectContent>
                    </Select>
                    <Input disabled={!canEdit} inputMode="decimal" aria-label="%" value={c.percent} onChange={(e) => set("commissions", form.commissions.map((x, k) => (k === i ? { ...x, percent: e.target.value } : x)))} />
                    {canEdit ? (
                      <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set("commissions", form.commissions.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                    ) : <span />}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => set("commissions", [...form.commissions, { userId: "", name: "", role: config.commissionRoles[0]?.role ?? "VENDEDOR", percent: toField(config.commissionRoles[0]?.defaultPercent) }])}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Envolvido
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">A comissão é acrescentada ao preço: pagas as comissões, sobra o custo × mark-up.</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Negociação e condições</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <Field label="Forma">
                <Select disabled={!canEdit} value={form.method} onValueChange={(v) => pickMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {(form.method === "FINANCEIRA" || form.method === "CARTAO") && (
                <Field label="Plano">
                  <Select disabled={!canEdit} value={form.planId || "NONE"} onValueChange={(v) => set("planId", v === "NONE" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sem plano (informar)</SelectItem>
                      {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Entrada (R$)"><Input disabled={!canEdit} inputMode="decimal" placeholder="0,00" value={form.downPayment} onChange={(e) => set("downPayment", e.target.value)} /></Field>
              {form.method !== "AVISTA" && form.method !== "PIX" && !form.planId && (
                <>
                  <Field label="Parcelas"><Input disabled={!canEdit} inputMode="numeric" value={form.installments} onChange={(e) => set("installments", e.target.value)} /></Field>
                  {(form.method === "FINANCEIRA" || form.method === "CARTAO") && (
                    <Field label="Taxa retida (%)"><Input disabled={!canEdit} inputMode="decimal" placeholder="0" value={form.feePercent} onChange={(e) => set("feePercent", e.target.value)} /></Field>
                  )}
                </>
              )}
              <Field label="Condição de pagamento no PDF (texto livre — vazio usa a forma escolhida acima)" className="sm:col-span-4">
                <Textarea disabled={!canEdit} rows={2} maxLength={1000} placeholder="Ex.: Entrada de 30% no fechamento e saldo em 10x no boleto" value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
              </Field>
              <Field label="Prazo de entrega (texto)" className="sm:col-span-2">
                <Input disabled={!canEdit} placeholder={config?.document?.deliveryText ?? "Em dias úteis conforme ambientes"} value={form.deliveryText} onChange={(e) => set("deliveryText", e.target.value)} />
              </Field>
              <Field label="Prazo (dias)">
                <Input disabled={!canEdit} inputMode="numeric" placeholder={String(config?.document?.deliveryDays ?? 45)} value={form.deliveryDays} onChange={(e) => set("deliveryDays", e.target.value.replace(/[^0-9]/g, ""))} />
              </Field>
              <Field label="Proposta válida até">
                <Input type="date" disabled={!canEdit} value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-end gap-3 sm:col-span-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={!canEdit} checked={form.futureSale} onChange={(e) => set("futureSale", e.target.checked)} />
                  Venda futura (entrega depois do prazo normal: fim de obra, entrega do imóvel)
                </label>
                {form.futureSale && (
                  <Field label="Previsão de liberação para produção">
                    <Input type="date" disabled={!canEdit} value={form.futureReleaseDate} onChange={(e) => set("futureReleaseDate", e.target.value)} />
                  </Field>
                )}
              </div>
              <Field label="Observações para o cliente" className="sm:col-span-4">
                <Textarea disabled={!canEdit} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <ResultPanel calc={calc} quote={quote} error={canEdit && preview.isError ? errorMessage(preview.error, "Cálculo inválido") : null} />
          {canEdit && (
            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Salvando…" : quote ? "Salvar alterações" : "Salvar orçamento"}
            </Button>
          )}
          {quote && <QuoteActions quote={quote} onChanged={invalidate} />}
          {quote?.finance && quote.finance.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">No financeiro</CardTitle>
                {can("finance.read") && <Link to="/financeiro" className="text-xs text-primary hover:underline">abrir</Link>}
              </CardHeader>
              <CardContent>
                <FinanceList rows={quote.finance.map((f) => ({ key: f.id, type: f.type, description: f.description, day: f.dueDate, amount: f.amount, status: f.status }))} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ResultPanel({ calc, quote, error }: { calc: Calc | null; quote: Quote | null; error: string | null }) {
  // sem edição, mostra o que está gravado
  const v = calc
    ? {
        cost: calc.costTotal,
        subtotal: calc.subtotal,
        discount: calc.discount,
        total: calc.total,
        commissions: calc.commissionTotal,
        fee: calc.payment.financingFee,
        freight: calc.freight + calc.otherCosts,
        result: calc.result,
        margin: calc.marginPercent,
        score: calc.score,
        min: calc.minScore,
        low: calc.needsApproval,
        installments: calc.payment.financed > 0 && calc.payment.installments > 1 ? `${calc.payment.installments}x de ${formatCurrency(calc.payment.installmentValue)}` : null,
      }
    : quote
      ? {
          cost: quote.costTotal,
          subtotal: quote.subtotal,
          discount: quote.discount,
          total: quote.total,
          commissions: quote.commissions.reduce((s, c) => s + c.amount, 0),
          fee: quote.payment.financingFee,
          freight: quote.freight + quote.otherCosts,
          result: quote.result,
          margin: quote.marginPercent,
          score: quote.score,
          min: null as number | null,
          low: quote.approval.status === "PENDING" || quote.approval.status === "REJECTED",
          installments: quote.payment.installments > 1 ? `${quote.payment.installments}x de ${formatCurrency((quote.total - quote.payment.downPayment) / quote.payment.installments)}` : null,
        }
      : null;

  return (
    <Card className="xl:sticky xl:top-4">
      <CardHeader className="py-3"><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        {!v ? (
          <p className="text-muted-foreground">Informe o custo de pelo menos um ambiente.</p>
        ) : (
          <>
            <div className={`rounded-lg p-3 text-center ${v.low ? "bg-warning/15" : "bg-success/10"}`}>
              <p className="text-xs text-muted-foreground">Pontuação</p>
              <p className="text-3xl font-bold">{pts(v.score)}</p>
              {v.min != null && <p className="text-xs text-muted-foreground">mínimo {pts(v.min)}{v.low ? " — precisa de liberação" : ""}</p>}
            </div>
            <Row k="Custo (peças + montagem)" v={formatCurrency(v.cost)} />
            <Row k="Preço de venda" v={formatCurrency(v.subtotal)} />
            {v.discount > 0 && <Row k="Desconto" v={`- ${formatCurrency(v.discount)}`} />}
            <Row k="Total para o cliente" v={formatCurrency(v.total)} strong />
            {v.installments && <Row k="Parcelas" v={v.installments} />}
            <div className="border-t pt-2" />
            <Row k="Comissões" v={`- ${formatCurrency(v.commissions)}`} />
            {v.fee > 0 && <Row k="Taxa da financeira" v={`- ${formatCurrency(v.fee)}`} />}
            {v.freight > 0 && <Row k="Frete e outros custos" v={`- ${formatCurrency(v.freight)}`} />}
            <Row k="Resultado" v={formatCurrency(v.result)} strong />
            <Row k="Margem" v={v.margin == null ? "—" : `${v.margin.toFixed(1).replace(".", ",")}%`} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? "font-semibold" : ""}>{v}</span>
    </div>
  );
}

function QuoteActions({ quote, onChanged }: { quote: Quote; onChanged: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [deciding, setDeciding] = useState<"APPROVE" | "REJECT" | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [competence, setCompetence] = useState<string | null>(null);
  const [withFinance, setWithFinance] = useState(true);
  const [note, setNote] = useState("");
  const released = quote.approval.status === "NOT_REQUIRED" || quote.approval.status === "APPROVED";
  const manage = can("commercial.quotes.manage");

  const run = useMutation({
    mutationFn: async (action: "pdf" | "sent" | "accepted" | "rejected" | "version" | "delete" | "decide" | "cancelContract" | "reactivate" | "competence") => {
      const base = `/commercial/quotes/${quote.id}`;
      if (action === "pdf") {
        const r = await apiPost<{ data: { downloadUrl: string }; message: string }>(`${base}/pdf`);
        await apiDownload(r.data.downloadUrl.replace(/^\/api/, ""), `orcamento-${quote.number.toLowerCase()}${quote.version > 1 ? `-v${quote.version}` : ""}.pdf`);
        return r.message;
      }
      if (action === "sent") return (await apiPatch<{ message: string }>(`${base}/status`, { status: "SENT" })).message;
      if (action === "accepted") {
        const r = await apiPatch<{ message: string }>(`${base}/status`, { status: "APPROVED", generateFinance: withFinance });
        setAccepting(false);
        return r.message;
      }
      if (action === "rejected") return (await apiPatch<{ message: string }>(`${base}/status`, { status: "REJECTED" })).message;
      if (action === "cancelContract") {
        const reason = prompt("Motivo do cancelamento do contrato:");
        if (!reason?.trim()) throw new Error("Cancelamento não feito: informe o motivo");
        return (await apiPatch<{ message: string }>(`${base}/status`, { status: "CANCELLED", reason: reason.trim() })).message;
      }
      if (action === "reactivate") return (await apiPatch<{ message: string }>(`${base}/status`, { status: "DRAFT" })).message;
      if (action === "competence") {
        const r = await apiPost<{ message: string }>(`${base}/competence`, { date: competence });
        setCompetence(null);
        return r.message;
      }
      if (action === "version") {
        const r = await apiPost<{ data: Quote; message: string }>(`${base}/version`);
        navigate(`/comercial/orcamentos/${r.data.id}`);
        return r.message;
      }
      if (action === "delete") {
        const r = await apiDelete<{ message: string }>(base);
        navigate("/comercial?aba=orcamentos");
        return r.message;
      }
      const r = await apiPost<{ message: string }>(`${base}/approval`, { decision: deciding, note: note || null });
      setDeciding(null);
      setNote("");
      return r.message;
    },
    onSuccess: (msg) => {
      toast.success(msg);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível concluir")),
  });

  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-base">Ações</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        {quote.approval.status === "PENDING" && can("commercial.quotes.approve") && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => setDeciding("APPROVE")}><CheckCircle2 className="mr-1 h-4 w-4" /> Liberar</Button>
            <Button size="sm" variant="outline" onClick={() => setDeciding("REJECT")}><XCircle className="mr-1 h-4 w-4" /> Recusar</Button>
          </div>
        )}
        {quote.approval.status === "PENDING" && !can("commercial.quotes.approve") && (
          <p className="text-xs text-muted-foreground">Pontuação abaixo do mínimo: a gestão foi avisada para liberar. Até lá, não sai PDF nem envio.</p>
        )}
        {manage && (
          <>
            <Button size="sm" variant="outline" disabled={!released || run.isPending} onClick={() => run.mutate("pdf")}><FileDown className="mr-1 h-4 w-4" /> Gerar PDF</Button>
            {(quote.status === "DRAFT" || quote.status === "NEGOTIATION") && (
              <Button size="sm" variant="outline" disabled={!released || run.isPending} onClick={() => run.mutate("sent")}><Send className="mr-1 h-4 w-4" /> Marcar como enviado</Button>
            )}
            {!["APPROVED", "REJECTED", "CANCELLED"].includes(quote.status) && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="text-success" disabled={!released || run.isPending} onClick={() => setAccepting(true)}>Cliente aceitou</Button>
                <Button size="sm" variant="outline" className="text-destructive" disabled={run.isPending} onClick={() => run.mutate("rejected")}>Cliente recusou</Button>
              </div>
            )}
            <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate("version")}>
              <Copy className="mr-1 h-4 w-4" /> {quote.status === "APPROVED" ? "Alterar contrato (nova versão)" : "Nova versão"}
            </Button>
            {quote.status === "APPROVED" && quote.kind !== "ADENDO" && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/comercial/orcamentos/novo?clientId=${quote.client.id}&addendumOf=${quote.id}${quote.opportunity ? `&opportunityId=${quote.opportunity.id}` : ""}`)}>
                <Plus className="mr-1 h-4 w-4" /> Adendo
              </Button>
            )}
            {quote.status === "APPROVED" && can("commercial.manage") && (
              <Button size="sm" variant="outline" onClick={() => setCompetence((quote.competenceDate ?? new Date().toISOString()).slice(0, 10))}>Transferir competência</Button>
            )}
            {quote.status === "APPROVED" && (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={run.isPending} onClick={() => run.mutate("cancelContract")}>Cancelar contrato</Button>
            )}
            {quote.status === "CANCELLED" && (
              <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate("reactivate")}>Reativar (volta a rascunho)</Button>
            )}
            {quote.status === "DRAFT" && (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={run.isPending} onClick={() => confirm("Excluir este rascunho?") && run.mutate("delete")}>
                <Trash2 className="mr-1 h-4 w-4" /> Excluir rascunho
              </Button>
            )}
          </>
        )}
      </CardContent>

      {competence !== null && (
        <Dialog open onOpenChange={(v) => !v && setCompetence(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Transferir competência</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Muda o mês da venda para comissões e DRE. Os vencimentos não mudam.</p>
            <Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCompetence(null)}>Cancelar</Button>
              <Button disabled={!competence || run.isPending} onClick={() => run.mutate("competence")}>Transferir</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {accepting && (
        <AcceptDialog quoteId={quote.id} withFinance={withFinance} setWithFinance={setWithFinance} pending={run.isPending} onConfirm={() => run.mutate("accepted")} onClose={() => setAccepting(false)} />
      )}

      <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{deciding === "APPROVE" ? "Liberar pontuação" : "Recusar liberação"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Pontuação {pts(quote.score)} no total de {formatCurrency(quote.total)}.</p>
          <Textarea rows={3} placeholder={deciding === "APPROVE" ? "Observação (opcional)" : "Motivo — o vendedor vê para ajustar"} value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancelar</Button>
            <Button disabled={run.isPending || (deciding === "REJECT" && !note.trim())} onClick={() => run.mutate("decide")}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AcceptDialog(props: { quoteId: string; withFinance: boolean; setWithFinance: (v: boolean) => void; pending: boolean; onConfirm: () => void; onClose: () => void }) {
  const plan = useQuery({ queryKey: ["quote-finance-preview", props.quoteId], queryFn: () => apiGet<{ data: PlannedEntry[] }>(`/commercial/quotes/${props.quoteId}/finance-preview`) });
  const rows = plan.data?.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Cliente aceitou o orçamento</DialogTitle></DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.withFinance} onChange={(e) => props.setWithFinance(e.target.checked)} />
          Lançar parcelas, taxas e comissões no financeiro
        </label>
        {props.withFinance && (plan.isLoading ? <p className="text-sm text-muted-foreground">Calculando…</p> : <FinanceList rows={rows.map((r, i) => ({ key: String(i), type: r.type, description: r.description, day: r.dueDay, amount: r.amount }))} />)}
        <p className="text-xs text-muted-foreground">Se a oportunidade já tinha o recebível único de quando foi ganha, ele é trocado por estas parcelas.</p>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>Cancelar</Button>
          <Button disabled={props.pending} onClick={props.onConfirm}>Confirmar aceite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinanceList({ rows }: { rows: { key: string; type: "RECEITA" | "DESPESA"; description: string | null; day: string; amount: number; status?: string }[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nada a lançar.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-1.5">
          <span className="min-w-0">
            <span className="block truncate">{r.description}</span>
            <span className="text-xs text-muted-foreground">vence {dayBR(r.day)}{r.status ? ` · ${r.status === "PAGO" ? "pago" : "pendente"}` : ""}</span>
          </span>
          <span className={`shrink-0 font-medium ${r.type === "RECEITA" ? "text-success" : "text-destructive"}`}>
            {r.type === "RECEITA" ? "+" : "-"} {formatCurrency(r.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PromobImportButton({ projectId, onPick }: { projectId: string; onPick: (items: ItemForm[]) => void }) {
  const [open, setOpen] = useState(false);
  const imports = useQuery({
    queryKey: ["promob-imports", projectId],
    queryFn: () => apiGet<{ data: { id: string; fileName: string; status: string; totalValue: number | null; createdAt: string }[] }>(`/promob/projects/${projectId}/imports`),
    enabled: open,
  });
  const pick = useMutation({
    mutationFn: (importId: string) => apiGet<{ data: { rooms: { room: string; cost: number }[]; warning: string | null } }>(`/commercial/quotes/promob/${importId}`),
    onSuccess: (r) => {
      if (!r.data.rooms.length) return toast.error(r.data.warning ?? "Sem valores no arquivo");
      onPick(r.data.rooms.map((x) => ({ ...emptyItem(), room: x.room, description: "Móveis planejados", unitCost: toField(x.cost) })));
      toast.success(`${r.data.rooms.length} ambiente(s) trazidos do Promob — confira se o valor é o custo`);
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao ler o Promob")),
  });
  const rows = (imports.data?.data ?? []).filter((i) => i.status === "PARSED");
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Trazer do Promob</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Custos a partir do Promob</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Soma o valor das peças por ambiente e substitui a lista atual.</p>
          {imports.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma importação lida neste projeto.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <span>{i.fileName}<span className="block text-xs text-muted-foreground">{formatDate(i.createdAt)}{i.totalValue != null ? ` · ${formatCurrency(i.totalValue)}` : ""}</span></span>
                  <Button size="sm" disabled={pick.isPending} onClick={() => pick.mutate(i.id)}>Usar</Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------------ configuração

function PricingConfigDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["quotes", "config"], queryFn: () => apiGet<{ data: PricingConfig }>("/commercial/quotes/config") });
  const [c, setC] = useState<PricingConfig | null>(null);
  useEffect(() => {
    if (q.data && !c) setC(q.data.data);
  }, [q.data, c]);
  const save = useMutation({
    mutationFn: () => apiPut<{ message: string }>("/commercial/quotes/config", c && { ...c, document: { ...c.document, notes: c.document.notes.map((n) => n.trim()).filter(Boolean) } }),
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["quotes", "config"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Configuração de preços</DialogTitle></DialogHeader>
        {!c ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Mark-up padrão"><NumInput value={c.defaultMarkup} onChange={(v) => setC({ ...c, defaultMarkup: v })} /></Field>
              <Field label="Pontuação mínima"><NumInput value={c.minScore} onChange={(v) => setC({ ...c, minScore: v })} /></Field>
              <Field label="Validade (dias)"><NumInput value={c.validityDays} onChange={(v) => setC({ ...c, validityDays: Math.round(v) })} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">
              A pontuação é o mark-up que sobra depois de desconto, taxa da financeira, comissões, frete e outros custos. Abaixo do mínimo, o orçamento precisa de liberação.
            </p>

            <div className="space-y-2">
              <p className="font-medium">Comissões padrão</p>
              {c.commissionRoles.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_80px_32px] gap-2">
                  <Input placeholder="Código" value={r.role} onChange={(e) => setC({ ...c, commissionRoles: c.commissionRoles.map((x, k) => (k === i ? { ...x, role: e.target.value.toUpperCase() } : x)) })} />
                  <Input placeholder="Nome" value={r.label} onChange={(e) => setC({ ...c, commissionRoles: c.commissionRoles.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                  <NumInput value={r.defaultPercent} onChange={(v) => setC({ ...c, commissionRoles: c.commissionRoles.map((x, k) => (k === i ? { ...x, defaultPercent: v } : x)) })} />
                  <Button variant="ghost" size="icon" aria-label="Remover" disabled={c.commissionRoles.length === 1} onClick={() => setC({ ...c, commissionRoles: c.commissionRoles.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setC({ ...c, commissionRoles: [...c.commissionRoles, { role: "", label: "", defaultPercent: 0 }] })}><Plus className="mr-1 h-4 w-4" /> Papel</Button>
            </div>

            <div className="space-y-2">
              <p className="font-medium">Financeiras e cartão</p>
              {c.financingPlans.length === 0 && <p className="text-xs text-muted-foreground">Nenhum plano. Ex.: "Santander 19x sem entrada", 19 parcelas, taxa retida 12%.</p>}
              {c.financingPlans.map((p, i) => {
                const upd = (patch: Partial<FinancingPlan>) => setC({ ...c, financingPlans: c.financingPlans.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded border p-2 sm:grid-cols-[1.6fr_1fr_70px_80px_auto_32px] sm:items-end">
                    <Field label="Nome"><Input value={p.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                    <Field label="Tipo">
                      <Select value={p.method} onValueChange={(v) => upd({ method: v as FinancingPlan["method"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="FINANCEIRA">Financeira</SelectItem><SelectItem value="CARTAO">Cartão</SelectItem></SelectContent>
                      </Select>
                    </Field>
                    <Field label="Parcelas"><NumInput value={p.installments} onChange={(v) => upd({ installments: Math.round(v) })} /></Field>
                    <Field label="Taxa %"><NumInput value={p.feePercent} onChange={(v) => upd({ feePercent: v })} /></Field>
                    <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" checked={p.requiresDownPayment} onChange={(e) => upd({ requiresDownPayment: e.target.checked })} /> exige entrada</label>
                    <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => setC({ ...c, financingPlans: c.financingPlans.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setC({ ...c, financingPlans: [...c.financingPlans, { id: `plano-${Date.now().toString(36)}`, name: "", method: "FINANCEIRA", installments: 10, feePercent: 0, requiresDownPayment: false }] })}
              >
                <Plus className="mr-1 h-4 w-4" /> Plano
              </Button>
            </div>

            <div className="space-y-2">
              <p className="font-medium">Orçamento em PDF (modelo da loja)</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.4fr_1fr_90px]">
                <Field label="Fornecedor"><Input value={c.document.supplier} onChange={(e) => setC({ ...c, document: { ...c.document, supplier: e.target.value } })} /></Field>
                <Field label="Linha"><Input value={c.document.line} onChange={(e) => setC({ ...c, document: { ...c.document, line: e.target.value } })} /></Field>
                <Field label="Prazo (dias)"><NumInput value={c.document.deliveryDays} onChange={(v) => setC({ ...c, document: { ...c.document, deliveryDays: Math.max(1, Math.round(v)) } })} /></Field>
              </div>
              <Field label="Prazo de entrega (texto)"><Input value={c.document.deliveryText} onChange={(e) => setC({ ...c, document: { ...c.document, deliveryText: e.target.value } })} /></Field>
              <Field label="Observações fixas do rodapé — uma por linha (viram OBS, OBS², OBS³…)">
                <Textarea rows={7} value={c.document.notes.join("\n")} onChange={(e) => setC({ ...c, document: { ...c.document, notes: e.target.value.split("\n") } })} />
              </Field>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!c || save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(toField(value) || "0");
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
    />
  );
}
