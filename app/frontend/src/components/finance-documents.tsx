import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarClock, CheckCircle2, FileText, Loader2, Paperclip, Plus, Receipt, RotateCcw, Trash2, Undo2, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";
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
import { EmptyState } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Tipos e formatação
// ---------------------------------------------------------------------------

type Situation = "PENDENTE" | "A_VENCER" | "VENCIDO" | "PARCIAL" | "PAGO" | "CANCELADO";

type FinanceDoc = {
  id: string;
  type: "RECEITA" | "DESPESA";
  docType: string;
  docNumber: string | null;
  category: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  issueDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  method: string | null;
  status: string;
  situation: Situation;
  situationLabel: string;
  alertDays: number;
  description: string | null;
  notes: string | null;
  purchaseRef: string | null;
  supplier: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  responsible: { id: string; name: string } | null;
  paymentCount: number;
  attachmentCount: number;
};

type DocDetail = FinanceDoc & {
  payments: {
    id: string;
    amount: number;
    paidAt: string;
    method: string | null;
    note: string | null;
    createdBy: { id: string; name: string } | null;
    receipt: { name: string | null } | null;
  }[];
  attachments: { id: string; kind: string; fileName: string; size: number | null; uploadedBy: { name: string } | null; createdAt: string }[];
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");

const DOC_LABEL: Record<string, string> = {
  BOLETO: "Boleto",
  FATURA: "Fatura",
  NOTA_FISCAL: "Nota fiscal",
  RECIBO: "Recibo",
  OUTROS: "Outros",
};

/** Cada situação tem sua cor; vencido e a vencer são os que puxam o olho. */
const SITUATION_STYLE: Record<Situation, { variant: "success" | "muted" | "warning" | "danger" | "secondary"; row?: string }> = {
  VENCIDO: { variant: "danger", row: "bg-destructive/5" },
  A_VENCER: { variant: "warning", row: "bg-warning/5" },
  PARCIAL: { variant: "secondary" },
  PENDENTE: { variant: "muted" },
  PAGO: { variant: "success" },
  CANCELADO: { variant: "muted" },
};

const hoje = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/** Documentos financeiros: boletos, faturas, notas e recibos com vencimento. */
export function FinanceDocuments() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeGerenciar = can("finance.documents.manage") || can("finance.manage");
  const podePagar = can("finance.documents.pay") || can("finance.manage");

  const [filtros, setFiltros] = useState({ situation: "", docType: "", supplierId: "", q: "" });
  const [grouping, setGrouping] = useState<"day" | "week" | "month">("week");
  const [aberto, setAberto] = useState<string | null>(null);
  const [form, setForm] = useState(false);

  const params = useMemo(() => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)), [filtros]);

  const lista = useQuery({
    queryKey: ["finance-docs", params],
    queryFn: () => apiGet<{ data: { items: FinanceDoc[]; totals: { count: number; amount: number; remaining: number } } }>("/finance/documents", params),
  });
  const vencimentos = useQuery({
    queryKey: ["finance-docs", "due", grouping, params],
    queryFn: () =>
      apiGet<{ data: { grouping: string; alertDays: number; groups: { bucket: string; total: number; remaining: number; count: number; items: FinanceDoc[] }[] } }>(
        "/finance/documents/due",
        { ...params, grouping }
      ),
  });
  const painel = useQuery({
    queryKey: ["finance-docs", "dashboard"],
    queryFn: () =>
      apiGet<{
        data: {
          alertDays: number;
          totais: { aPagar: number; pago: number; vencido: number; aVencer: number };
          porCategoria: { category: string; total: number; remaining: number; count: number }[];
          porFornecedor: { supplier: string; total: number; remaining: number; count: number }[];
          movimentacoes: { id: string; category: string; amount: number; date: string | null; kind: string }[];
        };
      }>("/finance/documents/dashboard"),
  });
  const opcoes = useQuery({
    queryKey: ["finance-docs", "options"],
    queryFn: () =>
      apiGet<{ data: { docTypes: string[]; situations: { value: Situation; label: string }[]; alertDayOptions: number[]; defaultAlertDays: number } }>(
        "/finance/documents/options"
      ),
  });
  const fornecedores = useQuery({
    queryKey: ["suppliers", "picklist"],
    queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/suppliers"),
    staleTime: 5 * 60_000,
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["finance-docs"] });

  const itens = lista.data?.data.items ?? [];
  const totais = painel.data?.data.totais;

  return (
    <div className="space-y-4">
      {/* Painel */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric titulo="A pagar" valor={totais?.aPagar} icone={Wallet} />
        <Metric titulo="Vencido" valor={totais?.vencido} icone={AlertTriangle} tom="danger" />
        <Metric titulo="Próximo do vencimento" valor={totais?.aVencer} icone={CalendarClock} tom="warning" />
        <Metric titulo="Pago" valor={totais?.pago} icone={CheckCircle2} tom="success" />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[180px] flex-1">
            <Label htmlFor="fd-q">Buscar</Label>
            <Input
              id="fd-q"
              placeholder="Número, fornecedor, categoria…"
              value={filtros.q}
              onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
          <Filtro label="Situação" value={filtros.situation} onChange={(v) => setFiltros((f) => ({ ...f, situation: v }))}
            itens={(opcoes.data?.data.situations ?? []).map((s) => ({ value: s.value, label: s.label }))} />
          <Filtro label="Tipo" value={filtros.docType} onChange={(v) => setFiltros((f) => ({ ...f, docType: v }))}
            itens={(opcoes.data?.data.docTypes ?? []).map((t) => ({ value: t, label: DOC_LABEL[t] ?? t }))} />
          <Filtro label="Fornecedor" value={filtros.supplierId} onChange={(v) => setFiltros((f) => ({ ...f, supplierId: v }))}
            itens={(fornecedores.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          {podeGerenciar && (
            <Button onClick={() => setForm(true)} className="ml-auto">
              <Plus className="h-4 w-4" /> Novo documento
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista">Documentos ({itens.length})</TabsTrigger>
          <TabsTrigger value="vencimentos">Vencimentos</TabsTrigger>
          <TabsTrigger value="quebras">Por categoria e fornecedor</TabsTrigger>
        </TabsList>

        <TabsContent value="lista">
          <Card>
            <CardContent className="pt-6">
              {lista.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : itens.length === 0 ? (
                <EmptyState title="Nenhum documento" description="Cadastre boletos, faturas e notas para acompanhar os vencimentos." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Documento</TableHead>
                        <TableHead>Fornecedor</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.map((d) => (
                        <TableRow
                          key={d.id}
                          className={`cursor-pointer ${SITUATION_STYLE[d.situation]?.row ?? ""}`}
                          onClick={() => setAberto(d.id)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{DOC_LABEL[d.docType] ?? d.docType}{d.docNumber ? ` ${d.docNumber}` : ""}</p>
                                {d.description && <p className="line-clamp-1 text-xs text-muted-foreground">{d.description}</p>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{d.supplier?.name ?? "—"}</TableCell>
                          <TableCell className="text-sm">{d.category}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(d.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{d.remaining > 0 ? brl(d.remaining) : "—"}</TableCell>
                          <TableCell className="text-sm tabular-nums">{dmy(d.dueDate)}</TableCell>
                          <TableCell>
                            <Badge variant={SITUATION_STYLE[d.situation]?.variant ?? "muted"}>{d.situationLabel}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vencimentos">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" /> O que vence
                </span>
                <div className="flex gap-1">
                  {(["day", "week", "month"] as const).map((g) => (
                    <Button key={g} size="sm" variant={grouping === g ? "default" : "outline"} onClick={() => setGrouping(g)}>
                      {g === "day" ? "Dia" : g === "week" ? "Semana" : "Mês"}
                    </Button>
                  ))}
                </div>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Avisamos {vencimentos.data?.data.alertDays ?? 3} dia(s) antes do vencimento. Do mais próximo para o mais distante.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {(vencimentos.data?.data.groups ?? []).length === 0 ? (
                <EmptyState title="Nada a vencer" description="Nenhum documento com vencimento no filtro atual." />
              ) : (
                (vencimentos.data?.data.groups ?? []).map((g) => (
                  <div key={g.bucket}>
                    <div className="mb-2 flex items-baseline justify-between border-b border-border pb-1">
                      <p className="font-medium">{rotuloBalde(g.bucket, grouping)}</p>
                      <p className="text-sm text-muted-foreground">
                        {g.count} documento(s) · <span className="font-medium tabular-nums text-foreground">{brl(g.remaining)}</span> em aberto
                      </p>
                    </div>
                    <div className="space-y-1">
                      {g.items.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setAberto(d.id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 ${SITUATION_STYLE[d.situation]?.row ?? ""}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge variant={SITUATION_STYLE[d.situation]?.variant ?? "muted"}>{d.situationLabel}</Badge>
                            <span className="truncate">
                              {dmy(d.dueDate)} · {d.supplier?.name ?? d.category}
                              {d.docNumber ? ` · ${d.docNumber}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums font-medium">{brl(d.remaining || d.amount)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quebras">
          <div className="grid gap-4 lg:grid-cols-2">
            <Quebra titulo="Despesas por categoria" linhas={painel.data?.data.porCategoria.map((c) => ({ nome: c.category, total: c.total, saldo: c.remaining, count: c.count })) ?? []} />
            <Quebra titulo="Despesas por fornecedor" linhas={painel.data?.data.porFornecedor.map((f) => ({ nome: f.supplier, total: f.total, saldo: f.remaining, count: f.count })) ?? []} />
          </div>
        </TabsContent>
      </Tabs>

      {form && <DocumentoForm onClose={() => setForm(false)} onSaved={recarregar} opcoes={opcoes.data?.data} fornecedores={fornecedores.data?.data ?? []} />}
      {aberto && (
        <DocumentoDetalhe
          id={aberto}
          onClose={() => setAberto(null)}
          onChanged={recarregar}
          podeGerenciar={podeGerenciar}
          podePagar={podePagar}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças da tela
// ---------------------------------------------------------------------------

function Metric({ titulo, valor, icone: Icone, tom }: { titulo: string; valor?: number; icone: typeof Wallet; tom?: "danger" | "warning" | "success" }) {
  const cor = tom === "danger" ? "text-destructive" : tom === "warning" ? "text-warning" : tom === "success" ? "text-success" : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <Icone className={`h-5 w-5 ${cor}`} />
        <div>
          <p className="text-xs text-muted-foreground">{titulo}</p>
          <p className={`text-xl font-semibold tabular-nums ${cor}`}>{valor === undefined ? "—" : brl(valor)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Filtro({ label, value, onChange, itens }: { label: string; value: string; onChange: (v: string) => void; itens: { value: string; label: string }[] }) {
  return (
    <div className="min-w-[150px]">
      <Label>{label}</Label>
      <Select value={value || "__todos"} onValueChange={(v) => onChange(v === "__todos" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__todos">Todos</SelectItem>
          {itens.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Quebra({ titulo, linhas }: { titulo: string; linhas: { nome: string; total: number; saldo: number; count: number }[] }) {
  const maior = Math.max(1, ...linhas.map((l) => l.total));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados no período.</p>
        ) : (
          linhas.map((l) => (
            <div key={l.nome}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="truncate">{l.nome}</span>
                <span className="shrink-0 tabular-nums">
                  {brl(l.total)} <span className="text-xs text-muted-foreground">({l.count})</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(l.total / maior) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** "2026-09-14" (semana), "2026-09" (mês) ou "2026-09-18" (dia) em texto legível. */
function rotuloBalde(bucket: string, grouping: "day" | "week" | "month") {
  if (grouping === "month") {
    const [ano, mes] = bucket.split("-");
    return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }
  const d = new Date(`${bucket}T12:00:00Z`);
  if (grouping === "day") return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const fim = new Date(d);
  fim.setDate(fim.getDate() + 6);
  return `Semana de ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${fim.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

function DocumentoForm({
  onClose,
  onSaved,
  opcoes,
  fornecedores,
}: {
  onClose: () => void;
  onSaved: () => void;
  opcoes?: { docTypes: string[]; alertDayOptions: number[]; defaultAlertDays: number };
  fornecedores: { id: string; name: string }[];
}) {
  const [v, setV] = useState({
    type: "DESPESA",
    docType: "BOLETO",
    docNumber: "",
    category: "",
    amount: "",
    issueDate: hoje(),
    dueDate: "",
    method: "",
    description: "",
    notes: "",
    purchaseRef: "",
    supplierId: "",
    alertDays: "",
  });

  const salvar = useMutation({
    mutationFn: () =>
      apiPost("/finance/documents", {
        ...v,
        amount: Number(v.amount.replace(",", ".")),
        docNumber: v.docNumber || null,
        dueDate: v.dueDate || null,
        issueDate: v.issueDate || null,
        method: v.method || null,
        description: v.description || null,
        notes: v.notes || null,
        purchaseRef: v.purchaseRef || null,
        supplierId: v.supplierId || null,
        alertDays: v.alertDays ? Number(v.alertDays) : null,
      }),
    onSuccess: () => {
      toast.success("Documento cadastrado");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível cadastrar")),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo documento financeiro</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <Campo label="Tipo de documento *">
            <Select value={v.docType} onValueChange={(x) => setV({ ...v, docType: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(opcoes?.docTypes ?? []).map((t) => (
                  <SelectItem key={t} value={t}>{DOC_LABEL[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Número do documento">
            <Input value={v.docNumber} onChange={(e) => setV({ ...v, docNumber: e.target.value })} placeholder="NF 12345" />
          </Campo>
          <Campo label="Categoria *">
            <Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="Matéria-prima, energia…" />
          </Campo>
          <Campo label="Valor *">
            <Input value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" inputMode="decimal" />
          </Campo>
          <Campo label="Fornecedor">
            <Select value={v.supplierId || "__nenhum"} onValueChange={(x) => setV({ ...v, supplierId: x === "__nenhum" ? "" : x })}>
              <SelectTrigger><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__nenhum">Sem fornecedor</SelectItem>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Forma de pagamento">
            <Input value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })} placeholder="PIX, boleto, cartão…" />
          </Campo>
          <Campo label="Emissão">
            <Input type="date" value={v.issueDate} onChange={(e) => setV({ ...v, issueDate: e.target.value })} />
          </Campo>
          <Campo label="Vencimento">
            <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
          </Campo>
          <Campo label="Avisar antes do vencimento">
            <Select value={v.alertDays || "__padrao"} onValueChange={(x) => setV({ ...v, alertDays: x === "__padrao" ? "" : x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__padrao">Padrão da loja ({opcoes?.defaultAlertDays ?? 3} dias)</SelectItem>
                {(opcoes?.alertDayOptions ?? [1, 3, 5, 7]).map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} dia(s) antes</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Pedido / compra">
            <Input value={v.purchaseRef} onChange={(e) => setV({ ...v, purchaseRef: e.target.value })} placeholder="Referência do pedido" />
          </Campo>
          <Campo label="Descrição" className="sm:col-span-2">
            <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Campo>
          <Campo label="Observações" className="sm:col-span-2">
            <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !v.category || !v.amount}>
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhe, pagamentos e anexos
// ---------------------------------------------------------------------------

function DocumentoDetalhe({
  id,
  onClose,
  onChanged,
  podeGerenciar,
  podePagar,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  podeGerenciar: boolean;
  podePagar: boolean;
}) {
  const qc = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);
  const [pagamento, setPagamento] = useState<{ amount: string; paidAt: string; method: string; note: string } | null>(null);
  const comprovante = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: ["finance-doc", id], queryFn: () => apiGet<{ data: DocDetail }>(`/finance/documents/${id}`) });
  const d = q.data?.data;

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["finance-doc", id] });
    onChanged();
  };

  const pagar = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("amount", String(Number(pagamento!.amount.replace(",", "."))));
      fd.append("paidAt", pagamento!.paidAt);
      if (pagamento!.method) fd.append("method", pagamento!.method);
      if (pagamento!.note) fd.append("note", pagamento!.note);
      const f = comprovante.current?.files?.[0];
      if (f) fd.append("receipt", f);
      return apiPostForm<{ message?: string }>(`/finance/documents/${id}/payments`, fd);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Pagamento registrado");
      setPagamento(null);
      atualizar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível registrar o pagamento")),
  });

  const estornar = useMutation({
    mutationFn: (paymentId: string) => apiDelete(`/finance/documents/${id}/payments/${paymentId}`),
    onSuccess: () => { toast.success("Pagamento estornado"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível estornar")),
  });

  const anexar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "DOCUMENTO");
      return apiPostForm(`/finance/documents/${id}/attachments`, fd);
    },
    onSuccess: () => { toast.success("Arquivo anexado"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível anexar")),
  });

  const removerAnexo = useMutation({
    mutationFn: (attId: string) => apiDelete(`/finance/documents/attachments/${attId}`),
    onSuccess: () => { toast.success("Anexo removido"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível remover")),
  });

  const mudarEstado = useMutation({
    mutationFn: (acao: "cancel" | "reopen") => apiPost<{ message?: string }>(`/finance/documents/${id}/${acao}`, {}),
    onSuccess: (r: { message?: string }) => { toast.success(r.message ?? "Atualizado"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível alterar")),
  });

  const salvarAlerta = useMutation({
    mutationFn: (alertDays: number) => apiPatch(`/finance/documents/${id}`, { alertDays }),
    onSuccess: () => { toast.success("Antecedência do alerta salva"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        {!d ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {DOC_LABEL[d.docType] ?? d.docType} {d.docNumber}
                <Badge variant={SITUATION_STYLE[d.situation]?.variant ?? "muted"}>{d.situationLabel}</Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
                <Info rotulo="Valor" valor={brl(d.amount)} />
                <Info rotulo="Pago" valor={brl(d.paidAmount)} />
                <Info rotulo="Saldo em aberto" valor={brl(d.remaining)} destaque={d.remaining > 0} />
                <Info rotulo="Vencimento" valor={dmy(d.dueDate)} />
                <Info rotulo="Emissão" valor={dmy(d.issueDate)} />
                <Info rotulo="Fornecedor" valor={d.supplier?.name ?? "—"} />
                <Info rotulo="Categoria" valor={d.category} />
                <Info rotulo="Forma" valor={d.method ?? "—"} />
                <Info rotulo="Responsável" valor={d.responsible?.name ?? "—"} />
              </div>

              {d.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{d.notes}</p>}

              {/* Pagamentos */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-medium">
                    <Receipt className="h-4 w-4" /> Pagamentos ({d.payments.length})
                  </h3>
                  {podePagar && d.remaining > 0 && d.status !== "CANCELADO" && (
                    <Button size="sm" onClick={() => setPagamento({ amount: String(d.remaining).replace(".", ","), paidAt: hoje(), method: d.method ?? "", note: "" })}>
                      <Plus className="h-4 w-4" /> Registrar pagamento
                    </Button>
                  )}
                </div>
                {d.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
                ) : (
                  <div className="space-y-1">
                    {d.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium tabular-nums">{brl(p.amount)} <span className="font-normal text-muted-foreground">· {dmy(p.paidAt)}</span></p>
                          <p className="text-xs text-muted-foreground">
                            {p.method ?? "sem forma"} · {p.createdBy?.name ?? "—"}
                            {p.note ? ` · ${p.note}` : ""}
                            {p.receipt ? " · com comprovante" : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {p.receipt && (
                            <Button size="sm" variant="ghost" asChild>
                              <a href={`/api/finance/documents/payments/${p.id}/receipt`} target="_blank" rel="noreferrer">
                                <Paperclip className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          {podePagar && (
                            <Button size="sm" variant="ghost" onClick={() => estornar.mutate(p.id)} title="Estornar">
                              <Undo2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Anexos */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-medium">
                    <Paperclip className="h-4 w-4" /> Arquivos ({d.attachments.length})
                  </h3>
                  {podeGerenciar && (
                    <>
                      <input
                        ref={arquivo}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) anexar.mutate(f);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" variant="outline" onClick={() => arquivo.current?.click()} disabled={anexar.isPending}>
                        {anexar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Anexar
                      </Button>
                    </>
                  )}
                </div>
                {d.attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum arquivo. Anexe o boleto ou a nota.</p>
                ) : (
                  <div className="space-y-1">
                    {d.attachments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                        <a href={`/api/finance/documents/attachments/${a.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
                          {a.fileName}
                        </a>
                        {podeGerenciar && (
                          <Button size="sm" variant="ghost" onClick={() => removerAnexo.mutate(a.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Alerta */}
              {podeGerenciar && d.dueDate && (
                <section className="rounded-lg border border-border p-3">
                  <Label className="text-xs">Avisar antes do vencimento</Label>
                  <div className="mt-1 flex gap-1">
                    {[1, 3, 5, 7].map((n) => (
                      <Button key={n} size="sm" variant={d.alertDays === n ? "default" : "outline"} onClick={() => salvarAlerta.mutate(n)}>
                        {n} dia{n > 1 ? "s" : ""}
                      </Button>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2">
              {podeGerenciar && d.status !== "CANCELADO" && (
                <Button variant="outline" onClick={() => mudarEstado.mutate("cancel")} disabled={d.paymentCount > 0}>
                  <X className="h-4 w-4" /> Cancelar documento
                </Button>
              )}
              {podeGerenciar && d.status === "CANCELADO" && (
                <Button variant="outline" onClick={() => mudarEstado.mutate("reopen")}>
                  <RotateCcw className="h-4 w-4" /> Reabrir
                </Button>
              )}
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {/* Registrar pagamento */}
      {pagamento && (
        <Dialog open onOpenChange={() => setPagamento(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Registrar pagamento</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Campo label="Valor *">
                <Input value={pagamento.amount} onChange={(e) => setPagamento({ ...pagamento, amount: e.target.value })} inputMode="decimal" />
                <p className="text-xs text-muted-foreground">Saldo em aberto: {brl(d?.remaining ?? 0)}. Um valor menor deixa o documento em aberto.</p>
              </Campo>
              <Campo label="Data do pagamento *">
                <Input type="date" value={pagamento.paidAt} onChange={(e) => setPagamento({ ...pagamento, paidAt: e.target.value })} />
              </Campo>
              <Campo label="Forma de pagamento">
                <Input value={pagamento.method} onChange={(e) => setPagamento({ ...pagamento, method: e.target.value })} placeholder="PIX, boleto…" />
              </Campo>
              <Campo label="Comprovante">
                <Input ref={comprovante} type="file" />
              </Campo>
              <Campo label="Observação">
                <Textarea rows={2} value={pagamento.note} onChange={(e) => setPagamento({ ...pagamento, note: e.target.value })} />
              </Campo>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPagamento(null)}>Cancelar</Button>
              <Button onClick={() => pagar.mutate()} disabled={pagar.isPending || !pagamento.amount}>
                {pagar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function Info({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-sm tabular-nums ${destaque ? "font-semibold" : ""}`}>{valor}</p>
    </div>
  );
}
