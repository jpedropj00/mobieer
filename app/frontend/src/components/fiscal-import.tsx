import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Party = { name: string | null; document: string | null };
type ParsedInvoice = { kind: "NFE" | "NFSE"; number: string | null; series: string | null; accessKey: string | null; issuedAt: string | null; amount: number | null; issuer: Party; recipient: Party; description: string | null };
type PreviewItem =
  | { fileName: string; type: "UNKNOWN"; reason: string }
  | { fileName: string; type: "CANCELLATION"; accessKey: string; reason: string | null; target: { id: string; number: string | null; alreadyCancelled: boolean } | null }
  | { fileName: string; type: "INVOICE"; invoice: ParsedInvoice; direction: "SAIDA" | "ENTRADA" | null; counterpart: Party; client: { id: string; name: string } | null; duplicate: boolean; warnings: string[] };

type Row = { file: File; item: PreviewItem; include: boolean; direction: "SAIDA" | "ENTRADA" | ""; clientId: string; pdf: File | null; state: "idle" | "ok" | "error"; message?: string };

const fmtDoc = (d: string | null) => (!d ? "" : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : d);

/**
 * Registra as notas que a contabilidade mandou (XML), só para consulta — nada
 * é emitido. Lê os XMLs, mostra para conferir e grava uma a uma.
 */
export function FiscalImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/business/clients") });

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    const all = [...files];
    const xmls = all.filter((f) => /\.xml$/i.test(f.name));
    const pdfs = all.filter((f) => /\.pdf$/i.test(f.name));
    if (!xmls.length) return toast.error("Selecione os arquivos .xml das notas (os PDFs vão junto, com o mesmo nome)");
    setReading(true);
    try {
      const fd = new FormData();
      xmls.forEach((f) => fd.append("files", f));
      const r = await apiPostForm<{ data: { items: PreviewItem[] } }>("/fiscal/import/preview", fd);
      // PDF com o mesmo nome do XML vai anexado junto (DANFE)
      const pdfFor = (xml: File) => pdfs.find((p) => p.name.replace(/\.pdf$/i, "").toLowerCase() === xml.name.replace(/\.xml$/i, "").toLowerCase()) ?? null;
      setRows(
        r.data.items.map((item, i) => ({
          file: xmls[i],
          item,
          include: item.type === "INVOICE" ? !item.duplicate : item.type === "CANCELLATION" ? Boolean(item.target && !item.target.alreadyCancelled) : false,
          direction: item.type === "INVOICE" ? item.direction ?? "" : "",
          clientId: item.type === "INVOICE" ? item.client?.id ?? "" : "",
          pdf: pdfFor(xmls[i]),
          state: "idle",
        }))
      );
    } catch (e) {
      toast.error(errorMessage(e, "Falha ao ler os XMLs"));
    } finally {
      setReading(false);
    }
  };

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.include && r.state !== "ok");
  const missingDirection = selected.some((r) => r.item.type === "INVOICE" && !r.direction);

  const save = async () => {
    setSaving(true);
    let okCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.include || r.state === "ok") continue;
      const fd = new FormData();
      fd.append("xml", r.file);
      if (r.item.type === "INVOICE") {
        const inv = r.item.invoice;
        if (r.pdf) fd.append("pdf", r.pdf);
        fd.append(
          "data",
          JSON.stringify({
            kind: inv.kind,
            direction: r.direction,
            number: inv.number,
            series: inv.series,
            accessKey: inv.accessKey,
            issuedAt: inv.issuedAt ?? new Date().toISOString(),
            amount: inv.amount ?? 0,
            counterpartName: r.item.counterpart.name,
            counterpartDocument: r.item.counterpart.document,
            description: inv.description,
            clientId: r.clientId || null,
          })
        );
      }
      try {
        const res = await apiPostForm<{ message: string }>("/fiscal/import", fd);
        upd(i, { state: "ok", message: res.message });
        okCount++;
      } catch (e) {
        upd(i, { state: "error", message: errorMessage(e, "Falhou") });
      }
    }
    setSaving(false);
    if (okCount) {
      toast.success(`${okCount} registro(s) salvos`);
      onDone();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar notas da contabilidade</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Só registro: nada é emitido. Selecione os XMLs (NF-e ou NFS-e) e, se tiver, os PDFs com o mesmo nome. XML de cancelamento marca a nota já registrada como cancelada.
        </p>
        <Label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-muted/40">
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {reading ? "Lendo…" : "Escolher arquivos (.xml e .pdf)"}
          <input type="file" multiple accept=".xml,.pdf" className="hidden" onChange={(e) => void read(e.target.files)} />
        </Label>

        {rows.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((r, i) => (
              <li key={i} className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={r.include} disabled={r.item.type === "UNKNOWN" || r.state === "ok" || (r.item.type === "INVOICE" && r.item.duplicate)} onChange={(e) => upd(i, { include: e.target.checked })} />
                  <div className="min-w-0 flex-1">
                    {r.item.type === "INVOICE" ? (
                      <>
                        <p className="font-medium">
                          {r.item.invoice.kind === "NFE" ? "NF-e" : "NFS-e"} {r.item.invoice.number ?? "s/ número"}
                          {r.item.invoice.series ? ` · série ${r.item.invoice.series}` : ""} · {formatCurrency(r.item.invoice.amount ?? 0)}
                          {r.item.invoice.issuedAt ? ` · ${new Date(r.item.invoice.issuedAt).toLocaleDateString("pt-BR")}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Emitente: {r.item.invoice.issuer.name ?? "—"} {fmtDoc(r.item.invoice.issuer.document)} → Destinatário: {r.item.invoice.recipient.name ?? "—"} {fmtDoc(r.item.invoice.recipient.document)}
                        </p>
                        {r.item.duplicate && <Badge variant="muted" className="mt-1">já registrada</Badge>}
                        {r.item.warnings.map((w) => <p key={w} className="text-xs text-warning">{w}</p>)}
                      </>
                    ) : r.item.type === "CANCELLATION" ? (
                      <>
                        <p className="font-medium">Cancelamento de NF-e</p>
                        <p className="text-xs text-muted-foreground">
                          {r.item.target ? (r.item.target.alreadyCancelled ? `NF ${r.item.target.number ?? ""} já está cancelada` : `Marca a NF ${r.item.target.number ?? ""} como cancelada`) : "A nota deste cancelamento não está registrada — registre a nota antes"}
                          {r.item.reason ? ` · ${r.item.reason}` : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-destructive">{r.item.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{r.file.name}{r.pdf ? ` + ${r.pdf.name}` : ""}</p>
                    {r.message && <p className={`text-xs ${r.state === "ok" ? "text-success" : "text-destructive"}`}>{r.message}</p>}
                  </div>
                </div>
                {r.item.type === "INVOICE" && r.include && r.state !== "ok" && (
                  <div className="grid gap-2 pl-6 sm:grid-cols-2">
                    <Select value={r.direction || "NONE"} onValueChange={(v) => upd(i, { direction: v === "NONE" ? "" : (v as Row["direction"]) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Saída ou entrada?</SelectItem>
                        <SelectItem value="SAIDA">Saída (a empresa emitiu)</SelectItem>
                        <SelectItem value="ENTRADA">Entrada (a empresa recebeu)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={r.clientId || "NONE"} onValueChange={(v) => upd(i, { clientId: v === "NONE" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem cliente</SelectItem>
                        {(clients.data?.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {missingDirection && <p className="text-xs text-warning">Diga se cada nota é de saída ou de entrada (cadastre o CNPJ da empresa para o sistema descobrir sozinho).</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>Fechar</Button>
          <Button disabled={!selected.length || missingDirection || saving} onClick={() => void save()}>
            {saving ? "Salvando…" : `Registrar ${selected.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nota só em PDF (sem XML): os dados vêm à mão. */
export function FiscalManualDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [f, setF] = useState({ kind: "NFE", direction: "SAIDA", number: "", series: "", issuedAt: "", amount: "", counterpartName: "", counterpartDocument: "", clientId: "" });
  const [saving, setSaving] = useState(false);
  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/business/clients") });
  const save = async () => {
    if (!pdf) return toast.error("Anexe o PDF da nota");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("pdf", pdf);
      fd.append("data", JSON.stringify({ ...f, amount: Number(f.amount.replace(",", ".")), issuedAt: `${f.issuedAt}T12:00:00-03:00`, clientId: f.clientId || null }));
      const r = await apiPostForm<{ message: string }>("/fiscal/import", fd);
      toast.success(r.message);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Falha ao registrar"));
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Registrar nota só com PDF</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2 space-y-1.5"><Label>PDF da nota</Label><Input type="file" accept=".pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} /></div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => set("kind", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NFE">NF-e</SelectItem><SelectItem value="NFSE">NFS-e</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1.5">
            <Label>Direção</Label>
            <Select value={f.direction} onValueChange={(v) => set("direction", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SAIDA">Saída</SelectItem><SelectItem value="ENTRADA">Entrada</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label>Número</Label><Input value={f.number} onChange={(e) => set("number", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Série</Label><Input value={f.series} onChange={(e) => set("series", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Emissão</Label><Input type="date" value={f.issuedAt} onChange={(e) => set("issuedAt", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Valor (R$)</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{f.direction === "SAIDA" ? "Destinatário" : "Emitente"}</Label><Input value={f.counterpartName} onChange={(e) => set("counterpartName", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>CPF/CNPJ</Label><Input value={f.counterpartDocument} onChange={(e) => set("counterpartDocument", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5">
            <Label>Cliente</Label>
            <Select value={f.clientId || "NONE"} onValueChange={(v) => set("clientId", v === "NONE" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="NONE">Sem cliente</SelectItem>{(clients.data?.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || !pdf || !f.issuedAt || !(Number(f.amount.replace(",", ".")) >= 0) || !f.amount} onClick={() => void save()}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
