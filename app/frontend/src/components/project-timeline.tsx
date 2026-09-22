import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDashed, History, Loader2, Lock, Minus, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";

type StageStatus = "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDA" | "BLOQUEADA" | "NAO_APLICAVEL";

type Stage = {
  id: string;
  key: string;
  label: string;
  area: string;
  position: number;
  status: StageStatus;
  overdue: boolean;
  responsible: { id: string; name: string } | null;
  plannedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  lastChange: { at: string; by: string } | null;
};

type Timeline = { stages: Stage[]; current: { key: string; label: string } | null; progress: number; overdueCount: number };
type HistoryRow = { id: string; field: string; fromValue: string | null; toValue: string | null; note: string | null; createdAt: string; by: string };

const STATUS_LABEL: Record<StageStatus, string> = {
  PENDENTE: "Pendente",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  BLOQUEADA: "Bloqueada",
  NAO_APLICAVEL: "Não se aplica",
};

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  responsibleId: "Responsável",
  plannedAt: "Data prevista",
  completedAt: "Data real",
  startedAt: "Início",
  notes: "Observações",
};

// datas previstas e reais são de calendário: lidas em UTC, como no financeiro
const dmy = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const isoDay = (d: string | null) => (d ? d.slice(0, 10) : "");

function StageIcon({ s }: { s: Stage }) {
  if (s.overdue) return <AlertTriangle className="h-4 w-4 text-destructive" />;
  if (s.status === "CONCLUIDA") return <Check className="h-4 w-4 text-success" />;
  if (s.status === "EM_ANDAMENTO") return <PlayCircle className="h-4 w-4 text-primary" />;
  if (s.status === "BLOQUEADA") return <Lock className="h-4 w-4 text-warning" />;
  if (s.status === "NAO_APLICAVEL") return <Minus className="h-4 w-4 text-muted-foreground" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

function stageTone(s: Stage) {
  if (s.overdue) return "border-destructive/50 bg-destructive/5";
  if (s.status === "EM_ANDAMENTO") return "border-primary bg-primary/5";
  if (s.status === "CONCLUIDA") return "border-success/40 bg-success/5";
  if (s.status === "BLOQUEADA") return "border-warning/50 bg-warning/5";
  return "border-border bg-background";
}

/**
 * Timeline central do projeto: as 17 etapas, da venda à assistência.
 * Clicar numa etapa abre responsável, datas, observações e o histórico.
 */
export function ProjectTimeline({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const [aberta, setAberta] = useState<Stage | null>(null);
  const q = useQuery({
    queryKey: ["timeline", projectId],
    queryFn: () => apiGet<{ data: Timeline }>(`/projects/${projectId}/timeline`),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando a timeline…</p>;
  const t = q.data?.data;
  if (!t) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar a timeline")}</p>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>Andamento do projeto</span>
          <span className="flex items-center gap-2 text-sm font-normal">
            {t.overdueCount > 0 && <Badge variant="danger">{t.overdueCount} atrasada(s)</Badge>}
            {t.current && <Badge variant="secondary">Etapa atual: {t.current.label}</Badge>}
            <span className="tabular-nums text-muted-foreground">{t.progress}%</span>
          </span>
        </CardTitle>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${t.progress}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        {/* rola na horizontal no celular; quebra em grade no desktop */}
        <ol className="flex snap-x gap-2 overflow-x-auto pb-2 lg:grid lg:grid-cols-6 lg:overflow-visible xl:grid-cols-9">
          {t.stages.map((s) => (
            <li key={s.key} className="min-w-[140px] snap-start lg:min-w-0">
              <button
                type="button"
                onClick={() => setAberta(s)}
                className={`flex h-full w-full flex-col gap-1 rounded-lg border p-2.5 text-left transition hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${stageTone(s)}`}
              >
                <span className="flex items-center gap-1.5">
                  <StageIcon s={s} />
                  <span className="truncate text-xs font-medium">{s.label}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {s.overdue ? `Atrasada · previsto ${dmy(s.plannedAt)}` : s.status === "CONCLUIDA" ? (s.completedAt ? dmy(s.completedAt) : "Concluída") : s.plannedAt ? `Previsto ${dmy(s.plannedAt)}` : STATUS_LABEL[s.status]}
                </span>
                {s.responsible && <span className="truncate text-[11px] text-muted-foreground">{s.responsible.name}</span>}
              </button>
            </li>
          ))}
        </ol>
      </CardContent>

      {aberta && <StageDialog projectId={projectId} stage={aberta} canEdit={can("timeline.edit")} onClose={() => setAberta(null)} />}
    </Card>
  );
}

function StageDialog({ projectId, stage, canEdit, onClose }: { projectId: string; stage: Stage; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    status: stage.status,
    responsibleId: stage.responsible?.id ?? "",
    plannedAt: isoDay(stage.plannedAt),
    completedAt: isoDay(stage.completedAt),
    notes: stage.notes ?? "",
    reason: "",
  });

  const users = useQuery({
    queryKey: ["timeline", projectId, "people"],
    queryFn: () => apiGet<{ data: { id: string; name: string; role: string }[] }>(`/projects/${projectId}/timeline/people`),
    enabled: canEdit,
    staleTime: 5 * 60_000,
  });
  const hist = useQuery({
    queryKey: ["timeline", projectId, stage.key, "history"],
    queryFn: () => apiGet<{ data: HistoryRow[] }>(`/projects/${projectId}/timeline/${stage.key}/history`),
  });

  const salvar = useMutation({
    mutationFn: () =>
      apiPatch<{ message?: string }>(`/projects/${projectId}/timeline/${stage.key}`, {
        status: v.status,
        responsibleId: v.responsibleId || null,
        plannedAt: v.plannedAt || null,
        completedAt: v.status === "CONCLUIDA" ? v.completedAt || null : null,
        notes: v.notes || null,
        reason: v.reason || undefined,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Etapa atualizada");
      qc.invalidateQueries({ queryKey: ["timeline", projectId] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar a etapa")),
  });

  const lista = users.data?.data ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StageIcon s={stage} /> {stage.label}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {canEdit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Status">
                <Select value={v.status} onValueChange={(x) => setV({ ...v, status: x as StageStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as StageStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Responsável">
                <Select value={v.responsibleId || "__ninguem"} onValueChange={(x) => setV({ ...v, responsibleId: x === "__ninguem" ? "" : x })}>
                  <SelectTrigger><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ninguem">Sem responsável</SelectItem>
                    {lista.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Data prevista">
                <Input type="date" value={v.plannedAt} onChange={(e) => setV({ ...v, plannedAt: e.target.value })} />
              </Campo>
              <Campo label="Data real">
                <Input
                  type="date"
                  value={v.completedAt}
                  disabled={v.status !== "CONCLUIDA"}
                  onChange={(e) => setV({ ...v, completedAt: e.target.value })}
                />
              </Campo>
              <Campo label="Observações" className="sm:col-span-2">
                <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
              </Campo>
              <Campo label="Motivo da alteração (vai para o histórico)" className="sm:col-span-2">
                <Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Opcional" />
              </Campo>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <Linha rotulo="Status" valor={STATUS_LABEL[stage.status]} />
              <Linha rotulo="Responsável" valor={stage.responsible?.name ?? "—"} />
              <Linha rotulo="Data prevista" valor={dmy(stage.plannedAt)} />
              <Linha rotulo="Data real" valor={dmy(stage.completedAt)} />
              {stage.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2">{stage.notes}</p>}
            </div>
          )}

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <History className="h-4 w-4" /> Histórico
            </h3>
            {(hist.data?.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma alteração registrada.</p>
            ) : (
              <ol className="space-y-1.5">
                {(hist.data?.data ?? []).map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-2 text-xs">
                    <p>
                      <strong>{FIELD_LABEL[h.field] ?? h.field}</strong>
                      {h.field === "status"
                        ? `: ${STATUS_LABEL[h.fromValue as StageStatus] ?? h.fromValue ?? "—"} → ${STATUS_LABEL[h.toValue as StageStatus] ?? h.toValue}`
                        : " alterado"}
                    </p>
                    <p className="text-muted-foreground">
                      {h.by} · {new Date(h.createdAt).toLocaleString("pt-BR")}
                      {h.note ? ` · ${h.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {canEdit && (
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex justify-between gap-3 border-b border-border/60 pb-1">
      <span className="text-muted-foreground">{rotulo}</span>
      <span>{valor}</span>
    </p>
  );
}
