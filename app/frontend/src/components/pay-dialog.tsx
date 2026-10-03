import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
const parseMoney = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;

/**
 * "Marcar pago" com a opção de anexar o comprovante (foto ou PDF). Registra o
 * pagamento do valor em aberto — o lançamento fica pago e o comprovante junto.
 */
export function PayDialog({
  tx,
  onClose,
  onDone,
}: {
  tx: { id: string; description: string | null; category: string; amount: number; paidAmount?: number | null; method?: string | null; type: "RECEITA" | "DESPESA" } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ amount: "", paidAt: hoje(), method: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tx) return;
    const open = Math.max(0, tx.amount - (tx.paidAmount ?? 0));
    setForm({ amount: open.toFixed(2).replace(".", ","), paidAt: hoje(), method: tx.method ?? "", note: "" });
    setFile(null);
  }, [tx]);

  const pay = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("amount", String(parseMoney(form.amount)));
      fd.append("paidAt", form.paidAt);
      if (form.method.trim()) fd.append("method", form.method.trim());
      if (form.note.trim()) fd.append("note", form.note.trim());
      if (file) fd.append("receipt", file);
      return apiPostForm<{ message?: string }>(`/finance/documents/${tx!.id}/payments`, fd);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Pagamento registrado");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível registrar o pagamento")),
  });

  return (
    <Dialog open={!!tx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tx?.type === "RECEITA" ? "Marcar como recebido" : "Marcar como pago"}</DialogTitle>
          <DialogDescription>{tx ? `${tx.description || tx.category}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Valor pago</Label>
              <Input value={form.amount} inputMode="decimal" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data do pagamento</Label>
              <Input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Forma de pagamento</Label>
            <Input value={form.method} placeholder="PIX, boleto, cartão…" onChange={(e) => setForm({ ...form, method: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Comprovante (opcional)</Label>
            <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {file ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.name}</span>
                <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label="Tirar comprovante" onClick={() => setFile(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => input.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" /> Anexar comprovante (foto ou PDF)
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observação</Label>
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">Valor menor que o total registra pagamento parcial; o lançamento continua em aberto com o saldo.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={pay.isPending || parseMoney(form.amount) <= 0} onClick={() => pay.mutate()}>
            {pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
