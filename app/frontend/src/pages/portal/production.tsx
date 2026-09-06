import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { portalGet } from "@/services/portal-api";

const STAGE_LABEL: Record<string, string> = {
  RELEASED: "Liberado para produção",
  IN_PRODUCTION: "Em produção",
  PRE_ASSEMBLY: "Pré-montagem",
  OUT_FOR_DELIVERY: "Em entrega e montagem",
  DELIVERED: "Entregue",
};

type TimelineStep = { stage: string; label: string; reachedAt: string | null; current: boolean; done: boolean };
type Order = {
  id: string;
  stage: string;
  stageLabel: string;
  estimatedDeliveryAt: string | null;
  daysToEstimatedDelivery: number | null;
  timeline: TimelineStep[];
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export function PortalProduction({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "production", projectId],
    queryFn: () => portalGet<{ data: Order | null }>(`/projects/${projectId}/production`),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const o = data?.data ?? null;

  if (!o) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Clock className="h-5 w-5" />
          A produção começa após a aprovação do projeto técnico. Você poderá acompanhar cada etapa por aqui.
        </CardContent>
      </Card>
    );
  }

  const delivered = o.stage === "DELIVERED";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>Acompanhamento da produção</span>
          <Badge variant={delivered ? "success" : "secondary"}>{o.stageLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-3">
          {o.timeline.map((s) => (
            <li key={s.stage} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  s.done
                    ? "border-success bg-success/15 text-success"
                    : s.current
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                )}
              >
                {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.current ? <PackageCheck className="h-3.5 w-3.5" /> : null}
              </span>
              <div className="leading-tight">
                <p className={cn("text-sm font-medium", s.current || s.done ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.reachedAt ? fmtDate(s.reachedAt) : "aguardando"}</p>
              </div>
            </li>
          ))}
        </ol>

        {!delivered && o.estimatedDeliveryAt && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            Previsão de entrega: <strong>{fmtDate(o.estimatedDeliveryAt)}</strong>
            {o.daysToEstimatedDelivery != null && o.daysToEstimatedDelivery >= 0 && (
              <span className="text-muted-foreground"> · faltam {o.daysToEstimatedDelivery} dia(s)</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
