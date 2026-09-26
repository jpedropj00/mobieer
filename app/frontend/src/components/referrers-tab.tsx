import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Referrer = {
  id: string;
  name: string;
  kind: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  pixKey: string | null;
  defaultRtPercent: number;
  notes: string | null;
  active: boolean;
  quotes: number;
  rtPending: number;
  rtPaid: number;
};
type Reserve = {
  id: string;
  amount: number;
  status: "PENDENTE" | "PAGO";
  dueDate: string | null;
  paidAt: string | null;
  description: string | null;
  referrer: { id: string; name: string; pixKey: string | null };
  client: { id: string; name: string } | null;
  originQuote: { number: string; version: number } | null;
};

const KIND_LABEL: Record<string, string> = { ARQUITETO: "Arquiteto(a)", DESIGNER: "Designer", CORRETOR: "Corretor(a)", CONSTRUTORA: "Construtora", PARCEIRO: "Parceiro", OUTRO: "Outro" };
const dayBR = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** Indicadores (arquitetos/parceiros) e as reservas técnicas a pagar. */
export function ReferrersTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Referrer | "new" | null>(null);
  const [status, setStatus] = useState<"PENDENTE" | "PAGO" | "ALL">("PENDENTE");
  const list = useQuery({ queryKey: ["referrers", "all"], queryFn: () => apiGet<{ data: Referrer[] }>("/referrers", { all: "1" }) });
  const reserves = useQuery({
    queryKey: ["referrers", "reserves", status],
    queryFn: () => apiGet<{ data: Reserve[] }>("/referrers/reserves", status === "ALL" ? undefined : { status }),
  });
  const pay = useMutation({
    mutationFn: (id: string) => apiPatch(`/finance/transactions/${id}`, { status: "PAGO" }),
    onSuccess: () => { toast.success("Reserva técnica marcada como paga"); qc.invalidateQueries({ queryKey: ["referrers"] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar o pagamento")),
  });
  const refs = list.data?.data ?? [];
  const rows = reserves.data?.data ?? [];
  const pendingTotal = rows.filter((r) => r.status === "PENDENTE").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-3">
          <CardTitle className="text-base">Indicadores</CardTitle>
          {can("commercial.manage") && <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> Indicador</Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {refs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Cadastre os arquitetos e parceiros que indicam clientes. No orçamento, escolha o indicador e a reserva técnica entra no preço.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">RT padrão</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">RT a pagar</TableHead>
                  <TableHead className="text-right">RT paga</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {refs.map((r) => (
                  <TableRow key={r.id} className={r.active ? "" : "opacity-60"}>
                    <TableCell>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{[r.phone, r.email].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell>{KIND_LABEL[r.kind] ?? r.kind}{!r.active && <Badge variant="muted" className="ml-2">inativo</Badge>}</TableCell>
                    <TableCell className="text-right">{r.defaultRtPercent.toString().replace(".", ",")}%</TableCell>
                    <TableCell className="text-right">{r.quotes}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.rtPending)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.rtPaid)}</TableCell>
                    <TableCell className="text-right">
                      {can("commercial.manage") && <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-3">
          <CardTitle className="text-base">Reservas técnicas {status === "PENDENTE" && rows.length > 0 ? `— ${formatCurrency(pendingTotal)} a pagar` : ""}</CardTitle>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDENTE">A pagar</SelectItem>
              <SelectItem value="PAGO">Pagas</SelectItem>
              <SelectItem value="ALL">Todas</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma reserva técnica {status === "PENDENTE" ? "a pagar" : "aqui"}. Elas aparecem quando um orçamento com indicador é aceito pelo cliente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicador</TableHead>
                  <TableHead>Cliente / orçamento</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.referrer.name}
                      {r.referrer.pixKey && <span className="block text-xs text-muted-foreground">PIX: {r.referrer.pixKey}</span>}
                    </TableCell>
                    <TableCell>
                      {r.client?.name ?? "—"}
                      {r.originQuote && <span className="block text-xs text-muted-foreground">{r.originQuote.number}{r.originQuote.version > 1 ? ` v${r.originQuote.version}` : ""}</span>}
                    </TableCell>
                    <TableCell>{r.status === "PAGO" ? `paga ${dayBR(r.paidAt)}` : dayBR(r.dueDate)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.amount)}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "PENDENTE" && can("finance.manage") && (
                        <Button size="sm" variant="outline" disabled={pay.isPending} onClick={() => confirm(`Registrar o pagamento de ${formatCurrency(r.amount)} para ${r.referrer.name}?`) && pay.mutate(r.id)}>
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Pagar
                        </Button>
                      )}
                      {r.status === "PAGO" && <Badge variant="success">paga</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && <ReferrerDialog referrer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["referrers"] }); }} />}
    </div>
  );
}

function ReferrerDialog({ referrer, onClose, onSaved }: { referrer: Referrer | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: referrer?.name ?? "",
    kind: referrer?.kind ?? "ARQUITETO",
    document: referrer?.document ?? "",
    phone: referrer?.phone ?? "",
    email: referrer?.email ?? "",
    pixKey: referrer?.pixKey ?? "",
    defaultRtPercent: referrer ? String(referrer.defaultRtPercent).replace(".", ",") : "10",
    notes: referrer?.notes ?? "",
    active: referrer?.active ?? true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, defaultRtPercent: Number(String(f.defaultRtPercent).replace(",", ".")) || 0 };
      return referrer ? apiPut<{ message: string }>(`/referrers/${referrer.id}`, body) : apiPost<{ message: string }>("/referrers", body);
    },
    onSuccess: (r) => { toast.success(r.message); onSaved(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{referrer ? "Editar indicador" : "Novo indicador"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2 space-y-1.5"><Label>Nome</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => set("kind", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>RT padrão (%)</Label><Input inputMode="decimal" value={f.defaultRtPercent} onChange={(e) => set("defaultRtPercent", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>CPF/CNPJ</Label><Input value={f.document} onChange={(e) => set("document", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Telefone</Label><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>E-mail</Label><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Chave PIX</Label><Input value={f.pixKey} onChange={(e) => set("pixKey", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Observações</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          {referrer && (
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Ativo</label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
