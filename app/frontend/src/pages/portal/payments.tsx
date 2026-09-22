import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, Download, Loader2, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portalDownload, portalGet, portalPost } from "@/services/portal-api";
import { errorMessage } from "@/lib/errors";
import { compressImage } from "@/lib/image";

type Item = {
  id: string;
  label: string;
  project: { id: string; code: string; name: string } | null;
  amount: number;
  paidAmount: number;
  remaining: number;
  dueDate: string | null;
  situation: "PENDENTE" | "VENCIDO" | "PARCIAL" | "PAGO";
  payments: { id: string; amount: number; paidAt: string; method: string | null; receipt: { documentId: string; title: string } | null }[];
  proofs: { id: string; fileName: string; sentAt: string; checked: boolean }[];
};
type Finance = {
  totals: { total: number; pago: number; pendente: number; parcelas: number; pagas: number };
  nextDue: { id: string; label: string; remaining: number; dueDate: string | null } | null;
  items: Item[];
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");

const SITUATION: Record<Item["situation"], { label: string; variant: "success" | "danger" | "warning" | "muted" }> = {
  PAGO: { label: "Pago", variant: "success" },
  PARCIAL: { label: "Pago em parte", variant: "warning" },
  VENCIDO: { label: "Em aberto — venceu", variant: "danger" },
  PENDENTE: { label: "A vencer", variant: "muted" },
};

/** Pagamentos do cliente: parcelas, recibos e envio de comprovante. */
export function PortalPaymentsPage() {
  const q = useQuery({ queryKey: ["portal-finance"], queryFn: () => portalGet<{ data: Finance }>("/finance") });
  const d = q.data?.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Início
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Wallet className="h-5 w-5" /> Pagamentos
      </h1>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !d ? (
        <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar seus pagamentos")}</p>
      ) : d.items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma parcela lançada ainda.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Resumo rotulo="Valor total" valor={brl(d.totals.total)} />
            <Resumo rotulo="Pago" valor={brl(d.totals.pago)} dica={`${d.totals.pagas} de ${d.totals.parcelas} parcela(s)`} />
            <Resumo rotulo="Em aberto" valor={brl(d.totals.pendente)} />
          </div>

          {d.nextDue && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              Próximo vencimento: <strong>{brl(d.nextDue.remaining)}</strong> em <strong>{dmy(d.nextDue.dueDate)}</strong> · {d.nextDue.label}
            </p>
          )}

          <div className="space-y-3">
            {d.items.map((i) => (
              <Parcela key={i.id} item={i} />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            O comprovante enviado aqui é conferido pelo nosso financeiro. Depois da conferência, o recibo fica disponível nesta página.
          </p>
        </>
      )}
    </div>
  );
}

function Parcela({ item }: { item: Item }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const s = SITUATION[item.situation];
  const aguardando = item.proofs.some((p) => !p.checked);

  const enviar = useMutation({
    mutationFn: async (file: File) => {
      // foto de celular passa do limite do servidor; PDF vai como está
      const f = file.type.startsWith("image/") ? await compressImage(file) : file;
      const fd = new FormData();
      fd.append("file", f);
      return portalPost<{ message?: string }>(`/finance/${item.id}/proof`, fd);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Comprovante enviado");
      qc.invalidateQueries({ queryKey: ["portal-finance"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível enviar o comprovante")),
  });

  const baixar = async (documentId: string, title: string) => {
    setBaixando(documentId);
    try {
      await portalDownload(`/documents/${documentId}/download`, `${title}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível baixar o recibo"));
    } finally {
      setBaixando(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-start justify-between gap-2 text-base">
          <span className="min-w-0">
            <span className="block">{item.label}</span>
            {item.project && <span className="block text-xs font-normal text-muted-foreground">{item.project.code} · {item.project.name}</span>}
          </span>
          <Badge variant={s.variant}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>Valor: <strong className="tabular-nums">{brl(item.amount)}</strong></span>
          <span>Vencimento: <strong className="tabular-nums">{dmy(item.dueDate)}</strong></span>
          {item.remaining > 0 && item.paidAmount > 0 && <span>Falta: <strong className="tabular-nums">{brl(item.remaining)}</strong></span>}
        </div>

        {item.payments.length > 0 && (
          <ul className="space-y-1">
            {item.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {brl(p.amount)} em {new Date(p.paidAt).toLocaleDateString("pt-BR")}
                </span>
                {p.receipt && (
                  <Button size="sm" variant="outline" onClick={() => baixar(p.receipt!.documentId, p.receipt!.title)} disabled={baixando === p.receipt.documentId}>
                    {baixando === p.receipt.documentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Recibo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {item.situation !== "PAGO" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) enviar.mutate(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={enviar.isPending}>
              {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar comprovante
            </Button>
            {aguardando && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Comprovante em conferência
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Resumo({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{rotulo}</p>
        <p className="text-lg font-semibold tabular-nums">{valor}</p>
        {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
      </CardContent>
    </Card>
  );
}
