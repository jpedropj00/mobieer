import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { FileText, ImageIcon, Loader2, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraScanner } from "@/components/camera-scanner";
import { apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { InvoiceItems, type InvoiceItem } from "@/components/invoice-items";

type Boleto = { kind: "BANCARIO" | "ARRECADACAO"; barcode: string; line: string; bankCode: string | null; amount: number | null; dueDate: string | null };
type ReadResult = { boleto: Boleto; beneficiary: { name: string | null; document: string | null }; supplier: { id: string; name: string } | null; items?: InvoiceItem[] };

const BANKS: Record<string, string> = { "001": "Banco do Brasil", "033": "Santander", "104": "Caixa", "237": "Bradesco", "341": "Itaú", "260": "Nubank", "077": "Inter", "756": "Sicoob", "748": "Sicredi", "422": "Safra", "336": "C6", "212": "Original", "655": "Votorantim", "070": "BRB", "004": "Banco do Nordeste" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseMoney = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;

/**
 * Lê um boleto (digitando a linha, pela câmera, foto do código de barras ou o
 * PDF) e cadastra como conta a pagar, já com valor, vencimento e o boleto anexado.
 */
export function BoletoReader({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [form, setForm] = useState({ category: "Boleto", description: "", amount: "", dueDate: "" });
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCode("");
    setPdf(null);
    setRead(null);
    setForm({ category: "Boleto", description: "", amount: "", dueDate: "" });
  };
  const close = () => {
    reset();
    onClose();
  };

  const apply = (r: ReadResult) => {
    setRead(r);
    const who = r.supplier?.name ?? r.beneficiary.name;
    const bank = r.boleto.bankCode ? BANKS[r.boleto.bankCode] ?? `banco ${r.boleto.bankCode}` : null;
    // veio com as compras: é fatura de cartão
    const fatura = (r.items?.length ?? 0) > 0;
    const what = fatura ? "Fatura" : "Boleto";
    setForm((f) => ({
      ...f,
      category: fatura ? "Cartão de crédito" : f.category,
      description: who ? `${what} — ${who}` : bank ? `${what} ${bank}` : what,
      amount: r.boleto.amount ? String(r.boleto.amount.toFixed(2)).replace(".", ",") : "",
      dueDate: r.boleto.dueDate ?? "",
    }));
  };

  const readCode = useMutation({
    mutationFn: (value: string) => apiPost<{ data: ReadResult }>("/finance/documents/boleto/read", { code: value }),
    onSuccess: (r) => apply(r.data),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível ler o boleto")),
  });
  const readPdf = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiPostForm<{ data: ReadResult }>("/finance/documents/boleto/read", fd);
    },
    onSuccess: (r) => apply(r.data),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível ler o PDF")),
  });

  /** Foto do código de barras (boleto impresso ou na tela): o próprio navegador decodifica. */
  const readPhoto = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      readCode.mutate(result.getText());
    } catch {
      toast.error("Não consegui ler o código de barras nesta foto. Tente mais de perto, reto e com boa luz — ou digite a linha digitável.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const r = read!;
      const created = await apiPost<{ data: { id: string }; message?: string }>("/finance/documents", {
        type: "DESPESA",
        docType: r.items?.length ? "FATURA" : "BOLETO",
        items: r.items?.length ? r.items : undefined,
        docNumber: r.boleto.line.slice(0, 80),
        category: form.category.trim() || "Boleto",
        amount: parseMoney(form.amount),
        dueDate: form.dueDate || null,
        description: form.description.trim() || null,
        notes: `Linha digitável: ${r.boleto.line}${r.beneficiary.document ? `\nBeneficiário: ${r.beneficiary.name ?? ""} ${r.beneficiary.document}` : ""}`,
        supplierId: r.supplier?.id ?? null,
      });
      if (pdf) {
        const fd = new FormData();
        fd.append("file", pdf);
        fd.append("kind", "DOCUMENTO");
        await apiPostForm(`/finance/documents/${created.data.id}/attachments`, fd);
      }
    },
    onSuccess: () => {
      toast.success(read?.items?.length ? "Fatura adicionada às contas a pagar, com os gastos por loja" : "Boleto adicionado às contas a pagar");
      onCreated();
      close();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível cadastrar o boleto")),
  });

  const busy = readCode.isPending || readPdf.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ler boleto</DialogTitle>
          <DialogDescription>Digite ou cole a linha digitável, leia o código de barras pela câmera, tire uma foto ou envie o PDF. O boleto entra em contas a pagar.</DialogDescription>
        </DialogHeader>

        {!read ? (
          <div className="space-y-4">
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) readCode.mutate(code.trim());
              }}
            >
              <Label htmlFor="boleto-code" className="text-xs">Linha digitável ou código de barras</Label>
              <div className="flex gap-2">
                <Input id="boleto-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="03399.10317 78302.604232 …" autoComplete="off" />
                <Button type="submit" disabled={!code.trim() || busy}>{readCode.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ler"}</Button>
              </div>
            </form>

            <CameraScanner onCode={(value) => { if (!busy) readCode.mutate(value); }} />

            <div className="grid grid-cols-2 gap-2">
              <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readPhoto(f); }} />
              <Button type="button" variant="outline" disabled={busy} onClick={() => photoInput.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" /> Foto do código
              </Button>
              <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setPdf(f); readPdf.mutate(f); } }} />
              <Button type="button" variant="outline" disabled={busy} onClick={() => pdfInput.current?.click()}>
                {readPdf.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />} PDF do boleto
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-success/40 bg-success/10 p-3">
              <p className="flex items-center gap-2 font-medium text-success"><ScanBarcode className="h-4 w-4" /> Boleto lido</p>
              <p className="mt-1 break-all font-mono text-xs">{read.boleto.line}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {read.boleto.kind === "ARRECADACAO" ? "Conta de consumo / tributo" : read.boleto.bankCode ? BANKS[read.boleto.bankCode] ?? `Banco ${read.boleto.bankCode}` : "Boleto"}
                {read.boleto.amount ? ` · ${brl(read.boleto.amount)}` : ""}
                {read.boleto.dueDate ? ` · vence ${read.boleto.dueDate.split("-").reverse().join("/")}` : " · informe o vencimento"}
                {read.supplier ? ` · fornecedor: ${read.supplier.name}` : read.beneficiary.name ? ` · beneficiário: ${read.beneficiary.name}` : ""}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Valor</Label>
                <Input value={form.amount} inputMode="decimal" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vencimento</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex.: Energia, Fornecedor de MDF, Aluguel" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {read.items && read.items.length > 0 && <InvoiceItems items={read.items} />}
            {pdf && <p className="text-xs text-muted-foreground">O PDF ({pdf.name}) vai anexado ao lançamento.</p>}
          </div>
        )}

        <DialogFooter>
          {read && <Button variant="ghost" onClick={reset}>Ler outro</Button>}
          <Button variant="outline" onClick={close}>Cancelar</Button>
          {read && (
            <Button disabled={save.isPending || parseMoney(form.amount) <= 0 || !form.dueDate} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Adicionar às contas a pagar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
