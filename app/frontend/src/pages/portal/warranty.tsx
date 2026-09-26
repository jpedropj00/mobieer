import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";
import { portalDownload, portalGet } from "@/services/portal-api";

type Coverage = { key: string; label: string; detail?: string; months: number; endsAt: string; daysLeft: number; state: "ACTIVE" | "EXPIRING" | "EXPIRED" };
type Data = {
  inspection: { inspectedAt: string; result: string; pendencias: string | null; reportDocumentId: string | null } | null;
  warranty: {
    startsAt: string;
    endsAt: string;
    coverage: Coverage[];
    conditions: string;
    exclusions: string[];
    certificateDocumentId: string | null;
  } | null;
  maintenances: { id: string; label: string; dueAt: string; status: "SCHEDULED" | "DONE" | "CANCELLED"; doneAt: string | null }[];
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const years = (m: number) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? "ano" : "anos"}` : `${m} meses`);
const RESULT: Record<string, string> = {
  APPROVED: "Entrega aprovada",
  APPROVED_WITH_REMARKS: "Entrega aprovada com ressalvas",
  REJECTED: "Entrega não aprovada",
};

function DocButton({ documentId, label }: { documentId: string; label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => portalDownload(`/documents/${documentId}/download`, `${label}.pdf`).catch((e) => toast.error(errorMessage(e, "Falha ao baixar")))}
    >
      <Download className="mr-2 h-4 w-4" /> {label}
    </Button>
  );
}

/** §35/§36/§38 — garantia real do projeto: prazos por item, certificado e revisões. */
export function PortalWarranty({ projectId, fallback, extra }: { projectId: string; fallback: React.ReactNode; extra?: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "warranty", projectId],
    queryFn: () => portalGet<{ data: Data }>(`/projects/${projectId}/warranty`),
  });
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  const d = data?.data;
  if (!d?.warranty) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          A garantia começa a contar na vistoria final, depois da montagem. Até lá, veja abaixo os prazos oferecidos.
        </p>
        {fallback}
      </div>
    );
  }
  const w = d.warranty;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-success" /> Garantia vigente desde {fmt(w.startsAt)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="divide-y rounded-lg border">
            {w.coverage.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{c.label}</span>
                  {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
                </span>
                <span className="text-right">
                  <span className="block">{years(c.months)} · até {fmt(c.endsAt)}</span>
                  {c.state === "EXPIRING" && <Badge variant="warning">termina em {c.daysLeft} dia(s)</Badge>}
                  {c.state === "EXPIRED" && <Badge variant="muted">encerrada</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{w.conditions}</p>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer text-foreground">O que a garantia não cobre</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {w.exclusions.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
          <div className="flex flex-wrap gap-2">
            {w.certificateDocumentId && <DocButton documentId={w.certificateDocumentId} label="Certificado de garantia" />}
            {d.inspection?.reportDocumentId && <DocButton documentId={d.inspection.reportDocumentId} label="Relatório da vistoria" />}
          </div>
        </CardContent>
      </Card>

      {d.inspection && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Vistoria final</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{fmt(d.inspection.inspectedAt)} · {RESULT[d.inspection.result] ?? d.inspection.result}</p>
            {d.inspection.pendencias && <p className="whitespace-pre-line text-muted-foreground">Pendências registradas: {d.inspection.pendencias}</p>}
          </CardContent>
        </Card>
      )}

      {d.maintenances.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-5 w-5" /> Revisões preventivas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {d.maintenances.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.label}</span>
                  <span className="text-muted-foreground">
                    {m.status === "DONE" ? <Badge variant="success">feita em {fmt(m.doneAt)}</Badge> : `prevista para ${fmt(m.dueAt)}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Avisaremos alguns dias antes para combinar a visita.</p>
          </CardContent>
        </Card>
      )}
      {extra}
    </div>
  );
}
