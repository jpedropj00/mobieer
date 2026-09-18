import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/ui/states";
import { apiGet } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type PipelineCard = {
  id: string;
  kind: "LEAD" | "OPPORTUNITY" | "PROJECT" | "ASSISTANCE";
  stage: string;
  title: string;
  subtitle: string | null;
  value: number | null;
  since: string;
  daysInStage: number;
  stale: boolean;
  owner: string | null;
  link: string;
  badge: string | null;
};
type Column = { stage: string; label: string; staleAfterDays: number; count: number; staleCount: number; value: number; cards: PipelineCard[] };

const KIND_LABEL: Record<PipelineCard["kind"], string> = { LEAD: "Lead", OPPORTUNITY: "Oportunidade", PROJECT: "Projeto", ASSISTANCE: "Assistência" };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Pipeline da loja de ponta a ponta. As etapas são calculadas do que já existe
 * (lead, medição, projeto técnico, produção, entrega, pós-venda, assistência) —
 * ninguém precisa mover card à mão.
 */
export function StorePipelinePage() {
  const q = useQuery({
    queryKey: ["store", "pipeline"],
    queryFn: () => apiGet<{ data: { columns: Column[] } }>("/store/pipeline"),
    refetchInterval: 60_000,
  });
  const [search, setSearch] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);

  const columns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data?.data.columns ?? []).map((c) => ({
      ...c,
      cards: c.cards.filter(
        (card) =>
          (!onlyStale || card.stale) &&
          (!term || `${card.title} ${card.subtitle ?? ""} ${card.owner ?? ""}`.toLowerCase().includes(term))
      ),
    }));
  }, [q.data, search, onlyStale]);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar o pipeline")}</p>;
  const totalStale = (q.data?.data.columns ?? []).reduce((a, c) => a + c.staleCount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline da loja"
        description="Onde cada cliente está: da pré-venda à assistência. Cards em alerta estão parados há mais tempo que o normal da etapa."
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar cliente, projeto ou responsável" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="stale" checked={onlyStale} onCheckedChange={setOnlyStale} />
          <Label htmlFor="stale" className="text-sm">
            Só parados ({totalStale})
          </Label>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => (
          <div key={col.stage} className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{col.label}</p>
                <Badge variant="secondary">{col.count}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {col.value > 0 ? `${brl(col.value)} · ` : ""}alerta após {col.staleAfterDays} dias
                {col.staleCount > 0 && <span className="text-warning"> · {col.staleCount} parado(s)</span>}
              </p>
            </div>
            <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto p-2">
              {col.cards.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">—</p>
              ) : (
                col.cards.map((card) => (
                  <Link
                    key={`${card.kind}-${card.id}`}
                    to={card.link}
                    className={cn("block space-y-1 rounded-md border bg-card p-3 text-sm transition hover:shadow-sm", card.stale ? "border-warning/60" : "border-border")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 font-medium leading-snug">{card.title}</p>
                      {card.stale && <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label="Parado" />}
                    </div>
                    {card.subtitle && <p className="truncate text-xs text-muted-foreground">{card.subtitle}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge variant="muted" className="text-[10px]">{KIND_LABEL[card.kind]}</Badge>
                      {card.badge && <Badge variant="secondary" className="text-[10px]">{card.badge}</Badge>}
                    </div>
                    <p className={cn("text-[11px]", card.stale ? "text-warning" : "text-muted-foreground")}>
                      {card.daysInStage === 0 ? "entrou hoje" : `há ${card.daysInStage} dia(s) na etapa`}
                      {card.value ? ` · ${brl(card.value)}` : ""}
                      {card.owner ? ` · ${card.owner}` : ""}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
