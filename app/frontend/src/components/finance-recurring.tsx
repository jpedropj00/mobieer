import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Recurring = {
  id: string;
  type: "DESPESA" | "RECEITA";
  description: string;
  category: string;
  amount: number;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  method: string | null;
  active: boolean;
  generated: number;
  paid: number;
  nextOpen: string | null;
  lastMonth: string | null;
};
type FinanceRequest = {
  id: string;
  type: "DESPESA" | "RECEITA";
  description: string;
  category: string | null;
  amount: number;
  dueDate: string | null;
  supplierName: string | null;
  status: "PENDENTE" | "APROVADA" | "RECUSADA";
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
};

const thisMonth = () => new Date().toISOString().slice(0, 7);
const mm = (m: string | null) => (m ? m.split("-").reverse().join("/") : "—");
const REQ_STATUS: Record<FinanceRequest["status"], { label: string; variant: "warning" | "success" | "danger" }> = {
  PENDENTE: { label: "Aguardando", variant: "warning" },
  APROVADA: { label: "Aprovada", variant: "success" },
  RECUSADA: { label: "Recusada", variant: "danger" },
};

// ------------------------------------------------------------------ fixos

/** Despesas e receitas fixas: cada uma gera a parcela do mês no financeiro. */
export function RecurringTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const q = useQuery({ queryKey: ["finance", "recurring"], queryFn: () => apiGet<{ data: Recurring[] }>("/finance/recurring") });
  const gen = useMutation({
    mutationFn: (id: string) => apiPost<{ message: string }>(`/finance/recurring/${id}/generate`, { months: 12 }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao lançar")),
  });
  const rows = q.data?.data ?? [];
  const monthly = rows.filter((r) => r.active && r.type === "DESPESA").reduce((s, r) => s + r.amount, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {can("finance.manage") && <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> Lançamento fixo</Button>}
        <span className="text-sm text-muted-foreground">Despesas fixas ativas: <strong>{formatCurrency(monthly)}</strong> por mês. O sistema mantém sempre o mês atual e os 2 próximos lançados.</span>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum lançamento fixo. Ex.: aluguel, internet, contador, pró-labore.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Próxima</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.active ? "" : "opacity-60"}>
                    <TableCell>
                      <span className="font-medium">{r.description}</span>
                      <span className="block text-xs text-muted-foreground">{r.type === "DESPESA" ? "a pagar" : "a receber"} · {r.generated} lançada(s), {r.paid} paga(s)</span>
                    </TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                    <TableCell>dia {r.dayOfMonth}</TableCell>
                    <TableCell>{mm(r.startMonth)} {r.endMonth ? `a ${mm(r.endMonth)}` : "em diante"}{!r.active && <Badge variant="muted" className="ml-2">inativo</Badge>}</TableCell>
                    <TableCell>{r.nextOpen ? formatDate(r.nextOpen) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {can("finance.manage") && (
                        <div className="flex justify-end gap-1">
                          {r.active && <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate(r.id)} title="Lança os próximos 12 meses">+12 meses</Button>}
                          <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {editing && <RecurringDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["finance"] }); }} />}
    </div>
  );
}

function RecurringDialog({ item, onClose, onSaved }: { item: Recurring | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    type: item?.type ?? "DESPESA",
    description: item?.description ?? "",
    category: item?.category ?? "",
    amount: item ? String(item.amount).replace(".", ",") : "",
    dayOfMonth: String(item?.dayOfMonth ?? 10),
    startMonth: item?.startMonth ?? thisMonth(),
    endMonth: item?.endMonth ?? "",
    method: item?.method ?? "",
    active: item?.active ?? true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, amount: Number(f.amount.replace(/\./g, "").replace(",", ".")), dayOfMonth: Number(f.dayOfMonth), endMonth: f.endMonth || null, method: f.method || null };
      return item ? apiPut<{ message: string }>(`/finance/recurring/${item.id}`, body) : apiPost<{ message: string }>("/finance/recurring", body);
    },
    onSuccess: (r) => { toast.success(r.message); onSaved(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{item ? "Editar lançamento fixo" : "Novo lançamento fixo"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={f.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="DESPESA">Despesa (a pagar)</SelectItem><SelectItem value="RECEITA">Receita (a receber)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Valor mensal (R$)</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Descrição</Label><Input placeholder="Aluguel da loja" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Categoria</Label><Input placeholder="Aluguel" value={f.category} onChange={(e) => set("category", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Dia do vencimento</Label><Input type="number" min={1} max={31} value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Primeiro mês</Label><Input type="month" value={f.startMonth} onChange={(e) => set("startMonth", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Último mês (opcional)</Label><Input type="month" value={f.endMonth} onChange={(e) => set("endMonth", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Forma de pagamento</Label><Input placeholder="Boleto, débito automático, PIX…" value={f.method} onChange={(e) => set("method", e.target.value)} /></div>
          {item && <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Ativo (desativar tira as parcelas futuras não pagas)</label>}
          {item && <p className="col-span-2 text-xs text-muted-foreground">Mudar valor ou categoria ajusta as parcelas pendentes deste mês em diante; as já pagas não mudam.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || f.description.trim().length < 2 || !f.category.trim() || !f.amount} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ solicitações

/** Solicitações de débito/crédito: quem pede vê as suas; o financeiro decide. */
export function FinanceRequestsPanel({ standalone = false }: { standalone?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const decide = can("finance.manage");
  const [status, setStatus] = useState<"PENDENTE" | "APROVADA" | "RECUSADA" | "ALL">("PENDENTE");
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ r: FinanceRequest; approve: boolean } | null>(null);
  const q = useQuery({
    queryKey: ["finance", "requests", status],
    queryFn: () => apiGet<{ data: FinanceRequest[] }>("/finance/requests", status === "ALL" ? undefined : { status }),
  });
  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-4">
      {standalone && <PageHeader title="Solicitações ao financeiro" description="Peça um pagamento (débito) ou registre um valor a receber (crédito). O financeiro aprova e lança." />}
      <div className="flex flex-wrap items-center gap-2">
        {can("finance.request") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" /> Nova solicitação</Button>}
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDENTE">Aguardando</SelectItem>
            <SelectItem value="APROVADA">Aprovadas</SelectItem>
            <SelectItem value="RECUSADA">Recusadas</SelectItem>
            <SelectItem value="ALL">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma solicitação aqui.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solicitação</TableHead>
                  <TableHead>Quem pediu</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{r.description}</span>
                      <span className="block text-xs text-muted-foreground">{r.type === "DESPESA" ? "Débito (a pagar)" : "Crédito (a receber)"}{r.supplierName ? ` · ${r.supplierName}` : ""}{r.category ? ` · ${r.category}` : ""}</span>
                    </TableCell>
                    <TableCell>{r.requestedBy ?? "—"}<span className="block text-xs text-muted-foreground">{formatDate(r.createdAt)}</span></TableCell>
                    <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                    <TableCell>{r.dueDate ? formatDate(r.dueDate) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={REQ_STATUS[r.status].variant}>{REQ_STATUS[r.status].label}</Badge>
                      {r.decisionNote && <span className="block text-xs text-muted-foreground">{r.decidedBy}: {r.decisionNote}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {decide && r.status === "PENDENTE" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" onClick={() => setDeciding({ r, approve: true })}><CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar</Button>
                          <Button size="sm" variant="outline" onClick={() => setDeciding({ r, approve: false })}><XCircle className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {creating && <RequestDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["finance", "requests"] }); }} />}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); qc.invalidateQueries({ queryKey: ["finance"] }); }} />}
    </div>
  );
}

function RequestDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ type: "DESPESA", description: "", amount: "", dueDate: "", supplierName: "", category: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/finance/requests", { ...f, amount: Number(f.amount.replace(/\./g, "").replace(",", ".")), dueDate: f.dueDate ? `${f.dueDate}T00:00:00.000Z` : null, supplierName: f.supplierName || null, category: f.category || null }),
    onSuccess: (r) => { toast.success(r.message); onSaved(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar")),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova solicitação ao financeiro</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={f.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="DESPESA">Débito — pagar alguém</SelectItem><SelectItem value="RECEITA">Crédito — receber de alguém</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Valor (R$)</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>O que é</Label><Textarea rows={2} placeholder="Ex.: compra de parafusos para a obra 402-1" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{f.type === "DESPESA" ? "Pagar a" : "Receber de"}</Label><Input value={f.supplierName} onChange={(e) => set("supplierName", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Vencimento</Label><Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Categoria (opcional)</Label><Input value={f.category} onChange={(e) => set("category", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || f.description.trim().length < 3 || !f.amount} onClick={() => save.mutate()}>Enviar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ r, approve, onClose, onDone }: { r: FinanceRequest; approve: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [category, setCategory] = useState(r.category ?? "");
  const [dueDate, setDueDate] = useState(r.dueDate ? r.dueDate.slice(0, 10) : "");
  const run = useMutation({
    mutationFn: () => apiPost<{ message: string }>(`/finance/requests/${r.id}/decide`, { decision: approve ? "APPROVE" : "REJECT", note: note || null, category: category || null, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null }),
    onSuccess: (x) => { toast.success(x.message); onDone(); },
    onError: (e) => toast.error(errorMessage(e, "Falha")),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{approve ? "Aprovar e lançar" : "Recusar solicitação"}</DialogTitle></DialogHeader>
        <p className="text-sm">{r.description} — <strong>{formatCurrency(r.amount)}</strong></p>
        {approve && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1.5"><Label>Categoria</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Vencimento</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
        )}
        <Textarea rows={2} placeholder={approve ? "Observação (opcional)" : "Motivo — quem pediu vai ver"} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={run.isPending || (!approve && !note.trim())} onClick={() => run.mutate()}>{approve ? "Aprovar" : "Recusar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
