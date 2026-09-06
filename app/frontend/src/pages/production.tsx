import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarRange, CheckCircle2, Factory, Loader2, PackageCheck, Sparkles, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { cn, errorMessage } from "@/lib/utils";
import { ProductionItemsPanel } from "./production-items";

export const PRODUCTION_STAGES = ["RELEASED", "IN_PRODUCTION", "PRE_ASSEMBLY", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export const STAGE_LABEL: Record<ProductionStage, string> = {
  RELEASED: "Liberado para produção",
  IN_PRODUCTION: "Em produção",
  PRE_ASSEMBLY: "Pré-montagem",
  OUT_FOR_DELIVERY: "Em entrega e montagem",
  DELIVERED: "Entregue",
};

type TimelineStep = { stage: ProductionStage; label: string; reachedAt: string | null; current: boolean; done: boolean };
type StageEvent = { id: string; stage: ProductionStage; stageLabel: string; note: string | null; createdAt: string; author: string | null };
type ScheduleStep = { stage: ProductionStage; label: string; startAt: string; endAt: string; durationDays: number; note: string | null };
type Schedule = { source: "AI" | "HEURISTIC"; generatedAt: string; summary: string | null; deliveryAt: string; steps: ScheduleStep[] };
export type ProductionOrder = {
  id: string;
  stage: ProductionStage;
  stageLabel: string;
  stageIndex: number;
  nextStage: ProductionStage | null;
  estimatedDeliveryAt: string | null;
  daysToEstimatedDelivery: number | null;
  notes: string | null;
  schedule: Schedule | null;
  scheduleSource: "AI" | "HEURISTIC" | null;
  scheduleGeneratedAt: string | null;
  updatedAt: string;
  timeline: TimelineStep[];
  events: StageEvent[];
  project?: { id: string; code: string; name: string; clientName: string | null };
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const toDateInput = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

function stageBadgeVariant(stage: ProductionStage) {
  if (stage === "DELIVERED") return "success" as const;
  if (stage === "OUT_FOR_DELIVERY") return "secondary" as const;
  return "warning" as const;
}

/* ============================ stepper ============================ */

function Stepper({ timeline }: { timeline: TimelineStep[] }) {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3">
      {timeline.map((s, i) => (
        <li key={s.stage} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                s.done
                  ? "border-success bg-success/15 text-success"
                  : s.current
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-muted text-muted-foreground"
              )}
            >
              {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="leading-tight">
              <p className={cn("text-xs font-medium", s.current ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
              <p className="text-[10px] text-muted-foreground">{s.reachedAt ? fmtDate(s.reachedAt) : "—"}</p>
            </div>
          </div>
          {i < timeline.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
        </li>
      ))}
    </ol>
  );
}

/* ============================ hooks ============================ */

function useProductionActions(projectId: string, invalidate: () => void) {
  const qc = useQueryClient();
  const done = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const advance = useMutation({
    mutationFn: (body: { stage?: ProductionStage; note?: string | null }) =>
      apiPost(`/production/projects/${projectId}/advance`, body),
    onSuccess: (r: unknown) => {
      toast.success((r as { message?: string })?.message ?? "Etapa atualizada");
      done();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar a etapa")),
  });
  const patch = useMutation({
    mutationFn: (body: { estimatedDeliveryAt?: string | null; notes?: string | null }) =>
      apiPatch(`/production/projects/${projectId}`, body),
    onSuccess: () => {
      toast.success("Ordem de produção atualizada");
      done();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const schedule = useMutation({
    mutationFn: () => apiPost(`/production/projects/${projectId}/schedule`, {}),
    onSuccess: (r: unknown) => {
      toast.success((r as { message?: string })?.message ?? "Cronograma gerado");
      done();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar o cronograma")),
  });
  return { advance, patch, schedule };
}

/* ============================ per-project panel ============================ */

export function ProductionProjectPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["production", "project", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: ProductionOrder }>(`/production/projects/${projectId}`) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["production", "all"] });
  };
  const { advance, patch, schedule } = useProductionActions(projectId, invalidate);

  const [dlg, setDlg] = useState(false);
  const [note, setNote] = useState("");
  const [jump, setJump] = useState<ProductionStage | "">("");
  const [eta, setEta] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (q.isLoading) return <PageSkeleton />;
  const o = q.data?.data;
  if (!o) return <p className="py-8 text-center text-sm text-muted-foreground">Indisponível.</p>;

  const etaValue = eta ?? toDateInput(o.estimatedDeliveryAt);
  const notesValue = notes ?? o.notes ?? "";
  const dirty = (eta !== null && eta !== toDateInput(o.estimatedDeliveryAt)) || (notes !== null && notes !== (o.notes ?? ""));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Esteira de produção</span>
            <Badge variant={stageBadgeVariant(o.stage)}>{o.stageLabel}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Stepper timeline={o.timeline} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Previsão de entrega</Label>
              <Input
                type="date"
                value={etaValue}
                disabled={!canManage}
                onChange={(e) => setEta(e.target.value)}
              />
              {o.daysToEstimatedDelivery != null && (
                <p
                  className={cn(
                    "text-xs",
                    o.daysToEstimatedDelivery < 0 ? "text-destructive" : o.daysToEstimatedDelivery <= 3 ? "text-warning" : "text-muted-foreground"
                  )}
                >
                  {o.daysToEstimatedDelivery < 0
                    ? `${-o.daysToEstimatedDelivery}d em atraso`
                    : `faltam ${o.daysToEstimatedDelivery}d`}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observações internas</Label>
            <Textarea rows={2} value={notesValue} disabled={!canManage} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={patch.isPending}
                  onClick={() =>
                    patch.mutate(
                      {
                        ...(eta !== null ? { estimatedDeliveryAt: eta || null } : {}),
                        ...(notes !== null ? { notes: notes || null } : {}),
                      },
                      { onSuccess: () => { setEta(null); setNotes(null); } }
                    )
                  }
                >
                  {patch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
                </Button>
              )}
              {o.nextStage && (
                <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({})}>
                  {advance.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  Avançar para “{STAGE_LABEL[o.nextStage]}”
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setNote(""); setJump(""); setDlg(true); }}>
                Ajustar etapa…
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2"><CalendarRange className="h-4 w-4" /> Cronograma</span>
            {o.schedule && (
              <Badge variant={o.scheduleSource === "AI" ? "secondary" : "muted"}>
                {o.scheduleSource === "AI" ? "Gerado por IA" : "Estimado"}
                {o.scheduleGeneratedAt ? ` · ${fmtDate(o.scheduleGeneratedAt)}` : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {o.schedule ? (
            <>
              {o.schedule.summary && <p className="text-xs text-muted-foreground">{o.schedule.summary}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 text-left font-medium">Etapa</th>
                      <th className="py-1.5 pr-3 text-left font-medium">Início</th>
                      <th className="py-1.5 pr-3 text-left font-medium">Fim</th>
                      <th className="py-1.5 text-left font-medium">Dias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.schedule.steps.map((s) => (
                      <tr key={s.stage} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-3">{s.label}</td>
                        <td className="py-1.5 pr-3">{fmtDate(s.startAt)}</td>
                        <td className="py-1.5 pr-3">{fmtDate(s.endAt)}</td>
                        <td className="py-1.5">{s.durationDays || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Entrega prevista pelo cronograma: <strong className="text-foreground">{fmtDate(o.schedule.deliveryAt)}</strong></p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum cronograma gerado ainda.</p>
          )}
          {canManage && (
            <Button size="sm" variant="outline" disabled={schedule.isPending} onClick={() => schedule.mutate()}>
              {schedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {o.schedule ? "Regenerar cronograma" : "Gerar cronograma"}
            </Button>
          )}
        </CardContent>
      </Card>

      <ProductionItemsPanel projectId={projectId} canManage={canManage} />

      {o.events.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Histórico</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {o.events.map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <div>
                  <p className="font-medium text-foreground">
                    {e.stageLabel}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {e.author ? ` · ${e.author}` : ""}
                    </span>
                  </p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar etapa da produção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Etapa</Label>
              <Select value={jump || o.stage} onValueChange={(v) => setJump(v as ProductionStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
            <Button
              disabled={advance.isPending || !jump || jump === o.stage}
              onClick={() => advance.mutate({ stage: jump || undefined, note: note || null }, { onSuccess: () => setDlg(false) })}
            >
              {advance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ global page ============================ */

function OrderRow({ o, canManage, invalidate }: { o: ProductionOrder; canManage: boolean; invalidate: () => void }) {
  const { advance } = useProductionActions(o.project?.id ?? "", invalidate);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {o.project && (
            <Link to={`/clientes-projetos/${o.project.id}`} className="text-sm font-medium hover:underline">
              {o.project.code} — {o.project.name}
            </Link>
          )}
          {o.project?.clientName && <p className="text-xs text-muted-foreground">{o.project.clientName}</p>}
        </div>
        <Badge variant={stageBadgeVariant(o.stage)}>{o.stageLabel}</Badge>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Previsão de entrega: <span className="text-foreground">{fmtDate(o.estimatedDeliveryAt)}</span>
        {o.daysToEstimatedDelivery != null && (
          <span className={cn("ml-1", o.daysToEstimatedDelivery < 0 ? "text-destructive" : o.daysToEstimatedDelivery <= 3 ? "text-warning" : "")}>
            ({o.daysToEstimatedDelivery < 0 ? `${-o.daysToEstimatedDelivery}d atrasado` : `faltam ${o.daysToEstimatedDelivery}d`})
          </span>
        )}
      </div>
      {canManage && o.nextStage && (
        <div className="mt-3">
          <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({})}>
            {advance.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1 h-4 w-4" />}
            {STAGE_LABEL[o.nextStage]}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProductionPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("organization.manage");
  const key = ["production", "all"];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: ProductionOrder[] }>("/production?all=1") });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const groups = useMemo(() => {
    const all = q.data?.data ?? [];
    return PRODUCTION_STAGES.map((stage) => ({ stage, list: all.filter((o) => o.stage === stage) }));
  }, [q.data]);

  if (q.isLoading) return <PageSkeleton />;
  const total = (q.data?.data ?? []).length;

  const icon = (stage: ProductionStage) =>
    stage === "DELIVERED" ? <PackageCheck className="h-4 w-4" /> : stage === "OUT_FOR_DELIVERY" ? <Truck className="h-4 w-4" /> : <Factory className="h-4 w-4" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Produção" description="Esteira dos pedidos: liberado → produção → pré-montagem → entrega." />
      {total === 0 ? (
        <EmptyState title="Nenhum pedido em produção" description="Quando o cliente aprovar o projeto técnico, o pedido entra aqui." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.stage}>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {icon(g.stage)} {STAGE_LABEL[g.stage]} ({g.list.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {g.list.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">—</p>
                ) : (
                  g.list.map((o) => <OrderRow key={o.id} o={o} canManage={canManage} invalidate={invalidate} />)
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
