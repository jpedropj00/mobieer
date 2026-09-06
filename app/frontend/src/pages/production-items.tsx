import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Factory, Loader2, Play, Plus, RotateCcw, Scissors, Square, Timer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiGet, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { cn, errorMessage } from "@/lib/utils";

export const SECTORS = ["CORTE", "FITA_BORDA", "FURACAO", "PRE_MONTAGEM", "EMBALAGEM", "EXPEDICAO"] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABEL: Record<Sector, string> = {
  CORTE: "Corte",
  FITA_BORDA: "Fita de borda",
  FURACAO: "Furação",
  PRE_MONTAGEM: "Pré-montagem",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
};

export type ProductionItem = {
  id: string;
  ambiente: string | null;
  descricao: string;
  referencia: string | null;
  quantidade: number;
  material: string | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  sector: Sector | null;
  sectorLabel: string | null;
  nextSector: Sector | null;
  daysInSector: number | null;
  timeMinutes: number;
  timerRunning: boolean;
  notes: string | null;
  events: { id: string; sectorLabel: string | null; action: string; note: string | null; createdAt: string; author: string | null }[];
  project?: { id: string; code: string; name: string };
};
type RunningLog = { id: string; sectorLabel: string; minutes: number; item: { id: string; descricao: string; projectCode: string | null } | null };
const hhmm = (m: number) => (m <= 0 ? "—" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);
type SectorLoad = {
  sector: Sector;
  label: string;
  count: number;
  upstream: number;
  stale: number;
  avgDaysInSector: number;
  maxDaysInSector: number;
  oldest: { id: string; descricao: string; projectCode: string | null; daysInSector: number } | null;
};
type FactoryLoad = { pending: number; inProgress: number; staleTotal: number; sectors: SectorLoad[] };
type Summary = { total: number; pending: number; inProgress: number; done: number; cancelled: number; bySector: Record<string, number>; progress: number };

const fmtDateTime = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const STATUS_BADGE: Record<ProductionItem["status"], { label: string; variant: "muted" | "secondary" | "success" | "danger" }> = {
  PENDING: { label: "Aguardando", variant: "muted" },
  IN_PROGRESS: { label: "Em produção", variant: "secondary" },
  DONE: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "danger" },
};

/* ============================ actions ============================ */

function useItemActions(invalidate: () => void) {
  const qc = useQueryClient();
  const done = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["factory-board"] });
    qc.invalidateQueries({ queryKey: ["factory-load"] });
  };
  const advance = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPost(`/production/items/${id}/advance`, body),
    onSuccess: () => done(),
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar o item")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/production/items/${id}`),
    onSuccess: () => { toast.success("Item removido"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });
  const timeDone = () => { done(); qc.invalidateQueries({ queryKey: ["prod-time-running"] }); };
  const startTimer = useMutation({
    mutationFn: (id: string) => apiPost(`/production/items/${id}/time/start`, {}),
    onSuccess: () => timeDone(),
    onError: (e) => toast.error(errorMessage(e, "Falha ao iniciar")),
  });
  const stopTimer = useMutation({
    mutationFn: (logId: string) => apiPost(`/production/time/${logId}/stop`, {}),
    onSuccess: (r: unknown) => { toast.success((r as { message?: string })?.message ?? "Encerrado"); timeDone(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao encerrar")),
  });
  const addTime = useMutation({
    mutationFn: ({ id, minutes, sector }: { id: string; minutes: number; sector?: Sector }) =>
      apiPost(`/production/items/${id}/time`, { minutes, sector }),
    onSuccess: () => { toast.success("Apontamento registrado"); timeDone(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar")),
  });
  return { advance, remove, startTimer, stopTimer, addTime };
}

function TimeControls({ item, running, invalidate }: { item: ProductionItem; running: RunningLog | null; invalidate: () => void }) {
  const { startTimer, stopTimer, addTime } = useItemActions(invalidate);
  const runningHere = running && running.item?.id === item.id;
  const runningElsewhere = running && running.item?.id !== item.id;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">⏱ {hhmm(item.timeMinutes)}</span>
      {runningHere ? (
        <Button size="sm" variant="destructive" disabled={stopTimer.isPending} onClick={() => stopTimer.mutate(running!.id)}>
          {stopTimer.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1 h-3.5 w-3.5" />}
          Parar ({hhmm(running!.minutes)})
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={startTimer.isPending || Boolean(runningElsewhere)}
          title={runningElsewhere ? "Finalize o apontamento em andamento primeiro" : undefined}
          onClick={() => startTimer.mutate(item.id)}
        >
          {startTimer.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Timer className="mr-1 h-3.5 w-3.5" />}
          Apontar
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => {
          const v = window.prompt("Minutos trabalhados neste item:");
          const m = v ? parseInt(v, 10) : NaN;
          if (m > 0) addTime.mutate({ id: item.id, minutes: m, sector: item.sector ?? undefined });
        }}
      >
        + manual
      </Button>
    </div>
  );
}

function AdvanceButtons({ item, canManage, invalidate }: { item: ProductionItem; canManage: boolean; invalidate: () => void }) {
  const { advance, remove } = useItemActions(invalidate);
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {item.status === "PENDING" && (
        <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "start" } })}>
          <Play className="mr-1 h-4 w-4" /> Iniciar (Corte)
        </Button>
      )}
      {item.status === "IN_PROGRESS" && (
        <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "complete" } })}>
          {advance.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1 h-4 w-4" />}
          {item.nextSector ? `Concluir → ${SECTOR_LABEL[item.nextSector]}` : "Concluir item"}
        </Button>
      )}
      {(item.status === "DONE" || item.status === "CANCELLED") && (
        <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "reopen" } })}>
          <RotateCcw className="mr-1 h-4 w-4" /> Reabrir
        </Button>
      )}
      {item.status !== "CANCELLED" && item.status !== "DONE" && (
        <Button size="sm" variant="ghost" className="text-destructive" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "cancel" } })}>
          <X className="h-4 w-4" />
        </Button>
      )}
      {(item.status === "PENDING" || item.status === "CANCELLED") && (
        <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/* ============================ per-project panel ============================ */

export function ProductionItemsPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["production-items", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: { items: ProductionItem[]; summary: Summary } }>(`/production/projects/${projectId}/items`) });
  const imports = useQuery({
    queryKey: ["promob", projectId],
    queryFn: () => apiGet<{ data: { id: string; fileName: string; status: string; itemCount: number }[] }>(`/promob/projects/${projectId}/imports`),
  });
  const reqKey = ["production-requisitions", projectId];
  const requisitions = useQuery({
    queryKey: reqKey,
    queryFn: () => apiGet<{ data: { id: string; number: string; status: string; itemCount: number; createdAt: string }[] }>(`/production/projects/${projectId}/requisitions`),
  });
  const running = useQuery({
    queryKey: ["prod-time-running"],
    queryFn: () => apiGet<{ data: RunningLog | null }>("/production/time/running"),
    refetchInterval: 60_000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: reqKey });
  };

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ descricao: "", ambiente: "", referencia: "", quantidade: "1", material: "" });
  const add = useMutation({
    mutationFn: () => apiPost(`/production/projects/${projectId}/items`, { ...form, quantidade: Number(form.quantidade) || 1 }),
    onSuccess: () => { toast.success("Item adicionado"); setAddOpen(false); setForm({ descricao: "", ambiente: "", referencia: "", quantidade: "1", material: "" }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const fromImport = useMutation({
    mutationFn: (importId: string) => apiPost(`/production/projects/${projectId}/items/from-import/${importId}`, {}),
    onSuccess: (r: unknown) => { toast.success((r as { message?: string })?.message ?? "Itens gerados"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar itens")),
  });
  const genReq = useMutation({
    mutationFn: () => apiPost(`/production/projects/${projectId}/requisition`, {}),
    onSuccess: (r: unknown) => { toast.success((r as { message?: string })?.message ?? "Requisição criada"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar a requisição")),
  });

  if (q.isLoading) return <PageSkeleton />;
  const items = q.data?.data.items ?? [];
  const summary = q.data?.data.summary;
  const parsedImports = (imports.data?.data ?? []).filter((i) => i.status === "PARSED" && i.itemCount > 0);
  const reqs = requisitions.data?.data ?? [];
  const activeItems = items.filter((i) => i.status !== "CANCELLED").length;

  const run = running.data?.data ?? null;

  return (
    <div className="space-y-4">
      {run && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          <Timer className="h-4 w-4 text-primary" />
          <span>Apontamento em andamento: <strong>{run.item?.descricao ?? "—"}</strong> · {run.sectorLabel} · {hhmm(run.minutes)}</span>
        </div>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Itens de produção</span>
            {summary && summary.total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {summary.done}/{summary.total - summary.cancelled} concluídos · {summary.progress}%
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summary && summary.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${summary.progress}%` }} />
            </div>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Adicionar item
              </Button>
              {parsedImports.map((imp) => (
                <Button key={imp.id} size="sm" variant="outline" disabled={fromImport.isPending} onClick={() => fromImport.mutate(imp.id)}>
                  {fromImport.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Factory className="mr-1 h-4 w-4" />}
                  Gerar de “{imp.fileName}”
                </Button>
              ))}
              {activeItems > 0 && (
                <Button size="sm" variant="outline" disabled={genReq.isPending} onClick={() => genReq.mutate()}>
                  {genReq.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Scissors className="mr-1 h-4 w-4" />}
                  Gerar requisição de corte
                </Button>
              )}
            </div>
          )}
          {reqs.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs font-medium text-muted-foreground">Requisições geradas</p>
              {reqs.map((r) => (
                <Link key={r.id} to={`/requisicoes/${r.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50">
                  <span className="font-medium">{r.number}</span>
                  <span className="text-muted-foreground">{r.itemCount} peça(s) · {r.status}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState title="Nenhum item de produção" description="Adicione manualmente ou gere a partir de uma importação do Promob (aba Promob)." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {it.descricao}
                    {it.quantidade > 1 && <span className="ml-1 text-xs text-muted-foreground">×{it.quantidade}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[it.ambiente, it.referencia, it.material].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {it.status === "IN_PROGRESS" && it.sectorLabel && <Badge variant="secondary">{it.sectorLabel}</Badge>}
                  <Badge variant={STATUS_BADGE[it.status].variant}>{STATUS_BADGE[it.status].label}</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <AdvanceButtons item={it} canManage={canManage} invalidate={invalidate} />
                {canManage && it.status !== "DONE" && it.status !== "CANCELLED" && (
                  <TimeControls item={it} running={running.data?.data ?? null} invalidate={invalidate} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar item de produção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Descrição</Label>
              <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Armário superior 800mm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Ambiente</Label>
                <Input value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Referência</Label>
                <Input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Quantidade</Label>
                <Input type="number" min="1" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Material</Label>
                <Input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Ex.: MDF Branco 18mm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button disabled={add.isPending || form.descricao.trim().length < 2} onClick={() => add.mutate()}>
              {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ factory board page ============================ */

type BoardColumn = { sector: Sector; label: string; items: ProductionItem[] };

const STALE_DAYS = 5;
const agingTone = (d: number | null) =>
  d == null ? "text-muted-foreground" : d >= STALE_DAYS ? "text-destructive" : d >= 3 ? "text-warning" : "text-muted-foreground";

export function FactoryBoardPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("organization.manage");
  const q = useQuery({ queryKey: ["factory-board"], queryFn: () => apiGet<{ data: { columns: BoardColumn[] } }>("/production/board") });
  const load = useQuery({ queryKey: ["factory-load"], queryFn: () => apiGet<{ data: FactoryLoad }>("/production/load") });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["factory-board"] });
    qc.invalidateQueries({ queryKey: ["factory-load"] });
  };

  const total = useMemo(() => (q.data?.data.columns ?? []).reduce((n, c) => n + c.items.length, 0), [q.data]);
  if (q.isLoading) return <PageSkeleton />;
  const columns = q.data?.data.columns ?? [];
  const ld = load.data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Fábrica" description="Itens em produção por setor. Cada operador conclui o seu setor e o item avança." />

      {ld && ld.inProgress + ld.pending > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex flex-wrap items-center gap-3 text-sm">
              <span>Carga da fábrica</span>
              <span className="font-normal text-muted-foreground">{ld.inProgress} em produção · {ld.pending} na fila</span>
              {ld.staleTotal > 0 && (
                <Badge variant="danger">{ld.staleTotal} parado(s) há {STALE_DAYS}+ dias</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {ld.sectors.map((s) => (
                <div key={s.sector} className="rounded-lg border border-border p-2.5">
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-lg font-semibold">{s.count}</p>
                  <p className="text-[11px] text-muted-foreground">{s.upstream} a caminho</p>
                  {s.count > 0 && (
                    <p className={cn("text-[11px]", agingTone(s.maxDaysInSector))}>
                      máx {s.maxDaysInSector}d · méd {s.avgDaysInSector}d
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {total === 0 ? (
        <EmptyState title="Nada em produção" description="Os itens aparecem aqui quando entram na fábrica (aba Produção do projeto)." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.sector} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant={col.items.length ? "secondary" : "muted"}>{col.items.length}</Badge>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">vazio</p>
                ) : (
                  col.items.map((it) => (
                    <div key={it.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{it.descricao}{it.quantidade > 1 ? ` ×${it.quantidade}` : ""}</p>
                        {it.daysInSector != null && it.daysInSector >= 3 && (
                          <span className={cn("shrink-0 text-[11px] font-medium", agingTone(it.daysInSector))}>{it.daysInSector}d</span>
                        )}
                      </div>
                      {it.project && (
                        <Link to={`/clientes-projetos/${it.project.id}`} className="text-xs text-muted-foreground hover:underline">
                          {it.project.code}
                        </Link>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">{[it.ambiente, it.referencia].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2">
                        <AdvanceButtons item={it} canManage={canManage} invalidate={invalidate} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
