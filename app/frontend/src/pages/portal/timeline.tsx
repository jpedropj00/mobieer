import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { portalGet } from "@/services/portal-api";

type Stage = {
  key: string;
  label: string;
  status: "DONE" | "CURRENT" | "UPCOMING" | "NOT_APPLICABLE";
  plannedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};
type Timeline = { stages: Stage[]; current: string | null; progress: number };

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : null);

/** §12 — linha do tempo do projeto, do briefing à assistência. */
export function PortalTimeline({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "timeline", projectId],
    queryFn: () => portalGet<{ data: Timeline }>(`/projects/${projectId}/timeline`),
  });
  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (isError || !data?.data) return <p className="py-4 text-center text-sm text-muted-foreground">Não foi possível carregar a linha do tempo.</p>;
  const t = data.data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>Andamento do projeto</span>
          <span className="text-sm font-normal text-muted-foreground">
            {t.current ? `Agora: ${t.current} · ` : ""}
            {t.progress}% concluído
          </span>
        </CardTitle>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${t.progress}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-0">
          {t.stages.map((s, i) => {
            const last = i === t.stages.length - 1;
            const date =
              s.status === "DONE" ? fmt(s.completedAt) : s.status === "CURRENT" ? (s.plannedAt ? `previsto ${fmt(s.plannedAt)}` : fmt(s.startedAt) ? `desde ${fmt(s.startedAt)}` : null) : s.plannedAt ? `previsto ${fmt(s.plannedAt)}` : null;
            return (
              <li key={s.key} className="relative flex gap-3 pb-4">
                {!last && <span className={cn("absolute left-[11px] top-6 h-full w-0.5", s.status === "DONE" ? "bg-success/60" : "bg-border")} aria-hidden />}
                <span className="relative z-10 mt-0.5 shrink-0">
                  {s.status === "DONE" ? (
                    <CheckCircle2 className="h-6 w-6 text-success" />
                  ) : s.status === "CURRENT" ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15">
                      <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
                    </span>
                  ) : s.status === "NOT_APPLICABLE" ? (
                    <MinusCircle className="h-6 w-6 text-muted-foreground/50" />
                  ) : (
                    <Circle className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm", s.status === "CURRENT" && "font-semibold text-primary", s.status === "UPCOMING" && "text-muted-foreground", s.status === "NOT_APPLICABLE" && "text-muted-foreground/60")}>
                    {s.label}
                    {s.status === "CURRENT" && " — em andamento"}
                    {s.status === "NOT_APPLICABLE" && " — não se aplica"}
                  </span>
                  {date && <span className="block text-xs text-muted-foreground">{date}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
